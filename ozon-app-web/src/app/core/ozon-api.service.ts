import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Formio } from '@formio/js';
import {
    ApiErrorPayload,
    ListRequestPayload,
    ListStreamResult,
    RemoteSelectRequestPayload,
    RuntimeConfig
} from '../models/ozon.types';
import { RuntimeConfigService } from './runtime-config.service';
import {
    ApiError,
    parseJsonOrText,
    parseNonNegativeInt,
    isRecord,
    createApiError
} from './utils';

class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly detail: unknown,
        readonly payload: unknown
    ) {
        super(`Errore API ${status}${detail ? `: ${ApiError.stringifyDetail(detail)}` : ''}`);
        this.name = 'ApiError';
    }

    private static stringifyDetail(detail: unknown): string {
        if (typeof detail === 'string') return detail;
        try { return JSON.stringify(detail); } catch { return String(detail); }
    }
}

export interface GetSessionOptions {
    force?: boolean;
    maxAgeMs?: number;
}

@Injectable({ providedIn: 'root' })
export class OzonApiService {
    private static readonly FORMIO_AUTH_PLUGIN_NAME = 'ozon-formio-auth-headers';
    private static formioAuthPluginRegistered = false;
    private static readonly DEFAULT_SESSION_CACHE_TTL_MS = 30000;

    private readonly unauthorizedSubject = new Subject<void>();
    readonly unauthorized$ = this.unauthorizedSubject.asObservable();

    private remotePayloads = new Map<string, { payload: any; headers: Record<string, string> }>();
    private sessionRequestInFlight: Promise<unknown> | null = null;
    private lastSessionPayload: unknown = null;
    private lastSessionFetchedAt = 0;
    private hasSessionCache = false;

    constructor(private readonly runtimeConfig: RuntimeConfigService) {
        this.configureFormioSdk();
    }

    getRuntimeConfig(): RuntimeConfig { return this.runtimeConfig.getConfig(); }
    updateRuntimeConfig(p: Partial<RuntimeConfig>): RuntimeConfig {
        const u = this.runtimeConfig.updateConfig(p);
        this.clearSessionCache();
        this.configureFormioSdk(u);
        return u;
    }

    registerRemoteSelectPayload(id: string, payload: any, headers: Record<string, string>): void {
        this.remotePayloads.set(id, { payload, headers });
    }

    async getModels(): Promise<string[]> {
        const p = await this.fetchJson('/models/distinct', { method: 'POST', body: {} });
        let target: any = p;
        if (this.isRecord(p) && this.isRecord(p['content'])) target = p['content']['data'] ?? p['content'];
        if (Array.isArray(target)) return target.map(e => String(e));
        if (this.isRecord(target) && Array.isArray(target['data'])) return target['data'].map((e: any) => String(e));
        if (this.isRecord(target) && Array.isArray(target['models'])) return target['models'].map((e: any) => String(e));
        if (this.isRecord(target) && this.isRecord(target['data']) && Array.isArray(target['data']['models'])) {
            return target['data']['models'].map((e: any) => String(e));
        }
        return [];
    }

    getSession(options: GetSessionOptions = {}): Promise<unknown> {
        const maxAgeMs = this.resolveSessionCacheTtlMs(options.maxAgeMs);
        if (!options.force && this.hasSessionCache && (Date.now() - this.lastSessionFetchedAt) < maxAgeMs) {
            return Promise.resolve(this.lastSessionPayload);
        }
        if (this.sessionRequestInFlight) {
            return this.sessionRequestInFlight;
        }

        this.sessionRequestInFlight = this.fetchJson('/get_session')
            .then((payload) => {
                this.lastSessionPayload = payload;
                this.lastSessionFetchedAt = Date.now();
                this.hasSessionCache = true;
                return payload;
            })
            .catch((error) => {
                this.clearSessionCache();
                throw error;
            })
            .finally(() => {
                this.sessionRequestInFlight = null;
            });
        return this.sessionRequestInFlight;
    }

    clearSessionCache(): void {
        this.sessionRequestInFlight = null;
        this.lastSessionPayload = null;
        this.lastSessionFetchedAt = 0;
        this.hasSessionCache = false;
    }

