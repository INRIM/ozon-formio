import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Formio } from '@formio/js';
import { ImportRecordPayload } from '../models/app.types';
import {
    ApiErrorPayload,
    FastSearchPayload,
    ListRequestPayload,
    ListStreamResult,
    RemoteSelectRequestPayload,
    RuntimeConfig
} from '../models/ozon.types';
import { RuntimeConfigService } from './runtime-config.service';
import {
    parseJsonOrText,
    parseNonNegativeInt,
    isRecord
} from './utils';
import { ApiError, createApiError as buildApiError } from './url.service';

export interface GetSessionOptions {
    force?: boolean;
    maxAgeMs?: number;
}

export interface FastSearchSessionPayload {
    form: Record<string, unknown>;
    fast_serch_model: string;
    data_model: string;
    query_fields: Record<string, unknown>[];
}

@Injectable({ providedIn: 'root' })
export class OzonApiService {
    private static readonly FORMIO_AUTH_PLUGIN_NAME = 'ozon-formio-auth-headers';
    private static readonly FORMIO_RESOURCE_PLUGIN_NAME = 'ozon-formio-resource-rewrite';
    private static formioAuthPluginRegistered = false;
    private static formioResourcePluginRegistered = false;
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

    getSchemaModel(model: string): Promise<unknown> {
        return this.fetchJson(`/record/${encodeURIComponent(String(model).trim())}`);
    }

    storeSearchQuery(model: string, query: Record<string, unknown>): Promise<unknown> {
        return this.fetchJson(`/data/search/${encodeURIComponent(String(model).trim())}`, { method: 'POST', body: query });
    }

    persistFastSearchSession(payload: FastSearchSessionPayload): Promise<unknown> {
        return this.fetchJson('/data/fast_search_eval', { method: 'POST', body: payload });
    }

    importData(model: string, payload: ImportRecordPayload): Promise<unknown> {
        return this.fetchJson(`/import/${encodeURIComponent(String(model).trim())}`, { method: 'POST', body: payload });
    }

    importClean(model: string): Promise<unknown> {
        return this.fetchJson(`/import/clean/${encodeURIComponent(String(model).trim())}`, { method: 'POST', body: {} });
    }

    getExportData(model: string, payload: Record<string, unknown>, parent = ''): Promise<unknown> {
        const normalizedModel = encodeURIComponent(String(model).trim());
        return this.fetchJson(this.withParent(`/export_data/${normalizedModel}`, parent), { method: 'POST', body: payload });
    }

    getResourceData(
        model: string,
        options: { fields?: string[]; domainFromSession?: boolean; domain?: Record<string, unknown> } = {}
    ): Promise<unknown> {
        const params = new URLSearchParams();
        if (Array.isArray(options.fields) && options.fields.length) params.set('fields', options.fields.join(','));
        if (options.domainFromSession) params.set('domain_from_session', 'true');
        if (options.domain && Object.keys(options.domain).length) params.set('domain', JSON.stringify(options.domain));
        const query = params.toString();
        const path = `/resource/data/${encodeURIComponent(String(model).trim())}`;
        return this.fetchJson(query ? `${path}?${query}` : path);
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
            return { content: { mode: 'redirect', next_action_url: location }, fail: false, message: '' };
        }

        const bodyText = await response.text();
        if (!response.ok) throw this.createApiError(response.status, this.parseJsonOrText(bodyText), bodyText);

