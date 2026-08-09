# Build context is the repo root (see docker-compose.yml) so this stage can
# reach frontend/.
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html/duel

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/bootstrap.conf.template /etc/nginx/conf.d.available/bootstrap.conf.template
COPY deploy/nginx/full.conf.template /etc/nginx/conf.d.available/full.conf.template
COPY deploy/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 8443
ENTRYPOINT ["/entrypoint.sh"]