    resolveApiUrl(path: string): string {
        return this.buildEndpointUrl(path);
    }

    getRecordSchema(m: string): Promise<unknown> { return this.fetchJson(`/record/${encodeURIComponent(m)}`); }
    getRecord(m: string, r: string): Promise<unknown> { return this.fetchJson(`/record/${encodeURIComponent(m)}/${encodeURIComponent(r)}`); }
    updateRecord(m: string, r: string, payload: Record<string, unknown>): Promise<unknown> {
        return this.fetchJson(`/record/${encodeURIComponent(m)}/${encodeURIComponent(r)}`, { method: 'POST', body: payload });
    }

    getRemoteSelect(p: RemoteSelectRequestPayload): Promise<unknown> {
        return this.fetchJson('/get_remote_select', { method: 'POST', body: p });
    }

    getActionLayout(name = ''): Promise<unknown> {
        const normalized = String(name ?? '').trim();
        const path = normalized ? `/action/layout/${encodeURIComponent(normalized)}` : '/action/layout';
        return this.fetchJson(path);
    }

    getActionMenu(parent = ''): Promise<unknown> {
        const normalized = String(parent ?? '').trim();
        const path = normalized ? `/action/menu/${encodeURIComponent(normalized)}` : '/action/menu';
        return this.fetchJson(path);
    }

    getActionDashboard(parent = ''): Promise<unknown> {
        const normalized = String(parent ?? '').trim();
        const path = normalized ? `/action/dashboard/${encodeURIComponent(normalized)}` : '/action/dashboard';
        return this.fetchJson(path);
    }

    getAction(
        name: string,
        options: { recName?: string; query?: Record<string, unknown>; order?: string; skip?: number; limit?: number } = {}
    ): Promise<unknown> {
        const actionName = encodeURIComponent(String(name ?? '').trim());
        const recName = String(options.recName ?? '').trim();
        const path = recName
            ? `/action/${actionName}/${encodeURIComponent(recName)}`
            : `/action/${actionName}`;

        const params = new URLSearchParams();
        params.set('query', JSON.stringify(options.query ?? {}));
        if (options.order && String(options.order).trim()) params.set('order', String(options.order).trim());
        if (Number.isFinite(Number(options.skip))) params.set('skip', String(Math.max(0, Number(options.skip))));
        if (Number.isFinite(Number(options.limit))) params.set('limit', String(Math.max(0, Number(options.limit))));

        const query = params.toString();
        return this.fetchAction(query ? `${path}?${query}` : path);
    }

    async getNextAction(currentAction: string, recName = ''): Promise<unknown> {
        const action = encodeURIComponent(String(currentAction ?? '').trim());
        const rec = String(recName ?? '').trim();
        if (!action) throw new Error('current_action mancante');

        const canonicalPath = rec
            ? `/action/next_action/${action}/${encodeURIComponent(rec)}`
            : `/action/next_action/${action}`;
        try {
            return await this.fetchNextAction(canonicalPath);
        } catch (error) {
            const status = Number((error as { status?: number })?.status ?? 0);
            if (status !== 404) throw error;
            const typoPath = rec
                ? `/actoin/next_action/${action}/${encodeURIComponent(rec)}`
                : `/actoin/next_action/${action}`;
            return this.fetchNextAction(typoPath);
        }
    }

    private async fetchNextAction(path: string): Promise<unknown> {
        const response = await this.fetchRaw(path, { redirect: 'manual' });
        const location = this.readLocationHeader(response.headers);
        if (location && this.isRedirectStatus(response.status)) {
            return {
                mode: 'action',
                data: {
                    redirect: location,
                    redirect_status: response.status
                }
            };
        }

        const bodyText = await response.text();
        if (!response.ok) throw this.createApiError(response.status, this.parseJsonOrText(bodyText), bodyText);

        const parsed = this.parseJsonOrText(bodyText);
        // Some runtimes may still auto-follow redirects; preserve final URL as explicit redirect hint.
        if (response.redirected && response.url) {
            const finalPath = this.pathFromAbsoluteUrl(response.url);
            if (finalPath) {
                return {
                    mode: 'action',
                    data: {
                        redirect: finalPath
                    },
                    content: parsed
                };
            }
        }
        return parsed;
    }

