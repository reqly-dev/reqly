//! Dışa aktarma indirmeleri için "Farklı kaydet" akışı.
//!
//! Frontend dosyayı tarayıcı indirmesi olarak verir (`<a download>` + blob URL); IPC kullanılmaz.
//! `on_download` olayı senkron ve UI iş parçacığında çağrılır: içinde modal diyalog açmak WebView2'de
//! yeniden girişim riski taşıdığından indirme önce geçici bir dosyaya alınır, bitince asenkron kaydet
//! diyaloğu açılır ve dosya seçilen yere taşınır. Sonuç sayfaya `reqster:file-saved` /
//! `reqster:file-save-failed` DOM olayıyla bildirilir (frontend bildirim gösterir); iptal sessizdir.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use tauri::webview::DownloadEvent;
use tauri::{Manager, Runtime, Webview};
use tauri_plugin_dialog::DialogExt;

/// İndirme URL'si → (geçici dosya, önerilen ad). macOS `Finished`'da yol vermediği için tutulur.
static PENDING: LazyLock<Mutex<HashMap<String, (PathBuf, String)>>> = LazyLock::new(Default::default);
static COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn handle<R: Runtime>(webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let name = destination
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "reqster-export.json".into());
            let dir = std::env::temp_dir().join(format!(
                "reqster-download-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            if let Err(err) = std::fs::create_dir_all(&dir) {
                // Geçici dizin yoksa varsayılan davranış (İndirilenler) sürsün; kaydet diyaloğu açılmaz
                crate::rlog!("[reqster] indirme: geçici dizin açılamadı ({err}), varsayılan konuma iniyor");
                return true;
            }
            let temp = dir.join(&name);
            *destination = temp.clone();
            pending().insert(url.to_string(), (temp, name));
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            let Some((temp, name)) = pending().remove(url.as_str()) else {
                return true;
            };
            if !success {
                crate::rlog!("[reqster] indirme başarısız: {name}");
                cleanup(&temp);
                notify(&webview, "reqster:file-save-failed", &name);
                return true;
            }
            ask_and_move(webview, temp, name);
            true
        }
        _ => true,
    }
}

fn pending() -> MutexGuard<'static, HashMap<String, (PathBuf, String)>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// Asenkron kaydet diyaloğu; seçilirse geçici dosya taşınır, iptalde silinir
fn ask_and_move<R: Runtime>(webview: Webview<R>, temp: PathBuf, name: String) {
    let app = webview.app_handle().clone();
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(dir) = default_directory(&app) {
        dialog = dialog.set_directory(dir);
    }
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    if let Some(window) = app.get_webview_window(crate::MAIN_WINDOW) {
        dialog = dialog.set_parent(&window);
    }
    dialog.save_file(move |chosen| {
        let Some(chosen) = chosen.and_then(|p| p.into_path().ok()) else {
            cleanup(&temp);
            return;
        };
        match move_file(&temp, &chosen) {
            Ok(()) => notify(&webview, "reqster:file-saved", &chosen.to_string_lossy()),
            Err(err) => {
                crate::rlog!("[reqster] dosya kaydedilemedi ({}): {err}", chosen.display());
                notify(&webview, "reqster:file-save-failed", &chosen.to_string_lossy());
            }
        }
        cleanup(&temp);
    });
}

/// İndirilenler; Linux'ta XDG ayarı yoksa `download_dir` boş döner → `~/Downloads`, o da yoksa ev dizini
/// (verilmezse GTK süreç çalışma dizinini açıyor)
fn default_directory<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    if let Ok(dir) = app.path().download_dir() {
        return Some(dir);
    }
    let home = app.path().home_dir().ok()?;
    let downloads = home.join("Downloads");
    Some(if downloads.is_dir() { downloads } else { home })
}

/// Aynı diskte yeniden adlandırma; başka disk/bölümde (EXDEV) kopyala
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map(|_| ())
}

fn cleanup(temp: &Path) {
    let _ = std::fs::remove_file(temp);
    if let Some(dir) = temp.parent() {
        let _ = std::fs::remove_dir(dir);
    }
}

fn notify<R: Runtime>(webview: &Webview<R>, event: &str, path: &str) {
    let detail = serde_json::json!({ "path": path }).to_string();
    let script = format!("window.dispatchEvent(new CustomEvent({}, {{ detail: {detail} }}))", serde_json::json!(event));
    if let Err(err) = webview.eval(script) {
        crate::rlog!("[reqster] bildirim gönderilemedi: {err}");
    }
}
