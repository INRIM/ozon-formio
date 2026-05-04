import fs from 'node:fs';
import path from 'node:path';

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex <= 0) return;
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  });
  return out;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseOriginList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean);
      }
    } catch {
      // Fall through to generic split.
    }
  }
  return text.split(/[,\s;]+/).map((entry) => entry.trim()).filter(Boolean);
}

function toOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function unique(values) {
  const out = [];
  const seen = new Set();
  values.forEach((entry) => {
    const normalized = String(entry ?? '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function normalizeBackendForBrowser(value) {
  const fallback = 'http://localhost:7999';
  const normalized = pickFirstString(value);
  if (!normalized) return fallback;
  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return fallback;
    const host = String(parsed.hostname || '').toLowerCase();
    if (host === 'api' || host === 'backend' || host === 'mci-backend' || host === 'ozon-env-api') {
      return fallback;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function loadFileEnv() {
  const cwd = process.cwd();
  const parent = path.resolve(cwd, '..');
  return {
    parentEnv: parseDotEnvFile(path.join(parent, '.env')),
    localEnv: parseDotEnvFile(path.join(cwd, '.env'))
  };
}

function pickBackendTarget(localEnv, parentEnv) {
  const raw = pickFirstString(
    process.env.backendurl,
    process.env.BACKENDURL,
    process.env.BACKEND_URL,
    localEnv.backendurl,
    localEnv.BACKENDURL,
    localEnv.BACKEND_URL,
    parentEnv.backendurl,
    parentEnv.BACKENDURL,
    parentEnv.BACKEND_URL,
    'http://localhost:7999'
  );
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return 'http://localhost:7999';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return 'http://localhost:7999';
  }
}

function pickSiteUrl(localEnv, parentEnv) {
  return pickFirstString(
    process.env.siteurl,
    process.env.SITE_URL,
    localEnv.siteurl,
    localEnv.SITE_URL,
    parentEnv.siteurl,
    parentEnv.SITE_URL
  );
}

function pickSessionCacheTtlMs(localEnv, parentEnv) {
  const raw = pickFirstString(
    process.env.sessioncachettlms,
    process.env.SESSION_CACHE_TTL_MS,
    localEnv.sessioncachettlms,
    localEnv.SESSION_CACHE_TTL_MS,
    parentEnv.sessioncachettlms,
    parentEnv.SESSION_CACHE_TTL_MS,
    '30000'
  );
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 30000;
  return Math.floor(parsed);
}

function pickAllowedOrigins(localEnv, parentEnv, backendTarget, siteUrl) {
  const configuredOrigins = parseOriginList(
    pickFirstString(
      process.env.allowedorigins,
      process.env.ALLOWED_ORIGINS,
      process.env.CORS_ALLOWED_ORIGINS,
      localEnv.allowedorigins,
      localEnv.ALLOWED_ORIGINS,
      localEnv.CORS_ALLOWED_ORIGINS,
      parentEnv.allowedorigins,
      parentEnv.ALLOWED_ORIGINS,
      parentEnv.CORS_ALLOWED_ORIGINS
    )
  ).map((entry) => toOrigin(entry));
  return unique([
    ...configuredOrigins,
    toOrigin(siteUrl),
    toOrigin(backendTarget)
  ]);
}

function buildRuntimeConfig(localEnv, parentEnv, backendTarget, siteUrl, allowedOrigins, sessionCacheTtlMs) {
  return {
    backendurl: backendTarget,
    siteurl: siteUrl,
    allowedorigins: allowedOrigins,
    useproxy: true,
    sessioncachettlms: sessionCacheTtlMs,
    authmode: 'keycloak',
    authloginpath: pickFirstString(
      process.env.authloginpath,
      process.env.AUTH_LOGIN_PATH,
      localEnv.authloginpath,
      localEnv.AUTH_LOGIN_PATH,
      parentEnv.authloginpath,
      parentEnv.AUTH_LOGIN_PATH,
      '/api/login'
    ),
    authlogoutpath: pickFirstString(
      process.env.authlogoutpath,
      process.env.AUTH_LOGOUT_PATH,
      localEnv.authlogoutpath,
      localEnv.AUTH_LOGOUT_PATH,
      parentEnv.authlogoutpath,
      parentEnv.AUTH_LOGOUT_PATH,
      '/api/logout'
    ),
    authrefreshpath: pickFirstString(
      process.env.authrefreshpath,
      process.env.AUTH_REFRESH_PATH,
      localEnv.authrefreshpath,
      localEnv.AUTH_REFRESH_PATH,
      parentEnv.authrefreshpath,
      parentEnv.AUTH_REFRESH_PATH,
      '/refresh'
    )
  };
}

function writeRuntimeConfigAsset(runtimeConfig) {
  const outPath = path.join(process.cwd(), 'src', 'assets', 'runtime-config.js');
  const payload = `window.__OZON_APP_CONFIG__ = Object.assign(window.__OZON_APP_CONFIG__ || {}, ${JSON.stringify(runtimeConfig, null, 2)});\n`;
  fs.writeFileSync(outPath, payload, 'utf8');
}

function writeProxyConfig(target) {
  const proxyConfig = {
    '/api': {
      target,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn',
      pathRewrite: {
        '^/api': ''
      }
    },
    '/auth': {
      target,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    },
    '/login': {
      target,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    },
    '/logout': {
      target,
      secure: false,
      changeOrigin: true,
      logLevel: 'warn'
    }
  };

  const outPath = path.join(process.cwd(), 'proxy.conf.json');
  fs.writeFileSync(outPath, `${JSON.stringify(proxyConfig, null, 2)}\n`, 'utf8');
}

const { localEnv, parentEnv } = loadFileEnv();
const target = pickBackendTarget(localEnv, parentEnv);
const siteUrl = pickSiteUrl(localEnv, parentEnv);
const sessionCacheTtlMs = pickSessionCacheTtlMs(localEnv, parentEnv);
const allowedOrigins = pickAllowedOrigins(localEnv, parentEnv, target, siteUrl);
const runtimeConfig = buildRuntimeConfig(localEnv, parentEnv, target, siteUrl, allowedOrigins, sessionCacheTtlMs);
writeProxyConfig(target);
writeRuntimeConfigAsset(runtimeConfig);
console.log(`[ozon-app-web] Angular proxy configured: /api -> ${target}`);
