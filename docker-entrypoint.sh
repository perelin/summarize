#!/bin/sh
set -e

# YouTube frequently breaks older yt-dlp releases (n-challenge / player format
# changes). Docker layer caching pins the version baked into the image at build
# time, so a long-lived deployment silently goes stale. Refresh yt-dlp at every
# container start — best-effort and time-boxed so a PyPI hiccup never blocks boot.
if timeout 60 pip3 install --break-system-packages -q -U yt-dlp >/dev/null 2>&1; then
  echo "[entrypoint] yt-dlp updated to $(yt-dlp --version 2>/dev/null)"
else
  echo "[entrypoint] yt-dlp update skipped; using baked version $(yt-dlp --version 2>/dev/null)"
fi

exec "$@"
