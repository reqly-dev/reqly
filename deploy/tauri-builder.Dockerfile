# Reqly Tauri 2 derleme imajı — Linux runner'da hem Linux (deb/appimage) hem Windows (NSIS setup.exe,
# cargo-xwin ile MSVC çapraz derleme) paketi üretir. Uygulama çalıştırmaz; komut dışarıdan verilir:
#   docker run --rm -u 1000:1000 -e HOME=/tmp/h -v "$PWD":/w localhost:3000/mtcsrv/reqly-tauri-builder:latest \
#     npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
# Build: docker build -f deploy/tauri-builder.Dockerfile -t localhost:3000/mtcsrv/reqly-tauri-builder:latest deploy/
# (context'ten hiçbir dosya kopyalanmaz.) CI: .gitea/workflows/builder-image.yml
# NSIS 3.11: Debian bookworm'ün nsis paketi 3.08 ve Tauri'nin şablonundaki Include/Win/RestartManager.nsh
# onda yok ("could not find" ile düşüyor). makensis kaynaktan derlenir; Stubs/Plugins/Include resmî
# Windows zip'inden gelir (NSIS'in POSIX'te önerdiği kurulum). SHA-256'lar SourceForge md5'iyle teyitli.
FROM debian:bookworm AS nsis
ARG NSIS_VERSION=3.11
ARG NSIS_SRC_SHA256=19e72062676ebdc67c11dc032ba80b979cdbffd3886c60b04bb442cdd401ff4b
ARG NSIS_ZIP_SHA256=c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl bzip2 unzip g++ scons zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    base="https://downloads.sourceforge.net/project/nsis/NSIS%203/${NSIS_VERSION}"; \
    cd /tmp; \
    curl -fsSL -o src.tar.bz2 "${base}/nsis-${NSIS_VERSION}-src.tar.bz2"; \
    curl -fsSL -o nsis.zip "${base}/nsis-${NSIS_VERSION}.zip"; \
    echo "${NSIS_SRC_SHA256}  src.tar.bz2" | sha256sum -c -; \
    echo "${NSIS_ZIP_SHA256}  nsis.zip" | sha256sum -c -; \
    unzip -q nsis.zip && mv "nsis-${NSIS_VERSION}" /opt/nsis && rm -f /opt/nsis/*.exe; \
    tar -xjf src.tar.bz2 && cd "nsis-${NSIS_VERSION}-src"; \
    scons -j"$(nproc)" SKIPSTUBS=all SKIPPLUGINS=all SKIPUTILS=all SKIPMISC=all \
          NSIS_CONFIG_CONST_DATA_PATH=no VERSION="${NSIS_VERSION}" makensis; \
    # CONST_DATA_PATH=no: veri dizini = makensis'in bir üst dizini (Windows zip'teki Bin/ düzeni)
    install -D -m 0755 build/urelease/makensis/makensis /opt/nsis/Bin/makensis; \
    /opt/nsis/Bin/makensis -VERSION

FROM rust:1-bookworm

ARG NODE_VERSION=24.22.2

# Windows çapraz derleme (clang-cl/lld-link/llvm-rc + NSIS), Linux Tauri bağımlılıkları,
# ekran görüntüsü kanıtı için Xvfb + imagemagick.
RUN apt-get update && apt-get install -y --no-install-recommends \
      lld llvm clang \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libayatana-appindicator3-dev \
      patchelf file build-essential curl wget pkg-config libxdo-dev \
      xvfb xauth imagemagick x11-utils xdotool dbus-x11 \
      python3 git zip xz-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    # Sürümsüz adlar yoksa (Debian bazılarını yalnızca -14 sonekiyle verir) symlink;
    # clang-cl Debian'da ayrı gelmez, clang argv[0]'a bakarak cl kipine girer.
    && { command -v clang-cl >/dev/null || ln -s "$(readlink -f "$(command -v clang)")" /usr/local/bin/clang-cl; } \
    && for t in llvm-rc llvm-lib llvm-ar llvm-dlltool lld-link clang-cl; do \
         if ! command -v "$t" >/dev/null; then \
           v=$(ls /usr/bin/"$t"-[0-9]* /usr/lib/llvm-*/bin/"$t" 2>/dev/null | sort -V | tail -n1); \
           [ -n "$v" ] && ln -s "$v" /usr/local/bin/"$t"; \
         fi; \
         command -v "$t" >/dev/null || { echo "eksik araç: $t"; exit 1; }; \
       done

# makensis veri dizinini kendi konumundan çözer (CONST_DATA_PATH=no): symlink değil PATH.
COPY --from=nsis /opt/nsis /opt/nsis
ENV PATH=/opt/nsis/Bin:$PATH
RUN makensis -VERSION && test -f /opt/nsis/Include/Win/RestartManager.nsh

# Node — .nvmrc ile birebir aynı sürüm; SHASUMS256.txt ile doğrulanır (launcher/package.mjs mantığı).
RUN set -eux; \
    dist="node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${dist}"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep "  ${dist}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${dist}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "${dist}" SHASUMS256.txt /usr/local/CHANGELOG.md /usr/local/README.md /usr/local/LICENSE; \
    node -v | grep -qx "v${NODE_VERSION}"

# MSVC hedefi + cargo-xwin. İzinler aynı katmanda açılır (ayrı chmod katmanı imajı şişirir):
# container -u 1000:1000 ile koşar ve registry index'ini CARGO_HOME altına yazar.
RUN rustup target add x86_64-pc-windows-msvc \
    && cargo install --locked cargo-xwin \
    && rm -rf /usr/local/cargo/registry/src /usr/local/cargo/registry/cache \
    && chmod -R a+rwX /usr/local/cargo /usr/local/rustup

# Windows SDK + CRT önbelleği imajda: küçük bir crate'i çapraz derleyerek doldurulur
# (aynı zamanda toolchain'in çalıştığının kanıtı).
ENV XWIN_CACHE_DIR=/opt/xwin \
    XWIN_ACCEPT_LICENSE=1
RUN set -eux; \
    mkdir -p /opt/xwin; \
    cd /tmp && cargo new --bin xwin-hello && cd xwin-hello; \
    cargo xwin build --release --target x86_64-pc-windows-msvc; \
    file target/x86_64-pc-windows-msvc/release/xwin-hello.exe | grep -q 'PE32+'; \
    cd / && rm -rf /tmp/xwin-hello /usr/local/cargo/registry/src /usr/local/cargo/registry/cache; \
    chmod -R a+rwX /opt/xwin /usr/local/cargo

WORKDIR /w
