//! Uygulama içi güncelleme (Gitea issue #9).
//!
//! Frontend Tauri IPC kullanmadığı için akışın tamamı burada, Rust tarafındadır: sidecar
//! `REQLY_READY` olduktan sonra ayrı bir async görev `update.auto_check` ayarına bakar, açıksa
//! `plugins.updater.endpoints`'teki `latest.json`'u okur ve yeni sürüm varsa yerel bir diyalog
//! gösterir ("Şimdi kur" / "Sonra"). "Sonra" denen sürüm bu oturumda bir daha sorulmaz; uygulama
//! açık kaldığı sürece denetim günde bir sessizce yinelenir. Tam sessiz kurulum yoktur.
//!
//! Hiçbir hata uygulamayı etkilemez: tümü stderr'e düşer, açılış asla beklemez.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{kill_sidecar, rlog, Sidecar, MAIN_WINDOW};

/// İlk denetim READY'den bu kadar sonra yapılır; pencere önce arayüzü yüklesin.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(5);
/// Uygulama açık kaldığı sürece denetim bu aralıkla yinelenir.
const RECHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// Sidecar'a yerel HTTP istekleri için zaman aşımı.
const LOCAL_HTTP_TIMEOUT: Duration = Duration::from_secs(5);
/// Manifest ve paket indirme için zaman aşımı (yavaş kurumsal proxy'ler için geniş).
const UPDATER_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Diyalogda gösterilen sürüm notlarının en fazla uzunluğu (karakter).
const NOTES_MAX_CHARS: usize = 300;
const WINDOW_TITLE: &str = "Reqly";

/// Sidecar'daki ayarların denetimi ilgilendiren kısmı (`GET /api/settings`, düz anahtarlar).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CheckSettings {
    auto_check: bool,
    verify_tls: bool,
}

impl Default for CheckSettings {
    fn default() -> Self {
        Self {
            auto_check: true,
            verify_tls: true,
        }
    }
}

impl CheckSettings {
    /// Eksik/bozuk alanlarda varsayılan (denetim açık, TLS doğrulaması açık) kullanılır.
    fn from_json(value: &serde_json::Value) -> Self {
        let default = Self::default();
        Self {
            auto_check: value["update.auto_check"]
                .as_bool()
                .unwrap_or(default.auto_check),
            verify_tls: value["network.verify_tls"]
                .as_bool()
                .unwrap_or(default.verify_tls),
        }
    }
}

/// READY adresini (`http://127.0.0.1:<port>/?reqly_token=<t>`) taban adres + oturum token'ına ayırır
/// (issue #29). Token yalnızca yerel API çağrılarında `X-Reqly-Token` başlığıyla kullanılır, loglanmaz.
pub(crate) fn split_ready_url(ready: &str) -> Option<(String, Option<String>)> {
    let url = Url::parse(ready).ok()?;
    let token = url
        .query_pairs()
        .find(|(k, _)| k == "reqly_token")
        .map(|(_, v)| v.into_owned());
    let mut base = url;
    base.set_query(None);
    base.set_fragment(None);
    Some((base.to_string(), token))
}

/// READY sonrası çağrılır: ilk denetimi kısa bir gecikmeyle, sonrakileri günde bir koşan görevi başlatır.
pub(crate) fn schedule_checks(app: AppHandle, server_url: String, token: Option<String>) {
    // reqwest bu projede `rustls-no-provider` ile derlenir (updater eklentisinin seçimi) ve eklenti kripto
    // sağlayıcıyı ancak kendi `check()` çağrısında kurar. Bizim yerel HTTP istemcimiz ondan önce kurulduğu
    // için rustls "no CryptoProvider" paniği atıyor, `panic = "abort"` süreci sessizce öldürüyordu
    // (rc.9 Windows'ta açılıp kapanıyordu; Linux'ta aynı abort yeniden üretildi). Sağlayıcı burada kurulur.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    tauri::async_runtime::spawn(async move {
        // "Sonra" denen sürüm; aynı sürüm için bu oturumda tekrar sorulmaz.
        let mut declined: Option<String> = None;
        rlog!("[reqly] güncelleme: görev başladı, {} sn sonra ilk denetim", FIRST_CHECK_DELAY.as_secs());
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            rlog!("[reqly] güncelleme: denetim başlıyor");
            run_check(&app, &server_url, token.as_deref(), &mut declined).await;
            tokio::time::sleep(RECHECK_INTERVAL).await;
        }
    });
}