        const parsed = this.parseJsonOrText(bodyText);
        // Some runtimes auto-follow redirects; if body is not a ResponseObject, synthesize a redirect.
        if (response.redirected && response.url) {
            const finalPath = this.pathFromAbsoluteUrl(response.url);
            if (finalPath && (!this.isRecord(parsed) || !this.isRecord((parsed as Record<string, unknown>)['content']))) {
                return { content: { mode: 'redirect', next_action_url: finalPath }, fail: false, message: '' };
            }
        }
        return this.normalizeResponsePayload(parsed);
    }

    private async fetchAction(path: string): Promise<unknown> {
        const response = await this.fetchRaw(path, { redirect: 'manual' });
        const location = this.readLocationHeader(response.headers);
        if (location && this.isRedirectStatus(response.status)) {
            return { content: { mode: 'redirect', next_action_url: location }, fail: false, message: '' };
        }

        const bodyText = await response.text();
        if (!response.ok) throw this.createApiError(response.status, this.parseJsonOrText(bodyText), bodyText);

        const parsed = this.parseJsonOrText(bodyText);
        // Some runtimes auto-follow redirects; if body is not a ResponseObject, synthesize a redirect.
        if (response.redirected && response.url) {
            const finalPath = this.pathFromAbsoluteUrl(response.url);
            if (finalPath && (!this.isRecord(parsed) || !this.isRecord((parsed as Record<string, unknown>)['content']))) {
                return { content: { mode: 'redirect', next_action_url: finalPath }, fail: false, message: '' };
            }
        }
        return this.normalizeResponsePayload(parsed);
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

    async filterFastSearch(actionName: string, payload: FastSearchPayload, onItem: (i: unknown) => void, onMeta?: (meta: Omit<ListStreamResult, 'count' | 'contentType'>) => void): Promise<ListStreamResult> {
        const path = `/filter/fast_search/${encodeURIComponent(String(actionName).trim())}`;
        return this.streamListWithPayload('', payload as unknown as ListRequestPayload, onItem, onMeta, path);
    }

    async streamList(
        m: string,
        p: ListRequestPayload,
        onItem: (i: unknown) => void,
        onMeta?: (meta: Omit<ListStreamResult, 'count' | 'contentType'>) => void,
        options: { stream?: boolean } = {}
    ): Promise<{ result: ListStreamResult; payloadLabel: string; retries: number }> {
        const c = this.buildListPayloadCandidates(p);
        for (let i = 0; i < c.length; i++) {
            try {
                const r = await this.streamListWithPayload(m, c[i].payload, onItem, onMeta, this.buildListPath(m, options));
                return { result: r, payloadLabel: c[i].label, retries: i };
            } catch (e) {
                if (!(e instanceof ApiError) || e.status !== 422 || i === c.length - 1) throw e;
            }
        }
        throw new Error('Fallback failed');
    }

    private buildListPath(model: string, options: { stream?: boolean } = {}): string {
        const path = `/list/${encodeURIComponent(model)}`;
        if (options.stream === false) return `${path}?stream=False`;
        return path;
    }

    private async streamListWithPayload(m: string, p: ListRequestPayload | Record<string, unknown>, onItem: (i: unknown) => void, onMeta?: (meta: any) => void, pathOverride?: string): Promise<ListStreamResult> {
        const path = pathOverride ?? `/list/${encodeURIComponent(m)}`;
        const res = await this.fetchRaw(path, {
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
        if (!OzonApiService.formioAuthPluginRegistered) {
            Formio.registerPlugin({
                priority: 1000,
                preRequest: (args: any) => { this.attachTokenToFormioRequest(args); return Promise.resolve(args); }
            } as any, OzonApiService.FORMIO_AUTH_PLUGIN_NAME);
            OzonApiService.formioAuthPluginRegistered = true;
        }

        if (!OzonApiService.formioResourcePluginRegistered) {
            Formio.registerPlugin({
                priority: 999,
                preRequest: (args: any) => { this.rewriteFormioBuilderResourceUrl(args); return Promise.resolve(args); },
                wrapRequestPromise: (promise: Promise<any>, args: any) => {
                    if (!args._ozonBuilderRewrite) return promise;
                    return promise.then((data: any) => this.unwrapFormioBuilderRewriteResponse(data, args)).catch(() => []);
                },
                wrapStaticRequestPromise: (promise: Promise<any>, args: any) => {
                    if (!args._ozonBuilderRewrite) return promise;
                    return promise.then((data: any) => this.unwrapFormioBuilderRewriteResponse(data, args)).catch(() => []);
                }
            } as any, OzonApiService.FORMIO_RESOURCE_PLUGIN_NAME);
            OzonApiService.formioResourcePluginRegistered = true;
        }
    }

    private rewriteFormioBuilderResourceUrl(args: any): void {
        const rawUrl = String(args?.url ?? '');
        if (!rawUrl || rawUrl.includes('__ozon_remote__')) return;
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const urlObj = new URL(rawUrl, origin || 'http://localhost');
            const pathname = urlObj.pathname;
            const sp = urlObj.searchParams;

            const toAbsolutePost = (path: string) => {
                const url = this.buildEndpointUrl(path);
                return url.startsWith('http') ? url : `${origin}${url}`;
            };

            const applyPost = (url: string, payload: Record<string, unknown>, rewrite: string) => {
                args.url = url;
                args.method = 'POST';
                args.data = this.normalizeFormioRequestPayload(payload);
                args.opts = args.opts || {};
                args.opts.method = 'POST';
                delete args.opts.body;
                args._ozonBuilderRewrite = rewrite;
            };

            const basePayload = () => ({
                order: '',
                skip: parseInt(sp.get('skip') ?? '0', 10) || 0,
                limit: parseInt(sp.get('limit') ?? '100', 10) || 100,
                stream: false
            });

            // /…/form?type=resource → POST {proxy}/list/component {query:{type:'resource'}}
            if (pathname.endsWith('/form') && sp.get('type') === 'resource') {
                applyPost(toAbsolutePost('/list/component?stream=false'), { ...basePayload(), query: { type: 'resource' } }, 'list');
                return;
            }

            // /…/form/{model}/submission?… → POST {proxy}/list/{model}
            const mSub = pathname.match(/\/form\/([^/]+)\/submission$/);
            if (mSub) {
                applyPost(toAbsolutePost(`/list/${mSub[1]}?stream=false`), { ...basePayload(), query: {} }, 'submission');
                return;
            }

            // /…/form/{model}?… → POST {proxy}/list/{model}
            const mForm = pathname.match(/\/form\/([^/]+)$/);
            if (mForm) {
                applyPost(toAbsolutePost(`/list/${mForm[1]}?stream=false`), { ...basePayload(), query: {} }, 'submission');
                return;
            }
        } catch { }
    }

    private attachTokenToFormioRequest(args: any): void {
        let url = String(args?.url ?? '');
        const normalizedArgsData = this.normalizeFormioRequestPayload(args?.data);
        if (normalizedArgsData !== undefined) {
            args.data = normalizedArgsData;
        }

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
                    const normalizedPayload = this.normalizeFormioRequestPayload(reg.payload);
                    args.method = args.opts.method = 'POST';
                    args.data = normalizedPayload;
                    delete args.opts.body;
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

    private normalizeFormioRequestPayload(payload: unknown): unknown {
        if (typeof payload !== 'string') return payload;
        const normalized = payload.trim();
        if (!normalized) return payload;
        try {
            return JSON.parse(normalized);
        } catch {
            return payload;
        }
    }

    private unwrapFormioBuilderRewriteResponse(data: unknown, args?: any): unknown[] {
        if (Array.isArray(data)) return data;
        const content = this.extractResponseContent(data);
        if (Array.isArray(content)) return content;
        const list = this.normalizeRecordList(data);
        if (!Array.isArray(list)) return [];
        if (args?._ozonBuilderRewrite === 'list') {
            return list.map(item => this.normalizeFormioBuilderResourceItem(item));
        }
        return list;
    }

    private normalizeFormioBuilderResourceItem(item: unknown): unknown {
        if (!this.isRecord(item)) return item;
        const normalized = { ...item };
        const id = this.firstNonEmptyString(normalized['rec_name'], normalized['name'], normalized['id'], normalized['_id']);
        const label = this.firstNonEmptyString(normalized['label'], normalized['title'], normalized['name'], normalized['rec_name'], id);
        const components = this.extractFormioBuilderResourceComponents(normalized);

        if (id) {
            normalized['id'] = id;
            normalized['_id'] = id;
            if (!this.firstNonEmptyString(normalized['rec_name'])) normalized['rec_name'] = id;
            if (!this.firstNonEmptyString(normalized['name'])) normalized['name'] = id;
        }
        if (label) {
            normalized['label'] = label;
            if (!this.firstNonEmptyString(normalized['title'])) normalized['title'] = label;
        }
        if (components && !Array.isArray(normalized['components'])) normalized['components'] = components;
        return normalized;
    }

    private extractFormioBuilderResourceComponents(item: Record<string, unknown>): unknown[] | null {
        const directComponents = item['components'];
        if (Array.isArray(directComponents)) return directComponents;
        const nestedRecords = [
            item['schema'],
            item['formio'],
            this.isRecord(item['data']) ? item['data']['schema'] : null,
            this.isRecord(item['data']) ? item['data']['formio'] : null
        ];
        for (const candidate of nestedRecords) {
            if (!this.isRecord(candidate)) continue;
            const components = candidate['components'];
            if (Array.isArray(components)) return components as unknown[];
        }
        return null;
    }

    private firstNonEmptyString(...values: unknown[]): string {
        for (const value of values) {
            const normalized = String(value ?? '').trim();
            if (normalized) return normalized;
        }
        return '';
    }

    private normalizeResponsePayload(payload: unknown): unknown {
        if (!this.isRecord(payload)) return payload;
        if (this.isRecord(payload['content'])) {
            return {
                ...payload,
                content: this.normalizeResponseContent(payload['content'])
            };
        }
        if (typeof payload['mode'] === 'string' && String(payload['mode']).trim()) {
            return {
                content: this.normalizeResponseContent(payload),
                fail: false,
                message: ''
            };
        }
        return payload;
    }

    private normalizeResponseContent(content: Record<string, unknown>): Record<string, unknown> {
        const mode = String(content['mode'] ?? '').trim().toLowerCase();
        if (mode !== 'redirect') return content;
        const data = this.isRecord(content['data']) ? content['data'] : null;
        const nextActionUrl = this.firstNonEmptyString(
            content['next_action_url'],
            content['nextActionUrl'],
            content['next_page'],
            content['nextPage'],
            content['next_path'],
            content['nextPath'],
            data?.['next_action_url'],
            data?.['nextActionUrl'],
            data?.['next_page'],
            data?.['nextPage'],
            data?.['next_path'],
            data?.['nextPath'],
            data?.['path'],
            data?.['url'],
            data?.['location']
        );
        if (!nextActionUrl || nextActionUrl === this.firstNonEmptyString(content['next_action_url'])) return content;
        return { ...content, next_action_url: nextActionUrl };
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

    async downloadAttachment(fileUrl: string, filename = ''): Promise<void> {
        const raw = String(fileUrl ?? '').trim();
        if (!raw) throw new Error('URL allegato mancante');
        const path = this.normalizeAttachmentPath(raw);
        const response = await this.fetchRaw(path, { method: 'GET', redirect: 'follow' });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) this.unauthorizedSubject.next();
            throw new Error(`Download fallito (${response.status})`);
        }
        const blob = await response.blob();
        this.triggerBlobDownload(blob, filename || this.filenameFromPath(raw));
    }

    /**
     * `fileUrl` here is whatever is in the `data-file-url` attribute of the clicked download link —
     * that's `file.url` straight from the submission data, which is usually already a fully
     * resolved `/api/client/attachment/...?app_code=...` URL (normalized by
     * AppFormioRendererService on load). The old version of this method only recognized
     * `/client/attachment` (no `/api`, no trailing slash) as "already a path", so a normalized
     * value fell through to the generic branch and got `/client/attachment/` re-prepended onto
     * itself — including its own `?app_code=...` query string, which then got a *second*
     * `app_code` appended by buildEndpointUrl on top, since by then it was fused into the path
     * rather than recognized as a query string. Strip any query and collapse repeats of the
     * attachment prefix (handles both `api/client/attachment/` and `client/attachment/`, and any
     * number of times a prior bug may have doubled it in already-stored data) so this always
     * rebuilds a single canonical path, regardless of what shape the input arrives in.
     */
    private normalizeAttachmentPath(value: string): string {
        const raw = String(value ?? '').trim();
        const queryIndex = raw.indexOf('?');
        const pathOnly = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
        let bare = pathOnly.replace(/^\/+/, '');
        let strippedPrefix = true;
        while (strippedPrefix) {
            strippedPrefix = false;
            if (bare.startsWith('api/client/attachment/')) {
                bare = bare.slice('api/client/attachment/'.length);
                strippedPrefix = true;
            } else if (bare.startsWith('client/attachment/')) {
                bare = bare.slice('client/attachment/'.length);
                strippedPrefix = true;
            }
        }
        return `/client/attachment/${bare}`;
    }

    private filenameFromPath(path: string): string {
        const segment = String(path ?? '').split('?')[0].split('/').filter(Boolean).pop() ?? '';
        try { return decodeURIComponent(segment) || 'download'; } catch { return segment || 'download'; }
    }

    private triggerBlobDownload(blob: Blob, filename: string): void {
        if (typeof document === 'undefined' || typeof URL === 'undefined') return;
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename || 'download';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    private async fetchJson(path: string, opt?: any): Promise<any> {
        const r = await this.fetchRaw(path, opt);
        const t = await r.text();
        if (!r.ok) {
            if (r.status === 401 || r.status === 403) this.unauthorizedSubject.next();
            throw this.createApiError(r.status, this.parseJsonOrText(t), t);
        }
        return this.normalizeResponsePayload(this.parseJsonOrText(t));
    }

    private async fetchRaw(path: string, opt?: any): Promise<Response> {
        let url = this.buildEndpointUrl(path), h = this.buildHeaders(opt?.headers);
        const method = String(opt?.method || 'GET').toUpperCase();
        const init: RequestInit = { method, headers: h, credentials: 'include' };
        const explicitRedirect = opt?.redirect as RequestRedirect | undefined;
        init.redirect = explicitRedirect ?? 'manual';
        const body = this.serializeRequestBody(opt?.body);
        if (body) {
            if (body.isJson) h.set('Content-Type', 'application/json');
            init.body = body.value;
        }
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

    private serializeRequestBody(body: unknown): { value: BodyInit; isJson: boolean } | null {
        if (body == null) return null;
        if (typeof body === 'string') return { value: body, isJson: true };
        if (typeof FormData !== 'undefined' && body instanceof FormData) return { value: body, isJson: false };
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { value: body, isJson: false };
        if (typeof Blob !== 'undefined' && body instanceof Blob) return { value: body, isJson: false };
        return { value: JSON.stringify(body), isJson: true };
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
        const isProxyPath = rawPath === '/api' || rawPath.startsWith('/api/');
        const base = cfg.useProxy ? '/api' : cfg.backendUrl.replace(/\/+$/, '');
        let url = isProxyPath ? rawPath : `${base}${rawPath}`;
        const appCode = cfg.appCode?.trim();
        if (appCode) {
            url += (url.includes('?') ? '&' : '?') + 'app_code=' + encodeURIComponent(appCode);
        }
        return url;
    }

    private withParent(path: string, parent: string): string {
        const normalizedParent = String(parent ?? '').trim();
        if (!normalizedParent) return path;
        const query = new URLSearchParams({ parent: normalizedParent });
        return `${path}?${query.toString()}`;
    }

    private parseJsonOrText(t: string): any { try { return JSON.parse(t); } catch { return t; } }
    private createApiError(s: number, p: any, t: string): ApiError { return buildApiError(s, p, t); }
    private isRecord(v: any): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
}
