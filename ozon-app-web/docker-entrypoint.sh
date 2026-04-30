#!/bin/sh
set -e

SITE_URL="${SITE_URL:-}"
AUTH_LOGIN_PATH="${AUTH_LOGIN_PATH:-/login}"
AUTH_LOGOUT_PATH="${AUTH_LOGOUT_PATH:-/logout}"
AUTH_REFRESH_PATH="${AUTH_REFRESH_PATH:-/refresh}"
BACKEND_UPSTREAM="${BACKEND_UPSTREAM:-http://app:8000}"

# Inject runtime config for the Angular app
cat > /usr/share/nginx/html/assets/runtime-config.js << JSEOF
window.__OZON_APP_CONFIG__ = Object.assign(window.__OZON_APP_CONFIG__ || {}, {
  "siteurl": "${SITE_URL}",
  "useproxy": true,
  "authmode": "keycloak",
  "authloginpath": "${AUTH_LOGIN_PATH}",
  "authlogoutpath": "${AUTH_LOGOUT_PATH}",
  "authrefreshpath": "${AUTH_REFRESH_PATH}"
});
JSEOF

# Patch nginx config with backend upstream URL
sed -i "s|__BACKEND_UPSTREAM__|${BACKEND_UPSTREAM}|g" /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