/// Tek bir denetim turu. Dönüş değeri yok: her sonuç ya sessizdir ya da diyalogla bildirilir.
async fn run_check(app: &AppHandle, server_url: &str, token: Option<&str>, declined: &mut Option<String>) {
    let local = match reqwest::Client::builder()
        .no_proxy() // 127.0.0.1 isteği ortamdaki/sistemdeki proxy'ye asla gitmesin
        .timeout(LOCAL_HTTP_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            rlog!("[reqly] güncelleme: yerel HTTP istemcisi kurulamadı: {err}");
            return;
        }
    };

    let settings = match get_json(&local, &format!("{server_url}api/settings"), token).await {
        Ok(value) => {
            rlog!("[reqly] güncelleme: ayarlar okundu");
            CheckSettings::from_json(&value)
        }
        Err(err) => {
            rlog!("[reqly] güncelleme: ayarlar okunamadı ({err}), varsayılanla devam");
            CheckSettings::default()
        }
    };
    if !settings.auto_check {
        rlog!("[reqly] güncelleme: otomatik denetim kapalı, atlanıyor");
        return;
    }

    // Aktif proxy (kimlik bilgisi dahil); uç yoksa / hata verirse proxy'siz devam.
    let proxy = match get_json(&local, &format!("{server_url}api/internal/proxy-url"), token).await {
        Ok(value) => value["url"]
            .as_str()
            .and_then(|raw| match Url::parse(raw) {
                Ok(url) => Some(url),
                Err(err) => {
                    rlog!("[reqly] güncelleme: proxy adresi çözülemedi ({err}), proxy'siz devam");
                    None
                }
            }),
        Err(err) => {
            rlog!("[reqly] güncelleme: proxy bilgisi alınamadı ({err}), proxy'siz devam");
            None
        }
    };

    rlog!("[reqly] güncelleme: manifest denetleniyor (proxy: {})", if proxy.is_some() { "var" } else { "yok" });
    let update = match check(app, proxy, settings.verify_tls).await {
        Ok(Some(update)) => update,
        Ok(None) => {
            rlog!("[reqly] güncelleme: yeni sürüm yok");
            return;
        }
        Err(err) => {
            rlog!("[reqly] güncelleme: denetim başarısız: {err}");
            return;
        }
    };

    if !should_prompt(declined.as_deref(), &update.version) {
        rlog!(
            "[reqly] güncelleme: {} bu oturumda ertelendi, tekrar sorulmuyor",
            update.version
        );
        return;
    }

    rlog!(
        "[reqly] güncelleme: {} → {} bulundu ({})",
        update.current_version, update.version, update.download_url
    );
    if ask_install(app, &update).await {
        install(app, update).await;
    } else {
        *declined = Some(update.version.clone());
    }
}

async fn get_json(client: &reqwest::Client, url: &str, token: Option<&str>) -> reqwest::Result<serde_json::Value> {
    let mut request = client.get(url);
    if let Some(token) = token {
        request = request.header("X-Reqly-Token", token);
    }
    request
        .send()
        .await?
        .error_for_status()?
        .json::<serde_json::Value>()
        .await
}

