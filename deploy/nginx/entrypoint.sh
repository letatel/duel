#!/bin/sh
set -e

# NGINX_SERVER_NAMES/NGINX_CERT_NAME come from docker-compose.yml's nginx
# service environment (defaults there reproduce this repo's original
# single-host, two-domain deploy).
envsubst '${NGINX_SERVER_NAMES} ${NGINX_CERT_NAME}' \
    < /etc/nginx/conf.d.available/bootstrap.conf.template \
    > /etc/nginx/conf.d.available/bootstrap.conf
envsubst '${NGINX_SERVER_NAMES} ${NGINX_CERT_NAME}' \
    < /etc/nginx/conf.d.available/full.conf.template \
    > /etc/nginx/conf.d.available/full.conf

CERT_PATH="/etc/letsencrypt/live/${NGINX_CERT_NAME}/fullchain.pem"

if [ -f "$CERT_PATH" ]; then
    echo "[entrypoint] certificate found, using full config (80 redirect + 8443 TLS)"
    cp /etc/nginx/conf.d.available/full.conf /etc/nginx/conf.d/default.conf
else
    echo "[entrypoint] no certificate yet, using bootstrap config (80 only)"
    cp /etc/nginx/conf.d.available/bootstrap.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g "daemon off;"
