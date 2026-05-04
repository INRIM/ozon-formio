/**
 * URL normalization and endpoint resolution helpers.
 * Replace duplicate url logic across all services.
 * 
 * Usage:
 * import { buildEndpointUrl, normalizeEndpointPath } from './url'
 */

/**
 * Build full URL from backend config and path.
 * 
 * Args:
 *   cfg: RuntimeConfig (has useProxy, backendUrl)
 *   path: endpoint path (can include /api prefix)
 * 
 * @returns Full URL string (e.g., "http://localhost:7999/api/users")
 */
export function buildEndpointUrl(cfg: RuntimeConfig, path: string): string {
  const rawPath = String(path ?? '').trim();
  if (!rawPath) {
    return cfg.useProxy ? '/api' : cfg.backendUrl.replace(/\/+$/, '');
  }
  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath.replace(/\/+$/, '');
  }
  if (rawPath === '/api' || rawPath.startsWith('/api/')) {
    return cfg.useProxy ? rawPath : `${cfg.backendUrl}/${rawPath.replace(/\/+$/, '')}`;
  }
  return cfg.useProxy ? `/api${rawPath}` : `${cfg.backendUrl}/${rawPath}`;
}

/**
 * Resolve follow-up URL from redirect location header.
 * Handles absolute URLs and relative URLs.
 * 
 * @param currentUrl Current URL in request
 * @param location Redirect 'location' header
 * 
 * @returns Resolved URL string
 */
export function resolveFollowUpUrl(currentUrl: string, location: string): string {
  if (!location) {
    return '';
  }
  let path = '';
  const trimmed = location.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    path = this.pathFromAbsoluteUrl(trimmed);
  } else {
    try {
      const absolute = new URL(trimmed, currentUrl);
      path = `${absolute.pathname}${absolute.search || ''}`;
    } catch {
      path = trimmed;
    }
  }

  path = `/${String(path).trim().replace(/^\/+/, '')}`;
  // Strip /api prefix if present
  if (path.startsWith('/api/')) {
    path = path.slice('/api'.length);
  }
  if (path === '/api') {
    path = '/';
  }
  return buildEndpointUrl(cfg, path);
}

/**
 * Get path from absolute URL (pathname + search).
 */
export function pathFromAbsoluteUrl(absoluteUrl: string): string {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(absoluteUrl, origin);
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return '';
  }
}

/**
 * Read CSRF token from cookie.
 */
export function readCsrfCookie(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const match = document.cookie.match(/(?:^|;\s*)ozon_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Resolve absolute HTTP URL value.
 * 
 * Handles: http://url, https://url, http:url, https:url
 * @returns Normalized URL
 */
export function normalizeAbsoluteHttpUrl(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  try {
    // Remove trailing slash
    const urlObj = new URL(raw);
    return urlObj.toString();
  } catch {
    // If not a valid URL, return as-is but trimmed
    return raw;
  }
}

/**
 * Normalize backend URL (strip trailing slash).
 */
export function normalizeBackendUrl(value: string): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Parse JSON or return raw string on error.
 * Duplicate of `core/utils.ts` but also handles nested JSON parsing.
 */
export function normalizeRecordList(payload: any): any[] {
  const t = payload?.content?.data ?? payload?.content ?? payload;
  if (Array.isArray(t)) {
    return t;
  }
  return t?.items ?? t?.records ?? t?.data ?? [];
}

/**
 * Normalize session cache TTL to milliseconds.
 */
export function resolveSessionCacheTtlMs(override?: number): number {
  const configured = Number.isFinite(Number(override))
    ? Number(override)
    : Number(30000);
  if (!Number.isFinite(configured) || configured < 0) {
    return 30000; // default
  }
  return Math.floor(configured);
}

/**
 * Check if response status is a redirect status (301-308).
 */
export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Create API error from status and payload.
 */
export function createApiError(status: number, payload: any, text: string): ApiError {
  const detail = typeof payload === 'string' ? payload :
                  try { return JSON.stringify(payload); }
                  catch { return String(payload); };
  return new ApiError(status, detail, text);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    readonly payload: unknown,
    message?: string
  ) {
    super(message ?? `Errore API ${status}${detail ? ': ' + ApiError.stringifyDetail(detail) : ''}`);
    this.name = 'ApiError';
  }

  private static stringifyDetail(detail: unknown): string {
    if (typeof detail === 'string') {
      return detail;
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
}