/// Updater'ı kurup manifesti denetler. `verify_tls=false` ayarı (kurumsal TLS araya girme
/// sertifikaları için) updater istemcisine de yansıtılır; paketin bütünlüğünü TLS değil minisign
/// imzası korur.
async fn check(
    app: &AppHandle,
    proxy: Option<Url>,
    verify_tls: bool,
) -> tauri_plugin_updater::Result<Option<Update>> {
    let mut builder = app.updater_builder().timeout(UPDATER_TIMEOUT);
    if let Some(proxy) = proxy {
        rlog!(
            "[reqly] güncelleme: proxy kullanılıyor: {}://{}",
            proxy.scheme(),
            proxy.host_str().unwrap_or("?")
        );
        builder = builder.proxy(proxy);
    }
    if !verify_tls {
        rlog!("[reqly] güncelleme: network.verify_tls kapalı, sertifika doğrulaması yapılmıyor");
        builder = builder.configure_client(|client| client.danger_accept_invalid_certs(true));
    }
    // Windows'ta kurulum `std::process::exit(0)` ile biter; o anda sidecar hâlâ yaşıyorsa
    // `reqly-server.exe` kilitli kalır ve NSIS dosyayı değiştiremez. Varsayılan kanca
    // (`cleanup_before_exit`) sidecar'ı bilmez, bu yüzden ikisini birlikte çağırıyoruz.
    let exit_handle = app.clone();
    builder = builder.on_before_exit(move || {
        kill_sidecar(&exit_handle);
        exit_handle.cleanup_before_exit();
    });
    builder.build()?.check().await
}

/// "Sonra" denen sürüm için yeniden sorulmaz; başka bir sürüm çıkarsa yine sorulur.
fn should_prompt(declined: Option<&str>, version: &str) -> bool {
    declined != Some(version)
}

/// İki düğmeli yerel diyalog. `true` = "Şimdi kur".
async fn ask_install(app: &AppHandle, update: &Update) -> bool {
    let dialog = app
        .dialog()
        .message(update_message(
            &update.version,
            &update.current_version,
            update.body.as_deref(),
        ))
        .title("Reqly güncellemesi")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Şimdi kur".into(),
            "Sonra".into(),
        ));
    // blocking_show ana iş parçacığında çağrılamaz; async görevdeyiz ama tokio işçisini de
    // kilitlemeyelim.
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .unwrap_or(false)
}

fn update_message(new_version: &str, current_version: &str, notes: Option<&str>) -> String {
    let mut message = format!("Reqly {new_version} hazır (şu an {current_version}).");
    if let Some(notes) = notes.map(str::trim).filter(|n| !n.is_empty()) {
        message.push_str("\n\n");
        message.push_str(&truncate_chars(notes, NOTES_MAX_CHARS));
    }
    message
}

