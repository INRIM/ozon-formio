# Stage 1: build Angular app
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY patches ./patches
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx (non-root — A-12)
FROM nginx:alpine
COPY --from=builder /app/dist/ozon-app-web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    # docker-entrypoint.sh writes assets/runtime-config.js and sed -i's default.conf
    # at container start; the nginx user needs write access to both.
    && chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/conf.d \
    && chown nginx:nginx /var/cache/nginx /var/run \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid
USER nginx
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
