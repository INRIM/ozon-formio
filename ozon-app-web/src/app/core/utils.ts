/**
 * Utility functions for record/type checking and JSON parsing.
 * Centralize duplicate logic across all services.
 * 
 * Usage:
 * import { RecordCheck, JsonHelpers } from './utils'
 * interface MyService extends RecordCheck, JsonHelpers { ... }
 */

/**
 * Check if value is a non-array object (Record<string, any>).
 * Same logic repeated in 8+ services.
 */
export function isRecord(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Path segments that must never be traversed or written when resolving a
 * dotted path against untrusted (backend/schema-driven) data: they reach the
 * object prototype instead of own data.
 */
export const UNSAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isUnsafePathSegment(segment: string): boolean {
  return UNSAFE_PATH_SEGMENTS.has(segment);
}

/**
 * Extract string from candidate list, preferring non-empty trimmed string.
 * Implemented identically in runtime-config, app-action, app-manager, etc.
 */
export function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return '';
}

/**
 * Parse JSON with fallback to raw string on error.
 * Used everywhere: api/service.ts, managers/*, core/*
 */
export function parseJsonOrText(t: string): any {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/**
 * Parse string to number with validation and floor.
 * Duplicate in ozon-api, app-manager, app-action.
 */
export function parseNonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Extract record from payload using `content.data` / `data` / `records` pattern.
 * Duplicate in ozon-api, app-manager.
 */
export function extractRecord(payload: any): any {
  return payload?.content?.data ?? payload?.content ?? payload?.data ?? payload?.records ?? payload;
}

/**
 * Normalize boolean string with case-insensitive fallback.
 */
export function toBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  return true; // default
}

/**
 * Convert common Moment-style date tokens to the Angular-style tokens expected
 * by Form.io. Only the date portion is changed, so lowercase `mm` remains valid
 * for minutes after an hour token.
 */
export function normalizeFormioDateTimeFormat(value: unknown, enableDate = true): string {
  const format = String(value ?? '').trim();
  if (!format) return '';

  const normalizedYear = format.replace(/Y{2,4}/g, token => 'y'.repeat(token.length));
  if (!enableDate) return normalizedYear;

  const firstHourToken = normalizedYear.search(/[Hh]/);
  const dateEnd = firstHourToken >= 0 ? firstHourToken : normalizedYear.length;
  const datePart = normalizedYear
    .slice(0, dateEnd)
    .replace(/D{1,2}/g, token => 'd'.repeat(token.length))
    .replace(/m{1,2}/g, token => 'M'.repeat(token.length));
  return `${datePart}${normalizedYear.slice(dateEnd)}`;
}

/**
 * Extract string as first non-empty trimmed value, preferring explicit over fallbacks.
 */
export function readFirstString(...candidates: unknown[]): string {
  for (const entry of candidates) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }
  }
  return '';
}

/**
 * Normalize URL path: strip trailing slash, resolve relative paths.
 * Common pattern in runtime-config, ozon-api, app-action, app-table.
 */
export function normalizeUrl(value: string, fallback?: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback ?? '';
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

/**
 * Normalize endpoint path: handle absolute paths starting with /api.
 */
export function normalizeEndpointPath(value: string, fallback: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  if (raw === '/api') {
    return raw;
  }
  if (raw.startsWith('/api/')) {
    return raw.replace(/\/+$/, '');
  }
  return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

/**
 * Sanitize URL component: extract origin, validate protocol.
 */
export function extractOrigin(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return '';
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

/**
 * Parse optional integer from value, returning default if invalid.
 */
export function toOptionalBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  return true;
}

/**
 * Extract string from candidates as first non-empty trimmed value.
 */