/// Karakter (bayt değil) sınırında kırpar; Türkçe harfleri ortadan bölmez.
fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// İndirir (imza doğrulamalı), kurar ve yeniden başlatır. İlerleme pencere başlığına yazılır.
///
/// - Windows: `download_and_install` NSIS'i `/P /UPDATE /R` ile açıp süreci sonlandırır,
///   bu fonksiyon geri dönmez; `/R` kurulum bitince uygulamayı yeniden açar.
/// - macOS: .app yerine yenisi konur, ardından `app.restart()` (RunEvent::Exit → sidecar öldürülür).
async fn install(app: &AppHandle, update: Update) {
    let window = app.get_webview_window(MAIN_WINDOW);
    let set_title = |title: &str| {
        if let Some(window) = &window {
            let _ = window.set_title(title);
        }
    };

    set_title("Reqly — güncelleme indiriliyor");
    let downloaded = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let last_percent = Arc::new(std::sync::atomic::AtomicU64::new(u64::MAX));
    let progress_window = window.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                let done = downloaded.fetch_add(chunk, Ordering::Relaxed) + chunk;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (done as u64 * 100 / total).min(100);
                    if last_percent.swap(percent, Ordering::Relaxed) != percent {
                        if let Some(window) = &progress_window {
                            let _ = window
                                .set_title(&format!("Reqly — güncelleme indiriliyor %{percent}"));
                        }
                    }
                }
            },
            || rlog!("[reqly] güncelleme: indirme tamamlandı, imza doğrulandı, kuruluyor"),
        )
        .await;

    match result {
        Ok(()) => {
            rlog!("[reqly] güncelleme: kuruldu, yeniden başlatılıyor");
            set_title(WINDOW_TITLE);
            // Ana iş parçacığında değiliz: request_exit → RunEvent::Exit → kill_sidecar → yeniden aç.
            app.restart();
        }
        Err(err) => {
            rlog!("[reqly] güncelleme: kurulum başarısız: {err}");
            set_title(WINDOW_TITLE);
            // Windows'ta on_before_exit koştuktan sonra (kurucu açılamadıysa) sidecar ölmüştür;
            // o durumda uygulama çalışmaya devam edemez, kullanıcıya söyle.
            let sidecar_gone = app
                .try_state::<Sidecar>()
                .is_some_and(|s| s.closing.load(Ordering::SeqCst));
            let tail = if sidecar_gone {
                "Yerel sunucu kapatıldı; lütfen Reqly'yi kapatıp yeniden açın."
            } else {
                "Uygulama çalışmaya devam ediyor."
            };
            app.dialog()
                .message(format!("Güncelleme kurulamadı: {err}\n\n{tail}"))
                .title("Reqly güncellemesi")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn ready_url_split_into_base_and_token() {
        let (base, token) = super::split_ready_url("http://127.0.0.1:4100/?reqly_token=abc123").unwrap();
        assert_eq!(base, "http://127.0.0.1:4100/");
        assert_eq!(token.as_deref(), Some("abc123"));
        let (base, token) = super::split_ready_url("http://127.0.0.1:4100/").unwrap();
        assert_eq!(base, "http://127.0.0.1:4100/");
        assert_eq!(token, None);
    }

    use super::*;

    #[test]
    fn ertelenen_surum_tekrar_sorulmaz_farkli_surum_sorulur() {
        assert!(should_prompt(None, "1.0.0"));
        assert!(!should_prompt(Some("1.0.0"), "1.0.0"));
        assert!(should_prompt(Some("1.0.0"), "1.0.1"));
    }

    #[test]
    fn ayarlar_eksikse_varsayilan_acik() {
        let value: serde_json::Value = serde_json::from_str("{}").unwrap();
        assert_eq!(CheckSettings::from_json(&value), CheckSettings::default());
        let value: serde_json::Value =
            serde_json::from_str(r#"{"update.auto_check": false, "network.verify_tls": false}"#)
                .unwrap();
        assert_eq!(
            CheckSettings::from_json(&value),
            CheckSettings {
                auto_check: false,
                verify_tls: false
            }
        );
    }

    #[test]
    fn mesaj_notlari_karakter_sinirinda_kirpar() {
        let notes = "ğ".repeat(NOTES_MAX_CHARS + 50);
        let message = update_message("1.0.1", "1.0.0", Some(&notes));
        assert!(message.starts_with("Reqly 1.0.1 hazır (şu an 1.0.0)."));
        let shown = message.split("\n\n").nth(1).unwrap();
        assert_eq!(shown.chars().count(), NOTES_MAX_CHARS + 1); // + "…"
        assert!(shown.ends_with('…'));
        assert_eq!(
            update_message("1.0.1", "1.0.0", Some("  ")),
            "Reqly 1.0.1 hazır (şu an 1.0.0)."
        );
    }

    /// Updater'ın kuralı `release.version > current` (tauri-plugin-updater updater.rs);
    /// rc dizisinin bu kuralla ilerleyebildiğini belgeler.
    #[test]
    fn on_surum_siralamasi_updater_kuraliyla_uyumlu() {
        use semver::Version;
        let rc8 = Version::parse("1.0.0-rc.8").unwrap();
        assert!(Version::parse("1.0.0-rc.9").unwrap() > rc8);
        assert!(Version::parse("1.0.0-rc.10").unwrap() > rc8); // sayısal, sözlüksel değil
        assert!(Version::parse("1.0.0").unwrap() > rc8);
        assert!(!(Version::parse("1.0.0-rc.8").unwrap() > rc8)); // aynı sürüm → güncelleme yok
    }
}
