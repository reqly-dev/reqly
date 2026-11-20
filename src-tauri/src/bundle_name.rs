//! macOS: rc.19 ve öncesi `Reqly.app` olarak kuruldu. Tauri updater paketi bulunduğu yerde değiştirdiği için
//! ad değişikliğinden (rc.20) sonra da Finder/Launchpad'de `Reqly.app` kalıyordu. Açılışta paket hâlâ eski adla
//! çalışıyorsa `Reqster.app` olarak yeniden adlandırılır ve uygulama yeni yoldan bir kez yeniden açılır (sonraki
//! güncellemeler de updater'ın `current_exe`'den bulduğu yeni yola yazılsın diye). Veri klasörü uygulama
//! kimliğine bağlı olduğu için değişmez.

use std::path::{Path, PathBuf};

const LEGACY_BUNDLE: &str = "Reqly.app";
const BUNDLE: &str = "Reqster.app";

/// Çalışan exe'nin yolundan (`…/Reqly.app/Contents/MacOS/<exe>`) yeni paket yolunu çıkarır; eski adlı bir
/// paket değilse ya da macOS geçici karantina konumundan (App Translocation, salt okunur) çalışıyorsa `None`.
pub(crate) fn legacy_bundle_target(exe: &Path) -> Option<(PathBuf, PathBuf)> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    if macos_dir.file_name()? != "MacOS" || contents.file_name()? != "Contents" {
        return None;
    }
    if bundle.file_name()? != LEGACY_BUNDLE {
        return None;
    }
    if bundle.components().any(|c| c.as_os_str() == "AppTranslocation") {
        return None;
    }
    Some((bundle.to_path_buf(), bundle.with_file_name(BUNDLE)))
}

/// Paket eski adlıysa yeniden adlandırır ve yeni yoldan yeniden açar. `true` dönerse çağıran hemen çıkmalıdır.
/// Her hata loglanır ve uygulama eski adla açılmaya devam eder (ad değişikliği kozmetiktir).
#[cfg(target_os = "macos")]
pub(crate) fn adopt_new_bundle_name() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let Some((old, new)) = legacy_bundle_target(&exe) else { return false };
    if new.exists() {
        crate::rlog!("[reqster] paket adı: {} zaten var, {} yeniden adlandırılmadı", new.display(), old.display());
        return false;
    }
    if let Err(err) = std::fs::rename(&old, &new) {
        crate::rlog!("[reqster] paket adı: {} → {} yapılamadı: {err}", old.display(), new.display());
        return false;
    }
    crate::rlog!("[reqster] paket adı: {} → {}; yeni yoldan yeniden açılıyor", old.display(), new.display());
    match std::process::Command::new("/usr/bin/open").arg("-n").arg(&new).spawn() {
        Ok(_) => true,
        Err(err) => {
            // Bu oturum eski yoldan (bellekteki exe) çalışmayı sürdürür; bir sonraki açılış yeni addan olur
            crate::rlog!("[reqster] paket adı: yeniden açılamadı ({err}), bu oturum devam ediyor");
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn adopt_new_bundle_name() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eski_adli_paket_yeni_ada_tasinir() {
        let exe = Path::new("/Applications/Reqly.app/Contents/MacOS/reqster");
        assert_eq!(
            legacy_bundle_target(exe),
            Some((PathBuf::from("/Applications/Reqly.app"), PathBuf::from("/Applications/Reqster.app")))
        );
        let user = Path::new("/Users/u/Applications/Reqly.app/Contents/MacOS/reqster");
        assert_eq!(legacy_bundle_target(user).map(|(_, n)| n), Some(PathBuf::from("/Users/u/Applications/Reqster.app")));
    }

    #[test]
    fn yeni_adli_karantinadaki_ya_da_paket_disi_exe_dokunulmaz() {
        assert_eq!(legacy_bundle_target(Path::new("/Applications/Reqster.app/Contents/MacOS/reqster")), None);
        assert_eq!(
            legacy_bundle_target(Path::new(
                "/private/var/folders/x/T/AppTranslocation/ABC/d/Reqly.app/Contents/MacOS/reqster"
            )),
            None
        );
        assert_eq!(legacy_bundle_target(Path::new("/usr/local/bin/reqster")), None);
        assert_eq!(legacy_bundle_target(Path::new("/tmp/Reqly.app/MacOS/reqster")), None);
    }
}
