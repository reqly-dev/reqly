fn main() {
    // generate_context! açılış sayfasını (ui/), ikonları ve sürümü (../package.json) derleme anında gömer.
    // Cargo bunları kaynak saymaz; CI'daki derleme önbelleğiyle birlikte yalnızca bu dosyalar değişince
    // kabuk yeniden derlenmiyor ve eski splash/ikon kalıyordu (rc.11, 2026-11-14). Açıkça izlenir.
    println!("cargo:rerun-if-changed=ui/index.html");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../package.json");
    for icon in ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns", "icon.ico", "icon.png"] {
        println!("cargo:rerun-if-changed=icons/{icon}");
    }
    tauri_build::build()
}
