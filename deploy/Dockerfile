# Reqly headless Docker imajı (sunucuda tarayıcıdan kullanım).
#
# Build context'i CI'ın ürettiği ve duman testinden geçirdiği Linux paketidir:
#   docker build -f deploy/Dockerfile --build-arg GIT_SHA=... dist/package/linux-x64
# Yani imaj, kullanıcıya dağıtılan `Reqly/` klasörünün (Node SEA ikilisi + resources/)
# birebir aynısını çalıştırır; ayrı bir derleme yolu yoktur. İkili glibc ister (alpine olmaz).
FROM debian:bookworm-slim

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="reqly" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/reqly-dev/reqly"

RUN useradd --uid 1000 --user-group --create-home --shell /usr/sbin/nologin reqly \
    && mkdir -p /data && chown 1000:1000 /data

COPY --chown=1000:1000 Reqly /app/Reqly

# REQLY_HOST=0.0.0.0: yerel araç varsayılanı loopback'tir; container'da dışa açılır. Önünde
# kimlik doğrulayan bir katman (Cloudflare Access) olmalıdır. REQLY_NO_BROWSER: başlatıcı
# tarayıcı açmaya çalışmaz. Veri /data'da (named volume). REQLY_AUTH=off: yerel oturum
# token'ı (issue #29) kapalı — kimliği Access doğrular; Host denetimi açık kalır (REQLY_ALLOWED_HOSTS).
ENV REQLY_HOST=0.0.0.0 \
    REQLY_NO_BROWSER=1 \
    REQLY_AUTH=off \
    REQLY_DATA_DIR=/data \
    TZ=Europe/Istanbul

USER 1000
WORKDIR /app/Reqly
EXPOSE 7357

# İmajda curl/wget yok; bash'in /dev/tcp'si ile port dinleniyor mu bakılır.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/7357 && printf "GET /api/workspace HTTP/1.0\r\n\r\n" >&3 && head -c 15 <&3 | grep -q "200"' || exit 1

CMD ["/app/Reqly/reqly"]