    private async fetchAction(path: string): Promise<unknown> {
        const response = await this.fetchRaw(path, { redirect: 'manual' });
        const location = this.readLocationHeader(response.headers);
        if (location && this.isRedirectStatus(response.status)) {
            return {
                mode: 'action',
                data: {
                    redirect: location,
                    redirect_status: response.status
                }
            };
        }

        const bodyText = await response.text();
        if (!response.ok) throw this.createApiError(response.status, this.parseJsonOrText(bodyText), bodyText);

        const parsed = this.parseJsonOrText(bodyText);
        // Some runtimes may still auto-follow redirects; preserve final URL as explicit redirect hint.
        if (response.redirected && response.url) {
            const finalPath = this.pathFromAbsoluteUrl(response.url);
            if (finalPath) {
                return {
                    mode: 'action',
                    data: {
                        redirect: finalPath
                    },
                    content: parsed
                };
            }
        }
        return parsed;
    }

    postAction(name: string, payload: Record<string, unknown>, recName = ''): Promise<unknown> {
        const actionName = encodeURIComponent(String(name ?? '').trim());
        const normalizedRec = String(recName ?? '').trim();
        const path = normalizedRec
            ? `/action/${actionName}/${encodeURIComponent(normalizedRec)}`
            : `/action/${actionName}`;
        return this.fetchJson(path, { method: 'POST', body: payload });
    }

    postActionPath(path: string, payload: Record<string, unknown>): Promise<unknown> {
        const normalized = String(path ?? '').trim();
        if (!normalized) throw new Error('path action mancante');
        const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
        return this.fetchJson(prefixed, { method: 'POST', body: payload });
    }

    deleteAction(name: string, recName: string, payload: Record<string, unknown> = {}): Promise<unknown> {
        const actionName = encodeURIComponent(String(name ?? '').trim());
        const normalizedRec = encodeURIComponent(String(recName ?? '').trim());
        return this.fetchJson(`/action/${actionName}/${normalizedRec}`, { method: 'DELETE', body: payload });
    }

    async streamList(m: string, p: ListRequestPayload, onItem: (i: unknown) => void, onMeta?: (meta: Omit<ListStreamResult, 'count' | 'contentType'>) => void): Promise<{ result: ListStreamResult; payloadLabel: string; retries: number }> {
        const c = this.buildListPayloadCandidates(p);
        for (let i = 0; i < c.length; i++) {
            try {
                const r = await this.streamListWithPayload(m, c[i].payload, onItem, onMeta);
                return { result: r, payloadLabel: c[i].label, retries: i };
            } catch (e) {
                if (!(e instanceof ApiError) || e.status !== 422 || i === c.length - 1) throw e;
            }
        }
        throw new Error('Fallback failed');
    }

    private async streamListWithPayload(m: string, p: ListRequestPayload, onItem: (i: unknown) => void, onMeta?: (meta: any) => void): Promise<ListStreamResult> {
        const res = await this.fetchRaw(`/list/${encodeURIComponent(m)}`, {
            method: 'POST',
            body: p,
            headers: { Accept: 'application/x-ndjson,application/json' }
        });
        const ct = String(res.headers.get('content-type') ?? '').toLowerCase();
        if (!res.ok) throw this.createApiError(res.status, this.parseJsonOrText(await res.text()), '');

        const meta: any = {
            order: res.headers.get('x-order') || '',
            skip: res.headers.get('x-skip') || '',
            limit: res.headers.get('x-limit') || '',
            totalCount: this.parseNonNegativeInt(res.headers.get('x-total-count'), 0),
            columnsRaw: res.headers.get('x-columns') || '',
            columns: this.parseColumnsHeader(res.headers.get('x-columns') || '')
        };
        const push = () => { if (onMeta) onMeta(meta); };

        let count = 0;
        if (ct.includes('application/x-ndjson')) {
            count = await this.consumeNdjson(res, onItem, (envelope: any) => {
                const envelopeContent = this.extractResponseContent(envelope);
                if (envelopeContent?.columns) { meta.columns = envelopeContent.columns; meta.columnsRaw = JSON.stringify(envelopeContent.columns); }
                const envelopeCount = envelopeContent?.total_count;
                if (Number.isFinite(Number(envelopeCount))) {
                    meta.totalCount = this.parseNonNegativeInt(String(envelopeCount), meta.totalCount);
                }
                push();
            });
        } else {
            const data: any = this.parseJsonOrText(await res.text());
            const envelopeContent = this.extractResponseContent(data);
            if (envelopeContent?.columns) { meta.columns = envelopeContent.columns; meta.columnsRaw = JSON.stringify(envelopeContent.columns); }
            if (Number.isFinite(Number(envelopeContent?.total_count))) {
                meta.totalCount = this.parseNonNegativeInt(String(envelopeContent.total_count), meta.totalCount);
            }
            push();
            const list = this.normalizeRecordList(data);
            list.forEach(onItem);
            count = list.length;
        }
        if (!meta.totalCount) meta.totalCount = count;
        return { count, contentType: ct, ...meta };
    }

