#!/usr/bin/env bash
# Taşınabilir Windows paketi: dist/Reqly_<sürüm>_x64-portable.zip
# NSIS kurulumunun yüküyle birebir aynı dosyalar (reqly.exe + reqly-server.exe + resources/), kurulum
# gerektirmez: exe indirmeyi engelleyen kurumsal ağlar için. Kurulumdan farkı: WebView2 çalışma zamanını
# indirmez (Windows 10/11'de Edge ile zaten vardır) ve Başlat menüsü kısayolu oluşturmaz. Veri yine
# %APPDATA%\tr.talhacigdem.reqly altındadır (uygulama taşınabilir, veri değil).
# Önkoşul: `npm run sidecar:win` ve `npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc`
# koşmuş olmalı (CI'da release.yml → windows). Kullanım: deploy/win-portable.sh [sürüm] [çıktı dizini=dist]
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
version=${1:-$(node -p 'require(process.argv[1]).version' "$root/package.json")}
out=${2:-$root/dist}
exe=$root/src-tauri/target/x86_64-pc-windows-msvc/release/reqly.exe
sidecar=$root/src-tauri/binaries/reqly-server-x86_64-pc-windows-msvc.exe
resources=$root/src-tauri/resources

for p in "$exe" "$sidecar" "$resources/server.cjs" "$resources/worker.cjs" "$resources/app"; do
  [[ -e "$p" ]] || { echo "Eksik: $p (önce sidecar:win ve tauri build koşmalı)" >&2; exit 1; }
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/Reqly"
cp "$exe" "$stage/Reqly/reqly.exe"
cp "$sidecar" "$stage/Reqly/reqly-server.exe"
cp -r "$resources" "$stage/Reqly/resources"
{
  echo "Reqly $version - tasinabilir Windows paketi"
  echo
  echo "Kurulum gerektirmez: bu klasoru istediginiz yere acin ve reqly.exe'yi calistirin."
  echo "reqly-server.exe ve resources/ klasoru reqly.exe'nin yaninda kalmalidir."
  echo "Gereksinim: Microsoft Edge WebView2 calisma zamani (Windows 10/11'de Edge ile birlikte gelir)."
  echo "Veriler: %APPDATA%\\tr.talhacigdem.reqly\\reqly.db"
  echo "Dosya imzasiz oldugu icin SmartScreen uyarabilir: Ek bilgi > Yine de calistir."
} | sed 's/$/\r/' > "$stage/Reqly/BENIOKU.txt"

mkdir -p "$out"; out=$(cd "$out" && pwd)
zipf="$out/Reqly_${version}_x64-portable.zip"
rm -f "$zipf"
if command -v zip >/dev/null; then
  (cd "$stage" && zip -qr -X "$zipf" Reqly)
else
  # Windows runner'ında (Git Bash) zip yok, 7-Zip var
  (cd "$stage" && 7z a -tzip -bso0 -bsp0 "$(cygpath -w "$zipf" 2>/dev/null || echo "$zipf")" Reqly)
fi
echo "Taşınabilir paket: $zipf ($(du -h "$zipf" | cut -f1), $(find "$stage/Reqly" -type f | wc -l) dosya)"
