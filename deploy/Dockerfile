# Reqster headless Docker imajı (sunucuda tarayıcıdan kullanım).
#
# Build context'i CI'ın ürettiği ve duman testinden geçirdiği Linux paketidir:
#   docker build -f deploy/Dockerfile --build-arg GIT_SHA=... dist/package/linux-x64
# Yani imaj, kullanıcıya dağıtılan `Reqster/` klasörünün (Node SEA ikilisi + resources/)
# birebir aynısını çalıştırır; ayrı bir derleme yolu yoktur. İkili glibc ister (alpine olmaz).
FROM debian:bookworm-slim

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="reqster" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/reqster-dev/reqster"

RUN useradd --uid 1000 --user-group --create-home --shell /usr/sbin/nologin reqster \
    && mkdir -p /data && chown 1000:1000 /data

COPY --chown=1000:1000 Reqster /app/Reqster

# REQSTER_HOST=0.0.0.0: yerel araç varsayılanı loopback'tir; container'da dışa açılır. Önünde
# kimlik doğrulayan bir katman (Cloudflare Access) olmalıdır. REQSTER_NO_BROWSER: başlatıcı
# tarayıcı açmaya çalışmaz. Veri /data'da (named volume). REQSTER_AUTH=off: yerel oturum
# token'ı kapalı — kimliği Access doğrular; Host denetimi açık kalır (REQSTER_ALLOWED_HOSTS).
ENV REQSTER_HOST=0.0.0.0 \
    REQSTER_NO_BROWSER=1 \
    REQSTER_AUTH=off \
    REQSTER_DATA_DIR=/data \
    TZ=Europe/Istanbul

USER 1000
WORKDIR /app/Reqster
EXPOSE 7357

# İmajda curl/wget yok; bash'in /dev/tcp'si ile port dinleniyor mu bakılır.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/7357 && printf "GET /api/workspace HTTP/1.0\r\n\r\n" >&3 && head -c 15 <&3 | grep -q "200"' || exit 1

CMD ["/app/Reqster/reqster"]