    private async consumeNdjson(res: Response, onItem: (i: any) => void, onEnv: (e: any) => void): Promise<number> {
        if (!res.body) return 0;
        const reader = res.body.getReader(), decoder = new TextDecoder();
        let buffer = '', count = 0, first = true;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const l of lines) {
                const item = this.parseNdjsonLine(l);
                if (!item) continue;
                if (first && item.content?.mode) { onEnv(item); first = false; continue; }
                onItem(item); count++;
            }
        }
        return count;
    }

    private parseNdjsonLine(l: string): any {
        const t = l.trim();
        return t ? JSON.parse(t) : null;
    }

    private parseColumnsHeader(raw: string): any {
        try { return JSON.parse(raw); } catch { return null; }
    }

    private parseNonNegativeInt(value: unknown, fallback = 0): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return fallback;
        return Math.floor(parsed);
    }

    private normalizeRecordList(p: any): any[] {
        const t = p?.content?.data ?? p?.content ?? p;
        if (Array.isArray(t)) return t;
        return t?.items ?? t?.records ?? t?.data ?? [];
    }

    private buildListPayloadCandidates(p: any): any[] { return [{ label: 'default', payload: p }]; }

    private extractResponseContent(payload: any): any {
        if (!this.isRecord(payload)) return null;
        if (this.isRecord(payload['content'])) return payload['content'];
        return payload;
    }

    private configureFormioSdk(config: RuntimeConfig = this.runtimeConfig.getConfig()): void {
        const base = config.useProxy ? '/api' : config.backendUrl.replace(/\/+$/, '');
        Formio.setBaseUrl(base);
        Formio.setProjectUrl(base);
        if (OzonApiService.formioAuthPluginRegistered) return;
        Formio.registerPlugin({
            priority: 1000,
            preRequest: (args: any) => { this.attachTokenToFormioRequest(args); return Promise.resolve(args); }
        } as any, OzonApiService.FORMIO_AUTH_PLUGIN_NAME);
        OzonApiService.formioAuthPluginRegistered = true;
    }

    private attachTokenToFormioRequest(args: any): void {
        let url = String(args?.url ?? '');

        args.opts = args.opts || {};
        const headers: Record<string, string> = {};

        const currentHeaders = args.opts.headers || args.headers || {};
        if (typeof currentHeaders.forEach === 'function') {
            currentHeaders.forEach((v: any, k: any) => { headers[k] = v; });
        } else {
            Object.assign(headers, currentHeaders);
        }

        if (url.includes('__ozon_remote__')) {
            try {
                const origin = (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
                const urlObj = new URL(url, origin);
                const reqId = urlObj.searchParams.get('__ozon_id') ?? '';
                const reg = this.remotePayloads.get(reqId);

                if (reg) {
                    args.method = args.opts.method = 'POST';
                    args.data = reg.payload;
                    args.opts.body = JSON.stringify(reg.payload);
                    Object.assign(headers, reg.headers);

                    let path = urlObj.pathname.replace(/.*__ozon_remote__/, '');
                    if (!path.startsWith('/')) path = '/' + path;
                    url = this.buildEndpointUrl(path);
                    args.url = url.startsWith('http') ? url : origin + url;
                }
            } catch (e) { console.error('Interceptor Error:', e); }
        }

        const csrf = this.readCsrfCookie();
        if (csrf) headers['X-CSRF-Token'] = csrf;
        headers['Content-Type'] = 'application/json';
        headers['Accept'] = 'application/json';

        args.opts.headers = headers;
        args.headers = headers;
    }

    private resolveSessionCacheTtlMs(override?: number): number {
        const configured = Number.isFinite(Number(override))
            ? Number(override)
            : Number(this.runtimeConfig.getConfig().sessionCacheTtlMs);
        if (!Number.isFinite(configured) || configured < 0) {
            return OzonApiService.DEFAULT_SESSION_CACHE_TTL_MS;
        }
        return Math.floor(configured);
    }

    private async fetchJson(path: string, opt?: any): Promise<any> {
        const r = await this.fetchRaw(path, opt);
        const t = await r.text();
        if (!r.ok) {
            if (r.status === 401 || r.status === 403) this.unauthorizedSubject.next();
            throw this.createApiError(r.status, this.parseJsonOrText(t), t);
        }
        return this.parseJsonOrText(t);
    }

    private async fetchRaw(path: string, opt?: any): Promise<Response> {
        let url = this.buildEndpointUrl(path), h = this.buildHeaders(opt?.headers);
        const method = String(opt?.method || 'GET').toUpperCase();
        const init: RequestInit = { method, headers: h, credentials: 'include' };
        const explicitRedirect = opt?.redirect as RequestRedirect | undefined;
        init.redirect = explicitRedirect ?? 'manual';
        if (opt?.body) { h.set('Content-Type', 'application/json'); init.body = JSON.stringify(opt.body); }
        let response = await fetch(url, init);
        const shouldFollowInternalRedirects = !explicitRedirect && (method === 'GET' || method === 'HEAD');
        if (!shouldFollowInternalRedirects) return response;

        let redirectCount = 0;
        while (this.isRedirectStatus(response.status) && redirectCount < 6) {
            const location = this.readLocationHeader(response.headers);
            const nextUrl = this.resolveFollowUpUrl(url, location);
            if (!nextUrl) break;
            url = nextUrl;
            response = await fetch(url, { ...init, redirect: 'manual' });
            redirectCount += 1;
        }
        return response;
    }

    private isRedirectStatus(status: number): boolean {
        return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
    }

    private readLocationHeader(headers: Headers): string {
        return headers.get('location') || headers.get('Location') || '';
    }

    private pathFromAbsoluteUrl(url: string): string {
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
            const parsed = new URL(url, origin);
            return `${parsed.pathname}${parsed.search || ''}`;
        } catch {
            return '';
        }
    }

    private buildHeaders(extra?: any): Headers {
        const h = new Headers();
        h.set('Accept', 'application/json');
        if (extra) Object.entries(extra).forEach(([k, v]: any) => h.set(k, v));
        const csrf = this.readCsrfCookie();
        if (csrf) h.set('X-CSRF-Token', csrf);
        return h;
    }

    private readCsrfCookie(): string {
        if (typeof document === 'undefined') return '';
        const match = document.cookie.match(/(?:^|;\s*)ozon_csrf=([^;]*)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    private resolveFollowUpUrl(currentUrl: string, location: string): string {
        if (!location) return '';
        let path = '';
        const trimmed = location.trim();
        if (!trimmed) return '';

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
        if (path.startsWith('/api/')) path = path.slice('/api'.length);
        if (path === '/api') path = '/';
        return this.buildEndpointUrl(path);
    }

    private buildEndpointUrl(p: string): string {
        const cfg = this.runtimeConfig.getConfig();
        const rawPath = String(p ?? '').trim();
        if (!rawPath) {
            return cfg.useProxy ? '/api' : cfg.backendUrl.replace(/\/+$/, '');
        }
        if (/^https?:\/\//i.test(rawPath)) return rawPath.replace(/\/+$/, '');
        if (rawPath === '/api' || rawPath.startsWith('/api/')) return rawPath;
        const base = cfg.useProxy ? '/api' : cfg.backendUrl.replace(/\/+$/, '');
        return `${base}${rawPath}`;
    }

    private parseJsonOrText(t: string): any { try { return JSON.parse(t); } catch { return t; } }
    private createApiError(s: number, p: any, t: string): ApiError { return new ApiError(s, p?.detail || t, p); }
    private isRecord(v: any): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
}
