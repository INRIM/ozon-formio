'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(__dirname, '..', 'dist');
const port = parseInt(process.env.PORT || '8080', 10);
const host = process.env.HOST || '127.0.0.1';
const proxyPrefix = '/__ozon_proxy';
const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade'
]);

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

if (!fs.existsSync(distDir)) {
    console.error('dist directory not found. Run "npm run build" before "npm start".');
    process.exit(1);
}

function sendError(res, statusCode, message) {
    res.writeHead(statusCode, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(message);
}

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const env = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex < 1) {
            return;
        }
        const key = trimmed.slice(0, equalIndex).trim();
        let value = trimmed.slice(equalIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    });
    return env;
}

function loadRuntimeConfig() {
    const env = parseEnvFile(path.join(rootDir, '.env'));
    return {
        backendurl: process.env.backendurl || process.env.BACKENDURL || env.backendurl || env.BACKENDURL || 'http://localhost:8002',
        app_code: process.env.app_code || process.env.APP_CODE || env.app_code || env.APP_CODE || '',
        basetocken: process.env.basetocken || process.env.BASETOCKEN || env.basetocken || env.BASETOCKEN || '',
        tokenheader: process.env.tokenheader || process.env.TOKEN_HEADER || env.tokenheader || env.TOKEN_HEADER || 'Authorization',
        tokenprefix: process.env.tokenprefix || process.env.TOKEN_PREFIX || env.tokenprefix || env.TOKEN_PREFIX || ''
    };
}

function normalizeHeaderName(headerName) {
    const trimmed = String(headerName || '').trim();
    if (!trimmed || !/^[A-Za-z0-9-]+$/.test(trimmed)) {
        return 'Authorization';
    }
    return trimmed;
}

function findHeaderKeyCaseInsensitive(headers, headerName) {
    const target = String(headerName || '').toLowerCase();
    return Object.keys(headers).find((key) => key.toLowerCase() === target);
}

function buildAuthHeaderValue(rawToken, tokenPrefix) {
    const token = String(rawToken || '').trim();
    if (!token) {
        return '';
    }
    const prefix = String(tokenPrefix || '').trim();
    if (!prefix) {
        return token;
    }
    if (token.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
        return token;
    }
    return `${prefix} ${token}`;
}

function ensureProxyAuthHeaders(headers, runtimeConfig) {
    const headerName = normalizeHeaderName(runtimeConfig.tokenheader);
    const effectiveToken = buildAuthHeaderValue(runtimeConfig.basetocken, runtimeConfig.tokenprefix);
    if (!effectiveToken) {
        return {headerName, tokenForwarded: false};
    }

    const hasConfiguredHeader = Boolean(findHeaderKeyCaseInsensitive(headers, headerName));
    if (!hasConfiguredHeader) {
        headers[headerName] = effectiveToken;
    }

    // Compatibility fallback for backends that still read "token".
    if (headerName.toLowerCase() !== 'token' && !findHeaderKeyCaseInsensitive(headers, 'token')) {
        headers.token = effectiveToken;
    }

    return {headerName, tokenForwarded: true};
}

function normalizePathname(pathname) {
    const normalized = path.posix.normalize(pathname || '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildProxyHeaders(incomingHeaders) {
    const headers = {};
    Object.keys(incomingHeaders || {}).forEach((name) => {
        const lowerName = name.toLowerCase();
        if (hopByHopHeaders.has(lowerName)) {
            return;
        }
        if (lowerName === 'host' || lowerName === 'content-length' || lowerName.startsWith('sec-')) {
            return;
        }
        const value = incomingHeaders[name];
        if (value === undefined) {
            return;
        }
        headers[name] = Array.isArray(value) ? value.join(', ') : value;
    });
    return headers;
}

function buildResponseHeaders(upstreamHeaders) {
    const headers = {};
    upstreamHeaders.forEach((value, name) => {
        const lowerName = name.toLowerCase();
        if (hopByHopHeaders.has(lowerName)) {
            return;
        }
        headers[name] = value;
    });
    return headers;
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function pipeUpstreamBodyToResponse(upstreamResponse, res) {
    if (!upstreamResponse.body || !upstreamResponse.body.getReader) {
        const fallbackBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
        res.end(fallbackBuffer);
        return;
    }

    const reader = upstreamResponse.body.getReader();
    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        if (!value || value.length === 0) {
            continue;
        }
        const chunk = Buffer.from(value);
        if (!res.write(chunk)) {
            await new Promise((resolve) => res.once('drain', resolve));
        }
    }
    res.end();
}

async function handleProxyRequest(req, res, requestUrl, normalizedPath) {
    const runtimeConfig = loadRuntimeConfig();
    const backendBase = requestUrl.searchParams.get('__backend');
    if (!backendBase) {
        sendError(res, 400, 'Missing "__backend" query parameter for proxy request.');
        return;
    }

    let parsedBackendUrl;
    try {
        parsedBackendUrl = new URL(backendBase);
    } catch (error) {
        sendError(res, 400, `Invalid backend URL: ${backendBase}`);
        return;
    }

    if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
        sendError(res, 400, 'Only http and https backends are supported.');
        return;
    }

    const proxyPath = normalizedPath.slice(proxyPrefix.length) || '/';
    const upstreamQuery = new URLSearchParams(requestUrl.searchParams);
    upstreamQuery.delete('__backend');
    const backendRoot = backendBase.replace(/\/+$/, '');
    const targetUrl = `${backendRoot}${proxyPath.startsWith('/') ? proxyPath : `/${proxyPath}`}${upstreamQuery.toString() ? `?${upstreamQuery.toString()}` : ''}`;

    try {
        const requestBody = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequestBody(req);
        const upstreamHeaders = buildProxyHeaders(req.headers);
        const authResult = ensureProxyAuthHeaders(upstreamHeaders, runtimeConfig);
        const upstreamResponse = await fetch(targetUrl, {
            method: req.method,
            headers: upstreamHeaders,
            body: requestBody,
            redirect: 'manual'
        });
        const responseHeaders = buildResponseHeaders(upstreamResponse.headers);
        responseHeaders['x-ozon-proxy-auth'] = authResult.tokenForwarded ? `forwarded:${authResult.headerName}` : 'missing';
        res.writeHead(upstreamResponse.status, responseHeaders);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        await pipeUpstreamBodyToResponse(upstreamResponse, res);
    } catch (error) {
        sendError(res, 502, `Proxy request failed: ${error.message}`);
    }
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const normalizedPath = normalizePathname(requestUrl.pathname);
    const requestPath = normalizedPath === '/' ? '/index.html' : normalizedPath;

    if (normalizedPath === '/runtime-config.js') {
        const config = loadRuntimeConfig();
        const payload = `window.__OZON_APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/javascript; charset=utf-8'
        });
        res.end(payload);
        return;
    }

    if (normalizedPath === proxyPrefix || normalizedPath.startsWith(`${proxyPrefix}/`)) {
        await handleProxyRequest(req, res, requestUrl, normalizedPath);
        return;
    }

    const filePath = path.resolve(distDir, `.${requestPath}`);

    if (!filePath.startsWith(distDir)) {
        sendError(res, 403, 'Forbidden');
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            if (error.code === 'ENOENT') {
                sendError(res, 404, 'Not Found');
                return;
            }
            sendError(res, 500, 'Internal Server Error');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = contentTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {'Content-Type': contentType});
        res.end(data);
    });
});

server.listen(port, host, () => {
    console.log(`Ozon frontend available on http://${host}:${port}`);
});
