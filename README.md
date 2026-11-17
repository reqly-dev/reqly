# Reqly

Tamamen yerel çalışan, hafif ve veri gizliliği odaklı API istemcisi (Postman alternatifi).
Mimari kararlar için [TASARIM.md](./TASARIM.md) dosyasına bakın.

## Gereksinimler

- Node.js ≥ 20

## Kurulum ve Çalıştırma

```bash
npm install
npm run dev        # backend (127.0.0.1:7357) + UI (127.0.0.1:5173) birlikte
```

Tarayıcıda `http://127.0.0.1:5173` adresini açın.

Ayrı ayrı çalıştırmak için: `npm run dev:server` ve `npm run dev:app`.

## Hazır paket (Windows kurulum dosyası / taşınabilir zip, Linux `reqly`)

Geliştirme ortamı kurmadan kullanmak için Gitea'daki **Releases** sayfasından
`Reqly_<sürüm>_x64-setup.exe` indirip kurun (kullanıcı hesabına kurulur, yönetici hakkı gerekmez;
Edge WebView2 çalışma zamanı yoksa kurulum onu indirir). Exe indirmenin engellendiği (kurumsal) ağlarda
`Reqly_<sürüm>_x64-portable.zip` indirin: kurulum gerektirmez, açıp `Reqly\reqly.exe`'yi çalıştırın.
İçeriği kurulumun yüküyle aynıdır; farkı WebView2'yi indirmemesi (Windows 10/11'de Edge ile zaten
vardır) ve Başlat menüsü kısayolu oluşturmamasıdır. Uygulama gerçek bir masaüstü penceresinde
(Tauri 2) açılır; konsol penceresi ya da tarayıcı yoktur. Veri her iki biçimde de
`%APPDATA%\tr.talhacigdem.reqly\reqly.db` dosyasında tutulur. Linux/sunucu kullanımı için
`Reqly-<sürüm>-linux-x64.tar.gz` (tarayıcıdan `http://127.0.0.1:7357`) vardır.

**macOS:** Releases'ta `Reqly_<sürüm>_aarch64.dmg` (Apple Silicon: M1 ve sonrası) ve `Reqly_<sürüm>_x64.dmg`
(Intel) bulunur. Paketler imzasızdır (Apple Developer hesabı yok): dmg'yi açıp Reqly'yi Uygulamalar'a
sürükleyin; ilk açılışta macOS "açılamıyor" derse Sistem Ayarları → Gizlilik ve Güvenlik → en altta
"Yine de Aç". Veri `~/Library/Application Support/tr.talhacigdem.reqly/reqly.db` dosyasındadır. macOS
paketleri CI'daki Mac runner'ında üretilir; o an çevrimdışıysa dmg'ler Release'e sonradan eklenir.

Mimari: `Reqly.exe` Tauri kabuğudur (`src-tauri/`). Açılışta yanındaki `reqly-server.exe`'yi
(resmî Node ikilisinin içine Node SEA ile gömülmüş ince başlatıcı, `launcher/reqly-launcher.js`)
sidecar olarak başlatır; sunucu boş bir porttan kalkar, hazır olunca `REQLY_READY <adres>` yazar ve
pencere o adrese gider. Uygulama kodu `resources/` altındadır (`server.cjs` + `worker.cjs` esbuild
bundle'ları, `app/` vite çıktısı, `migrations/`, hedef platformun ön-derlenmiş `better-sqlite3` ve
`isolated-vm` ikilileri). Pencere kapanınca sunucu da kapanır.

Paketler **Gitea Actions** tarafından üretilir (`.gitea/workflows/build.yml`): `v1.2.3` tag'i Gitea
Release üretir (Windows kurulum dosyası + taşınabilir zip + Linux tar.gz), elle tetikleme artifact bırakır; `main`
push'unda paket yüklenmez, yalnızca typecheck + Linux paketi + duman testi koşar. Windows kurulum
dosyası Linux runner'da `cargo-xwin` ile çapraz derlenir (`deploy/tauri-builder.Dockerfile` imajı).
Yerelde üretmek için (Node sürümü `.nvmrc` ile aynı olmalı; bu makinede container içinde):

```bash
npm run package:linux                                                # dist/Reqly-<sürüm>-linux-x64.tar.gz
npm run smoke                                                        # Linux paketini çalıştırıp uçtan uca doğrular
npm run sidecar:win                                                  # Tauri sidecar'ı → src-tauri/binaries + resources
npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc  # src-tauri/target/.../nsis/Reqly_<sürüm>_x64-setup.exe
npm run portable:win                                                 # dist/Reqly_<sürüm>_x64-portable.zip (aynı yük, kurulumsuz)
```

Bilinen sınırlar: kurulum dosyası imzasızdır (Windows SmartScreen ilk açılışta uyarabilir);
Linux için deb/AppImage henüz Release'e eklenmiyor.

## Sunucuda / Docker'da çalıştırma

Linux paketi (`npm run package:linux`) `deploy/Dockerfile` ile bir imaja konup headless çalıştırılabilir;
container içinde sunucu `REQLY_HOST=0.0.0.0` ile dinler (yerel kullanımda varsayılan `127.0.0.1`), veri
`/data` volume'undadır. Dış adla erişilecekse ad `REQLY_ALLOWED_HOSTS`'a eklenmelidir (Host denetimi).

- **Kimlik doğrulamalı bir ön kapı zorunludur.** Reqly kimlik doğrulaması olmayan bir HTTP istemcisi ve script
  çalıştırıcısıdır; adresi bulan herkes onu bulunduğu ağa açılan bir proxy gibi kullanabilir. Bir ağa açarken
  önüne kimlik doğrulayan bir ters vekil (ör. Cloudflare Access, oauth2-proxy) koyun.

## Veri

Tüm veri `data/reqly.db` SQLite dosyasında tutulur (`.gitignore`'da).
Konumu değiştirmek için `REQLY_DATA_DIR` ortam değişkenini kullanın.

## Faz 1 Kapsamı

- İstek oluşturma/çalıştırma (params, headers, body, auth) — CORS'a takılmamak için tüm istekler backend'den atılır
- Koleksiyon → klasör → istek hiyerarşisi
- Ortam / koleksiyon / global değişkenler, `{{degisken}}` interpolasyonu, secret maskeleme
- İstek geçmişi (snapshot mantığı)
- Postman Collection v2/v2.1 ve Environment import'u (atomik, raporlu)

Faz 2 (script sandbox, test runner) ve Faz 3 (Tauri paketleme, cURL/OpenAPI import) TASARIM.md'de tanımlıdır.

## Lisans

Reqly [Apache License 2.0](LICENSE) ile lisanslanmıştır; telif ve üçüncü taraf bildirimleri için [NOTICE](NOTICE).
