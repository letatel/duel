#!/bin/sh
set -e

CERT_PATH="/etc/letsencrypt/live/letatel.com/fullchain.pem"

if [ -f "$CERT_PATH" ]; then
    echo "[entrypoint] certificate found, using full config (80 redirect + 8443 TLS)"
    cp /etc/nginx/conf.d.available/full.conf /etc/nginx/conf.d/default.conf
else
    echo "[entrypoint] no certificate yet, using bootstrap config (80 only)"
    cp /etc/nginx/conf.d.available/bootstrap.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g "daemon off;"
