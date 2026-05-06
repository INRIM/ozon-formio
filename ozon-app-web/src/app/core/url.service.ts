import type { RuntimeConfig } from '../models/ozon.types';

/**
 * URL normalization and endpoint resolution helpers.
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

export function resolveFollowUpUrl(currentUrl: string, location: string): string {
  if (!location) {
    return '';
  }
  const trimmed = location.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return pathFromAbsoluteUrl(trimmed);
  }

  try {
    const absolute = new URL(trimmed, currentUrl);
    return `${absolute.pathname}${absolute.search || ''}`;
  } catch {
    return trimmed;
  }
}

export function pathFromAbsoluteUrl(absoluteUrl: string): string {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(absoluteUrl, origin);
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return '';
  }
}

export function readCsrfCookie(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const match = document.cookie.match(/(?:^|;\s*)ozon_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function normalizeAbsoluteHttpUrl(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}

export function normalizeBackendUrl(value: string): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function normalizeRecordList(payload: any): any[] {
  const t = payload?.content?.data ?? payload?.content ?? payload;
  if (Array.isArray(t)) {
    return t;
  }
  return t?.items ?? t?.records ?? t?.data ?? [];
}

export function resolveSessionCacheTtlMs(override?: number): number {
  const configured = Number.isFinite(Number(override))
    ? Number(override)
    : Number(30000);
  if (!Number.isFinite(configured) || configured < 0) {
    return 30000;
  }
  return Math.floor(configured);
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function createApiError(status: number, payload: any, text: string): ApiError {
  const detail = typeof payload === 'string'
    ? payload
    : (() => {
        try {
          return JSON.stringify(payload);
        } catch {
          return String(payload);
        }
      })();
  return new ApiError(status, detail || text, payload, text);
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
