import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { RuntimeAuthMode, RuntimeConfig } from '../models/ozon.types';

declare global {
  interface Window {
    __OZON_APP_CONFIG__?: Partial<Record<string, unknown>>;
  }
}

const STORAGE_KEY = 'ozon-app-web.runtime';

@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private config: RuntimeConfig = this.load();

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<RuntimeConfig>): RuntimeConfig {
    const backendUrl = this.normalizeBackendUrl(patch.backendUrl ?? this.config.backendUrl);
    const siteUrl = this.normalizeSiteUrl(patch.siteUrl ?? this.config.siteUrl);
    const allowedOrigins = this.normalizeAllowedOrigins(
      patch.allowedOrigins ?? this.config.allowedOrigins,
      { backendUrl, siteUrl }
    );
    const authMode = this.normalizeAuthMode(String(patch.authMode ?? this.config.authMode ?? 'keycloak'));
    this.config = {
      ...this.config,
      ...patch,
      backendUrl,
      siteUrl,
      allowedOrigins,
      sessionCacheTtlMs: this.normalizeSessionCacheTtlMs(
        patch.sessionCacheTtlMs ?? this.config.sessionCacheTtlMs
      ),
      authMode,
      authLoginPath: this.normalizeEndpointPath(
        patch.authLoginPath ?? this.config.authLoginPath,
        '/login'
      ),
      authLogoutPath: this.normalizeEndpointPath(
        patch.authLogoutPath ?? this.config.authLogoutPath,
        '/logout'
      ),
      authRefreshPath: this.normalizeEndpointPath(
        patch.authRefreshPath ?? this.config.authRefreshPath,
        '/refresh'
      ),
      appCode: String(patch.appCode ?? this.config.appCode ?? '').trim()
    };
    this.persist(this.config);
    return this.getConfig();
  }

  private load(): RuntimeConfig {
    const runtime = typeof window !== 'undefined' ? (window.__OZON_APP_CONFIG__ ?? {}) : {};
    const query = this.readQuery();
    const stored = this.readStored();

    const backendUrl = this.normalizeBackendUrl(
      this.pickFirstString(
        query['backendurl'],
        query['BACKENDURL'],
        runtime['backendurl'],
        runtime['BACKENDURL'],
        stored?.backendUrl,
        environment.backendUrl
      )
    );
    const siteUrl = this.normalizeSiteUrl(
      this.pickFirstString(
        query['siteurl'],
        query['SITE_URL'],
        runtime['siteurl'],
        runtime['SITE_URL'],
        stored?.siteUrl,
        environment.siteUrl
      )
    );
    const allowedOrigins = this.normalizeAllowedOrigins(
      this.pickFirstOrigins(
        query['allowedorigins'],
        query['ALLOWED_ORIGINS'],
        query['allowed_origins'],
        runtime['allowedorigins'],
        runtime['ALLOWED_ORIGINS'],
        runtime['allowed_origins'],
        stored?.allowedOrigins,
        environment.allowedOrigins
      ),
      { backendUrl, siteUrl }
    );

    const merged: RuntimeConfig = {
      backendUrl,
      siteUrl,
      allowedOrigins,
      baseToken: this.pickFirstString(
        query['basetocken'],
        query['token'],
        runtime['basetocken'],
        runtime['BASETOCKEN'],
        stored?.baseToken,
        environment.baseToken
      ),
      useProxy: this.pickFirstBoolean(
        query['useproxy'],
        runtime['useproxy'],
        stored?.useProxy,
        environment.useProxy,
        true
      ),
      sessionCacheTtlMs: this.normalizeSessionCacheTtlMs(
        this.pickFirstNumber(
          query['sessioncachettlms'],
          query['SESSION_CACHE_TTL_MS'],
          runtime['sessioncachettlms'],
          runtime['SESSION_CACHE_TTL_MS'],
          stored?.sessionCacheTtlMs,
          environment.sessionCacheTtlMs,
          30000
        )
      ),
      authMode: this.normalizeAuthMode(
        this.pickFirstString(
          query['authmode'],
          query['AUTH_MODE'],
          runtime['authmode'],
          runtime['AUTH_MODE'],
          stored?.authMode,
          environment.authMode,
          'none'
        )
      ),
      authLoginPath: this.normalizeEndpointPath(
        this.pickFirstString(
          query['authloginpath'],
          query['AUTH_LOGIN_PATH'],
          runtime['authloginpath'],
          runtime['AUTH_LOGIN_PATH'],
          stored?.authLoginPath,
          environment.authLoginPath,
          '/login'
        ),
        '/login'
      ),
      authLogoutPath: this.normalizeEndpointPath(
        this.pickFirstString(
          query['authlogoutpath'],
          query['AUTH_LOGOUT_PATH'],
          runtime['authlogoutpath'],
          runtime['AUTH_LOGOUT_PATH'],
          stored?.authLogoutPath,
          environment.authLogoutPath,
          '/logout'
        ),
        '/logout'
      ),
      authRefreshPath: this.normalizeEndpointPath(
        this.pickFirstString(
          query['authrefreshpath'],
          query['AUTH_REFRESH_PATH'],
          runtime['authrefreshpath'],
          runtime['AUTH_REFRESH_PATH'],
          stored?.authRefreshPath,
          environment.authRefreshPath,
          '/refresh'
        ),
        '/refresh'
      ),
      appCode: this.pickFirstString(
        query['app_code'],
        query['APP_CODE'],
        runtime['app_code'],
        runtime['APP_CODE'],
        stored?.appCode,
        environment.appCode
      )
    };

    this.persist(merged);
    return merged;
  }

  private normalizeBackendUrl(value: string): string {
    return String(value ?? '').trim().replace(/\/+$/, '');
  }

  private normalizeSiteUrl(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  private normalizeAuthMode(_value: string): RuntimeAuthMode {
    return 'keycloak';
  }

  private normalizeSessionCacheTtlMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 30000;
    return Math.floor(parsed);
  }

  private normalizeEndpointPath(value: string, fallback: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    if (/^https?:\/\//i.test(raw)) {
      return raw.replace(/\/+$/, '');
    }
    if (raw === '/api') return raw;
    if (raw.startsWith('/api/')) return raw.replace(/\/+$/, '');
    return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  }

  private normalizeAllowedOrigins(value: unknown, context: { backendUrl?: string; siteUrl?: string } = {}): string[] {
    const list = this.normalizeOriginCandidates(value);
    const backendOrigin = this.extractOrigin(context.backendUrl ?? this.config?.backendUrl ?? '');
    const siteOrigin = this.extractOrigin(context.siteUrl ?? this.config?.siteUrl ?? '');
    const currentOrigin = typeof window !== 'undefined' ? this.extractOrigin(window.location.origin) : '';
    return this.uniqueNonEmpty([currentOrigin, siteOrigin, backendOrigin, ...list]);
  }

  private pickFirstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) return normalized;
      }
    }
    return '';
  }

  private pickFirstOrigins(...values: unknown[]): unknown {
    for (const value of values) {
      if (Array.isArray(value) && value.length > 0) return value;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return [];
  }

  private pickFirstNumber(...values: unknown[]): number {
    for (const value of values) {
      if (typeof value === 'string' && !value.trim()) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 30000;
  }

  private pickFirstBoolean(...values: unknown[]): boolean {
    for (const value of values) {
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
    }
    return true;
  }

  private readStored(): Partial<RuntimeConfig> | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
      const backendUrl = this.normalizeBackendUrl(String(parsed.backendUrl ?? ''));
      const siteUrl = this.normalizeSiteUrl(String(parsed.siteUrl ?? ''));
      const out: Partial<RuntimeConfig> = {
        backendUrl,
        siteUrl,
        allowedOrigins: this.normalizeAllowedOrigins(parsed.allowedOrigins ?? [], { backendUrl, siteUrl }),
        baseToken: String(parsed.baseToken ?? ''),
        sessionCacheTtlMs: this.normalizeSessionCacheTtlMs(parsed.sessionCacheTtlMs ?? 30000),
        authMode: this.normalizeAuthMode(String(parsed.authMode ?? 'keycloak')),
        authLoginPath: this.normalizeEndpointPath(String(parsed.authLoginPath ?? '/api/login'), '/api/login'),
        authLogoutPath: this.normalizeEndpointPath(String(parsed.authLogoutPath ?? '/api/logout'), '/api/logout'),
        authRefreshPath: this.normalizeEndpointPath(String(parsed.authRefreshPath ?? '/api/auth/refresh'), '/api/auth/refresh'),
        appCode: String(parsed.appCode ?? '').trim()
      };
      if (typeof parsed.useProxy === 'boolean') {
        out.useProxy = parsed.useProxy;
      }
      return out;
    } catch {
      return null;
    }
  }

  private persist(config: RuntimeConfig): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  private readQuery(): Record<string, string> {
    if (typeof window === 'undefined') {
      return {};
    }
    const params = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  private normalizeOriginCandidates(value: unknown): string[] {
    const entries = this.valueToArray(value);
    return this.uniqueNonEmpty(entries.map((entry) => this.extractOrigin(String(entry ?? '').trim())));
  }

  private valueToArray(value: unknown): string[] {
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
        // Keep fallback split path below.
      }
    }
    return text.split(/[,\s;]+/).map((entry) => entry.trim()).filter(Boolean);
  }

  private extractOrigin(value: string): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      return parsed.origin;
    } catch {
      return '';
    }
  }

  private uniqueNonEmpty(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach((value) => {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }
}
