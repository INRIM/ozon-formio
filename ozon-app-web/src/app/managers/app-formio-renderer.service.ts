import { Injectable } from '@angular/core';
import { eachComponent as formioEachComponent } from '@formio/js/utils';
import { OzonApiService } from '../core/ozon-api.service';
import {
    SelectOptionMappingConfig,
    selectOptionPrimitiveValue,
    toSelectValueOption as mapSelectValueOption
} from '../core/select-option.util';
import { SelectValueOption } from '../models/app.types';
import { ListRequestPayload, RemoteSelectRequestPayload, requireResponseObject } from '../models/ozon.types';

export const OZON_INLINE_ACTION_EVENT = 'ozonInlineAction';

@Injectable()
export class AppFormioRendererService {
    formSchema: Record<string, unknown> | null = null;
    formSubmission: { data: Record<string, unknown> } | null = null;
    formPreviewSubmission: { data: Record<string, unknown> } | null = null;
    rawFormSchema: Record<string, unknown> | null = null;
    rawFormSchemaModel = '';
    formViewerLoading = false;
    formDataReady = true;

    selectedModel = '';
    selectedRecordName = '';
    sessionLocale = 'it';
    sessionTimezone = '';

    pendingHydrationPromise: Promise<void> | null = null;
    private isRefreshingDependentSelects = false;
    private static readonly REMOTE_SELECT_CACHE_TTL_MS = 5 * 60 * 1000;
    private remoteSelectCache = new Map<string, { value: SelectValueOption[]; expiresAt: number }>();
    private remoteSelectInflight = new Map<string, Promise<SelectValueOption[]>>();
    private pendingPostRenderHydration: {
        requestId: number;
        contextId: number;
        submission: Record<string, unknown> | null;
        resolve: () => void;
        reject: (reason?: unknown) => void;
    } | null = null;
    private nextPostRenderHydrationRequestId = 0;
    private activePostRenderHydrationRequestId = 0;
    private activePostRenderHydrationPromise: Promise<void> | null = null;
    private formAsyncContextId = 0;
    constructor(private readonly api: OzonApiService) {}

    isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }

    cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
    }

    readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) { if (typeof entry === 'string' && entry.trim()) return entry.trim(); }
        return '';
    }

    readFirstNumber(...candidates: unknown[]): number | null {
        for (const entry of candidates) {
            if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
            if (typeof entry === 'string') {
                const parsed = Number(entry.trim());
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return null;
    }

    toDisplayValue(v: unknown): string {
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }

    parseJsonMaybe(value: unknown): unknown {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        if (!(raw.startsWith('{') || raw.startsWith('['))) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }

    asRecord(value: unknown): Record<string, unknown> | null {
        if (this.isRecord(value)) return value;
        const parsed = this.parseJsonMaybe(value);
        return this.isRecord(parsed) ? parsed : null;
    }

    stableStringify(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map(e => this.stableStringify(e)).join(',')}]`;
        if (this.isRecord(value)) {
            const entries = Object.entries(value).sort(([l], [r]) => l.localeCompare(r));
            return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`).join(',')}}`;
        }
        return JSON.stringify(value ?? null);
    }

    extractFormSchema(schemaValue: unknown): Record<string, unknown> | null {
        if (Array.isArray(schemaValue)) {
            if (!schemaValue.length) return null;
            return { display: 'form', components: schemaValue };
        }
        if (this.isRecord(schemaValue) && Array.isArray(schemaValue['components'])) return schemaValue as Record<string, unknown>;
        if (typeof schemaValue === 'string') {
            try { return this.extractFormSchema(JSON.parse(schemaValue)); } catch { return null; }
        }
        return null;
    }

    extractSubmission(payload: unknown): { data: Record<string, unknown> } | null {
        const obj = requireResponseObject(payload);
        if (!this.isRecord(obj.content.data)) return null;
        return { data: this.normalizeFormSubmissionData(obj.content.data as Record<string, unknown>) };
    }

    normalizeFormSubmissionData(raw: Record<string, unknown>, schema: Record<string, unknown> | null = null): Record<string, unknown> {
        const normalized: Record<string, unknown> = { ...raw };
        const nestedData = this.asRecord(normalized['data']);
        if (nestedData) {
            Object.entries(nestedData).forEach(([key, value]) => {
                if (value === undefined) return;
                if (Object.prototype.hasOwnProperty.call(normalized, key)) return;
                normalized[key] = value;
            });
        }
        this.normalizeMultipleSubmissionFields(normalized, schema);
        this.normalizeFileSubmissionFields(normalized, schema);
        return normalized;
    }

    normalizeCurrentSubmissionData(schema: Record<string, unknown> | null = null): Record<string, unknown> | null {
        const current = this.formSubmission?.data;
        if (!current || !this.isRecord(current)) return null;
        const normalized = this.normalizeFormSubmissionData({ ...current }, schema);
        this.formSubmission = { data: normalized };
        return normalized;
    }

    async hydrateRemoteSelectSchema(schema: Record<string, unknown>, sub: Record<string, unknown> | null): Promise<Record<string, unknown>> {
        const hydrated = this.cloneSchema(schema);
        const formKey = String(hydrated['key'] || hydrated['name'] || hydrated['path'] || this.selectedModel || '').trim();
        this.normalizeFormTableComponents(hydrated);
        this.normalizeFormWysiwygComponents(hydrated, sub);
        this.normalizeFormContentComponents(hydrated);
        this.normalizeInteractiveSchemaComponents(hydrated);
        this.normalizeFormJsonEditorComponents(hydrated);
        this.stripClobberingDefaultsForSavedValues(hydrated, sub);

        for (const comp of this.findSelectComponents(hydrated)) {
            const resourcePayload = this.extractResourceSelectPayload(comp, formKey);
            if (resourcePayload) {
                try {
                    const resourceOptions = await this.fetchResourceSelectOptions(comp, resourcePayload);
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(resourceOptions, selectedOptions));
                } catch (error) {
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Remote select fetch failed', error);
                }
                this.ensureSelectTemplate(comp);
                continue;
            }

            const payload = this.extractRemoteSelectPayload(comp, formKey);
            if (payload) {
                try {
                    const remoteOptions = await this.fetchRemoteSelectOptions(comp, payload);
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(remoteOptions, selectedOptions));
                } catch (error) {
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Remote select fetch failed', error);
                }
                this.ensureSelectTemplate(comp);
                continue;
            }

            if (String(comp['dataSrc'] ?? '').trim() === 'custom' && sub) {
                const data = this.isRecord(comp['data']) ? comp['data'] : {};
                const customKey = String(data['custom'] ?? '').trim();
                const customValue = customKey ? (sub[customKey] ?? null) : null;
                if (Array.isArray(customValue)) {
                    const options = customValue.map(e => this.toSelectValueOption(e, comp)).filter((e): e is SelectValueOption => Boolean(e));
                    this.applyRemoteSelectValues(comp, options);
                }
            }
            this.ensureSelectTemplate(comp);
        }
        return hydrated;
    }

    /** Sync-only: clone + normalize schema, apply inline/custom selects. Remote selects get empty options. */
    prepareSchemaForRender(schema: Record<string, unknown>, sub: Record<string, unknown> | null): Record<string, unknown> {
        const hydrated = this.cloneSchema(schema);
        const formKey = String(hydrated['key'] || hydrated['name'] || hydrated['path'] || this.selectedModel || '').trim();
        this.normalizeFormTableComponents(hydrated);
        this.normalizeFormWysiwygComponents(hydrated, sub);
        this.normalizeFormContentComponents(hydrated);
        this.normalizeInteractiveSchemaComponents(hydrated);
        this.normalizeFormJsonEditorComponents(hydrated);
        this.stripClobberingDefaultsForSavedValues(hydrated, sub);

        for (const comp of this.findSelectComponents(hydrated)) {
            const resourcePayload = this.extractResourceSelectPayload(comp, formKey);
            if (resourcePayload) {
                this.ensureSelectTemplate(comp);
                continue;
            }
            const payload = this.extractRemoteSelectPayload(comp, formKey);
            if (payload) {
                this.ensureSelectTemplate(comp);
                continue;
            }
            if (String(comp['dataSrc'] ?? '').trim() === 'custom' && sub) {
                const data = this.isRecord(comp['data']) ? comp['data'] : {};
                const customKey = String(data['custom'] ?? '').trim();
                const customValue = customKey ? (sub[customKey] ?? null) : null;
                if (Array.isArray(customValue)) {
                    const options = customValue.map(e => this.toSelectValueOption(e, comp)).filter((e): e is SelectValueOption => Boolean(e));
                    this.applyRemoteSelectValues(comp, options);
                }
            }
            this.ensureSelectTemplate(comp);
        }
        return hydrated;
    }

    /** Sync-only: normalize a fast-actions schema so button components behave like inline actions. */
    prepareFastActionsSchema(schema: Record<string, unknown>): Record<string, unknown> {
        const hydrated = this.prepareSchemaForRender(schema, null);
        this.injectFastActionsSelectionGuard(hydrated);
        return hydrated;
    }

    /** Background: fetch remote selects for the current formSchema and patch it in-place, then trigger re-render. */
    async hydrateRemoteSelectsInBackground(sub: Record<string, unknown> | null, contextId = this.formAsyncContextId): Promise<void> {
        if (!this.formSchema) return;
        const schema = this.formSchema;
        const formKey = String(schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
        // Prefer the live submission over the snapshot captured at schedule time: values set
        // client-side after render (customDefaultValue/logic) live here, and we must keep their
        // option so the post-fetch schema swap doesn't drop the selected value.
        const effectiveSub = this.isRecord(this.formSubmission?.data) ? this.formSubmission!.data : sub;
        let changed = false;
        for (const comp of this.findSelectComponents(schema)) {
            if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
            const resourcePayload = this.extractResourceSelectPayload(comp, formKey);
            if (resourcePayload) {
                try {
                    const resourceOptions = await this.fetchResourceSelectOptions(comp, resourcePayload);
                    if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, effectiveSub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(resourceOptions, selectedOptions));
                    changed = true;
                } catch (error) {
                    if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, effectiveSub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Remote select fetch failed', error);
                }
                this.ensureSelectTemplate(comp);
                continue;
            }
            const payload = this.extractRemoteSelectPayload(comp, formKey);
            if (!payload) continue;
            try {
                const remoteOptions = await this.fetchRemoteSelectOptions(comp, payload);
                if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                const selectedOptions = this.extractSubmissionSelectOptions(comp, effectiveSub);
                this.applyRemoteSelectValues(comp, this.mergeSelectValues(remoteOptions, selectedOptions));
                changed = true;
            } catch (error) {
                if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                const selectedOptions = this.extractSubmissionSelectOptions(comp, effectiveSub);
                this.applyRemoteSelectValues(comp, selectedOptions);
                console.error('Remote select fetch failed', error);
            }
            this.ensureSelectTemplate(comp);
        }
        if (changed && this.isCurrentFormAsyncContext(contextId, schema)) {
            this.formSchema = this.cloneSchema(schema);
        }
    }

    scheduleRemoteSelectHydrationAfterRender(sub: Record<string, unknown> | null): Promise<void> {
        this.clearScheduledRemoteSelectHydration();
        const schema = this.formSchema;
        if (!schema || !this.schemaHasRemoteSelectHydrationTargets(schema)) {
            this.pendingHydrationPromise = Promise.resolve();
            return this.pendingHydrationPromise;
        }
        this.formViewerLoading = true;
        this.formDataReady = false;
        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.pendingHydrationPromise = promise;
        this.pendingPostRenderHydration = {
            requestId: ++this.nextPostRenderHydrationRequestId,
            contextId: this.formAsyncContextId,
            submission: this.cloneSubmissionData(sub),
            resolve,
            reject
        };
        return promise;
    }

    beginFormViewerLoad(): void {
        this.formViewerLoading = true;
        this.formDataReady = false;
    }

    /** Builder/editor pages render no <formio> viewer; mark the form ready without waiting for onFormViewerReady. */
    markFormDataReadyForBuilder(): void {
        this.clearScheduledRemoteSelectHydration();
        this.pendingHydrationPromise = Promise.resolve();
        this.formViewerLoading = false;
        this.formDataReady = true;
    }

    cancelFormViewerLoad(): void {
        this.invalidateActiveFormAsyncWork();
    }

    async onFormViewerReady(): Promise<void> {
        // Keep the loader up through remote-select hydration: only flip ready/loading once the
        // selects have finished (or there's nothing to hydrate / the context is stale).
        const scheduled = this.pendingPostRenderHydration;
        if (!scheduled) { this.formDataReady = true; this.formViewerLoading = false; return; }
        if (!this.isCurrentFormAsyncContext(scheduled.contextId, this.formSchema)) {
            scheduled.resolve();
            if (this.pendingPostRenderHydration?.requestId === scheduled.requestId) {
                this.pendingPostRenderHydration = null;
            }
            this.pendingHydrationPromise = null;
            this.formDataReady = true;
            this.formViewerLoading = false;
            return;
        }
        if (this.activePostRenderHydrationRequestId === scheduled.requestId && this.activePostRenderHydrationPromise) {
            return this.activePostRenderHydrationPromise;
        }
        this.activePostRenderHydrationRequestId = scheduled.requestId;
        this.activePostRenderHydrationPromise = this.hydrateRemoteSelectsInBackground(scheduled.submission, scheduled.contextId)
            .then(() => { scheduled.resolve(); })
            .catch((error) => {
                scheduled.reject(error);
                throw error;
            })
            .finally(() => {
                if (this.pendingPostRenderHydration?.requestId === scheduled.requestId) {
                    this.pendingPostRenderHydration = null;
                }
                if (this.activePostRenderHydrationRequestId === scheduled.requestId) {
                    this.activePostRenderHydrationRequestId = 0;
                }
                this.activePostRenderHydrationPromise = null;
                this.formDataReady = true;
                this.formViewerLoading = false;
            });
        return this.activePostRenderHydrationPromise;
    }

    seedSubmissionDefaultsIntoSchema(schema: Record<string, unknown> | null, submissionData: Record<string, unknown> | null): void {
        if (!schema || !submissionData) return;
        const cloneSeedValue = (value: unknown): unknown => {
            if (value == null || typeof value !== 'object') return value;
            try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
        };
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const key = String(node['key'] ?? '').trim();
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (key && node['input'] === true && type !== 'button') {
                const value = this.resolvePath(submissionData, key);
                if (value !== undefined) node['defaultValue'] = cloneSeedValue(value);
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    async onFormSubmissionChanged(
        event: unknown,
        setStatusFn: (m: string, e: boolean) => void
    ): Promise<void> {
        if (!this.formSchema) return;
        const eventRecord = this.asRecord(event);
        const changedKey = this.extractChangedComponentKey(eventRecord);
        const submissionData = this.extractChangeEventSubmissionData(eventRecord);
        if (submissionData) {
            if (this.shouldIgnoreBootstrapSubmissionChange(submissionData, changedKey)) {
                this.reapplyCanonicalSubmissionToViewer();
            } else {
                this.mergeSubmissionData(submissionData);
            }
        }
        if (!changedKey) return;
        await this.refreshDependentSelectComponents(changedKey, setStatusFn);
    }

    mergeSubmissionData(nextData: Record<string, unknown>): void {
        if (!this.formSubmission || !this.isRecord(this.formSubmission.data)) {
            this.formSubmission = { data: this.normalizeFormSubmissionData(nextData) };
            return;
        }
        const merged = { ...this.formSubmission.data, ...nextData };
        this.formSubmission.data = this.normalizeFormSubmissionData(merged);
    }

    resetFormState(): void {
        this.invalidateActiveFormAsyncWork();
        this.formSchema = null;
        this.formSubmission = null;
        this.formPreviewSubmission = null;
        this.rawFormSchema = null;
        this.rawFormSchemaModel = '';
        this.formViewerLoading = false;
        // Keep the remote-select value cache across forms (TTL-expired): avoids re-fetching the
        // same options on every navigation/re-render. Only drop in-flight requests for the old form.
        this.remoteSelectInflight.clear();
    }

    clearActiveFormView(): void {
        this.invalidateActiveFormAsyncWork();
        this.formSchema = null;
        this.formSubmission = null;
        this.formPreviewSubmission = null;
    }


    readComponentProperties(c: Record<string, unknown>): Record<string, unknown> {
        if (this.isRecord(c['properties'])) return c['properties'];
        if (this.isRecord(c['property'])) return c['property'];
        return {};
    }

    private normalizeMultipleSubmissionFields(submission: Record<string, unknown>, schema: Record<string, unknown> | null = null): void {
        const effectiveSchema = this.resolveSubmissionNormalizationSchema(schema);
        if (!effectiveSchema) return;
        this.collectMultipleComponentKeys(effectiveSchema).forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(submission, key)) return;
            submission[key] = this.coerceMultipleSubmissionValue(submission[key]);
        });
    }

    private resolveSubmissionNormalizationSchema(schema: Record<string, unknown> | null = null): Record<string, unknown> | null {
        if (schema && Array.isArray(schema['components'])) return schema;
        if (this.formSchema && Array.isArray(this.formSchema['components'])) return this.formSchema;
        if (this.rawFormSchema && Array.isArray(this.rawFormSchema['components'])) return this.rawFormSchema;
        return null;
    }

    private collectMultipleComponentKeys(schema: Record<string, unknown>): string[] {
        if (!Array.isArray(schema['components'])) return [];
        const keys = new Set<string>();
        formioEachComponent(schema['components'] as any[], (component: Record<string, unknown>) => {
            if (!this.isRecord(component)) return false;
            const key = String(component['key'] ?? '').trim();
            if (!key || component['multiple'] !== true || component['input'] === false) return false;
            keys.add(key);
            return false;
        }, true);
        return [...keys];
    }

    private coerceMultipleSubmissionValue(value: unknown): unknown {
        if (Array.isArray(value)) return value;
        if (value == null) return [];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return [];
            const parsed = this.parseJsonMaybe(trimmed);
            return Array.isArray(parsed) ? parsed : value;
        }
        if (this.isRecord(value) && !Object.keys(value).length) return [];
        return value;
    }

    private normalizeFileSubmissionFields(submission: Record<string, unknown>, schema: Record<string, unknown> | null = null): void {
        const effectiveSchema = this.resolveSubmissionNormalizationSchema(schema);
        if (!effectiveSchema) return;
        this.collectFileComponentKeys(effectiveSchema).forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(submission, key)) return;
            submission[key] = this.coerceFileSubmissionValue(submission[key]);
        });
    }

    private collectFileComponentKeys(schema: Record<string, unknown>): string[] {
        if (!Array.isArray(schema['components'])) return [];
        const keys = new Set<string>();
        formioEachComponent(schema['components'] as any[], (component: Record<string, unknown>) => {
            if (!this.isRecord(component)) return false;
            const key = String(component['key'] ?? '').trim();
            if (!key || String(component['type'] ?? '').trim().toLowerCase() !== 'file' || component['input'] === false) return false;
            keys.add(key);
            return false;
        }, true);
        return [...keys];
    }

    private coerceFileSubmissionValue(value: unknown): unknown[] {
        const entries = Array.isArray(value) ? value : (value == null ? [] : [value]);
        return entries.map(entry => this.normalizeFileEntry(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }

    private normalizeFileEntry(entry: unknown): Record<string, unknown> | null {
        if (!this.isRecord(entry)) return null;
        const normalized: Record<string, unknown> = { ...entry };
        const name = this.readFirstString(normalized['name'], normalized['filename'], normalized['originalName'], normalized['original_name']);
        const type = this.readFirstString(normalized['type'], normalized['content_type'], normalized['contentType']);
        const base64 = this.readFirstString(normalized['base64']);
        const url = this.readFirstString(normalized['url']);

        if (name) {
            normalized['name'] = name;
            normalized['originalName'] = this.readFirstString(normalized['originalName'], name);
        }
        if (type) normalized['type'] = type;
        if (base64) {
            normalized['storage'] = 'base64';
            normalized['url'] = base64.startsWith('data:')
                ? base64
                : `data:${type || 'application/octet-stream'};base64,${base64}`;
            if (!Number.isFinite(Number(normalized['size']))) {
                normalized['size'] = this.computeBase64ByteSize(base64);
            }
        } else if (url && !/^(https?:)?\/\//i.test(url) && !url.startsWith('data:')) {
            normalized['url'] = this.normalizeBackendFileUrl(url);
        }
        return normalized;
    }

    /**
     * This runs on both load (extractSubmission) and save (normalizeCurrentSubmissionData), so it
     * must be idempotent — feeding its own output back in has to yield the same result. Two things
     * broke that: (1) detecting "already normalized" only via a leading slash, which missed backend
     * values that omit it and fell through to the generic branch, doubling the prefix into
     * `/api/client/attachment/api/client/attachment/...`; (2) not stripping the `?app_code=...`
     * query string that a previous pass's `resolveApiUrl` call appended before re-running the
     * per-segment `encodeURIComponent(decodeURIComponent(...))` pass, which folded the literal `?`
     * into the path as `%3F` — so the next pass no longer recognized it as a query string and
     * `resolveApiUrl` appended a *second* `?app_code=...`, compounding further on every subsequent
     * save/load cycle. Stripping the query up front and always recomputing it fresh fixes both.
     */
    private normalizeBackendFileUrl(value: string): string {
        const raw = value.trim();
        if (!raw) return raw;
        const queryIndex = raw.indexOf('?');
        const pathOnly = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
        // Collapse any repeats of the attachment prefix — a value already corrupted by an earlier
        // bug (or by OzonApiService.downloadAttachment's now-fixed but previously-separate copy of
        // this same logic) may have it doubled or tripled in already-stored data. Stripping in a
        // loop self-heals it back to a single canonical prefix instead of preserving the doubling
        // forever (a plain `startsWith` check is satisfied just as well by a doubled prefix, so it
        // never actually fixed already-corrupted values, only stopped making new ones worse).
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
        const path = `/client/attachment/${bare}`;
        const encodedPath = path.split('/').map((segment, index) => {
            if (index === 0) return '';
            return encodeURIComponent(decodeURIComponent(segment));
        }).join('/');
        return this.api.resolveApiUrl(encodedPath);
    }

    private computeBase64ByteSize(value: string): number {
        const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
        const normalized = raw.replace(/\s/g, '');
        if (!normalized) return 0;
        const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
        return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
    }

    resolvePath(src: Record<string, unknown>, path: string): unknown {
        const norm = String(path).replace(/\[(\d+)\]/g, '.$1').trim();
        if (!norm) return undefined;
        let curr: unknown = src;
        for (const p of norm.split('.').filter(Boolean)) {
            if (curr === null || typeof curr !== 'object') return undefined;
            curr = (curr as Record<string, unknown>)[p];
            if (curr === undefined) return undefined;
        }
        return curr;
    }

    collectInputComponentKeys(schema: Record<string, unknown>): string[] {
        const keys = new Set<string>();
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const key = String(node['key'] ?? '').trim();
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (key && node['input'] === true && type !== 'button') keys.add(key);
            Object.values(node).forEach(visit);
        };
        visit(schema);
        return [...keys];
    }

    toOptionalBooleanFlag(value: unknown): boolean | null {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return null;
            if (['1', 'true', 'yes', 'on', 'y', 'si', 'sì'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) return false;
            return null;
        }
        return null;
    }

    private async refreshDependentSelectComponents(changedKey: string, setStatusFn: (m: string, e: boolean) => void): Promise<void> {
        if (!changedKey || !this.formSchema || this.isRefreshingDependentSelects) return;
        const contextId = this.formAsyncContextId;
        const schema = this.formSchema;
        const dependents = this.findDependentSelectComponents(schema, changedKey);
        if (!dependents.length) return;
        const formKey = String(schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
        const submissionData = this.formSubmission?.data && this.isRecord(this.formSubmission.data) ? this.formSubmission.data : null;
        let schemaChanged = false;
        let submissionChanged = false;
        this.isRefreshingDependentSelects = true;
        try {
            for (const comp of dependents) {
                if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                const payload = this.extractRemoteSelectPayload(comp, formKey);
                if (payload) {
                    try {
                        const remoteOptions = await this.fetchRemoteSelectOptions(comp, payload);
                        if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                        this.applyRemoteSelectValues(comp, remoteOptions);
                        schemaChanged = true;
                    } catch (error) { console.error('Dependent remote select fetch failed', error); }
                    this.ensureSelectTemplate(comp);
                    submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    continue;
                }
                if (String(comp['dataSrc'] ?? '').trim() === 'custom' && submissionData) {
                    const data = this.isRecord(comp['data']) ? comp['data'] : {};
                    const customKey = String(data['custom'] ?? '').trim();
                    const customValue = customKey ? (submissionData[customKey] ?? (this.isRecord(submissionData['data_value']) ? submissionData['data_value'][customKey] : null)) : null;
                    if (Array.isArray(customValue)) {
                        if (!this.isCurrentFormAsyncContext(contextId, schema)) return;
                        const options = customValue.map(e => this.toSelectValueOption(e, comp)).filter((e): e is SelectValueOption => Boolean(e));
                        this.applyRemoteSelectValues(comp, options);
                        schemaChanged = true;
                        submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    }
                }
            }
        } finally { this.isRefreshingDependentSelects = false; }
        if (schemaChanged && this.isCurrentFormAsyncContext(contextId, schema) && this.formSchema) this.formSchema = this.cloneSchema(this.formSchema);
        if (submissionChanged && submissionData && this.isCurrentFormAsyncContext(contextId, schema)) this.mergeSubmissionData(submissionData);
    }

    private findDependentSelectComponents(schema: Record<string, unknown>, changedKey: string): Record<string, unknown>[] {
        const sourceKey = String(changedKey ?? '').trim();
        if (!sourceKey) return [];
        return this.findSelectComponents(schema)
            .filter(c => this.isRecord(c))
            .filter(c => {
                const componentKey = String(c['key'] ?? '').trim();
                if (!componentKey || componentKey === sourceKey) return false;
                return this.readSelectOnChangeFields(c).includes(sourceKey);
            });
    }

    private readSelectOnChangeFields(component: Record<string, unknown>): string[] {
        const properties = this.readComponentProperties(component);
        const data = this.isRecord(component['data']) ? component['data'] : {};
        const raw = properties['onChangeFields'] ?? properties['on_change_fields'] ?? data['onChangeFields'] ?? data['on_change_fields'] ?? component['onChangeFields'] ?? component['on_change_fields'];
        const entries = this.normalizeArrayValue(raw).map(e => String(e ?? '').trim()).filter(Boolean);
        return Array.from(new Set(entries));
    }

    private pruneSelectSubmissionValue(component: Record<string, unknown>, submissionData: Record<string, unknown> | null): boolean {
        if (!submissionData) return false;
        const key = String(component['key'] ?? '').trim();
        if (!key || !Object.prototype.hasOwnProperty.call(submissionData, key)) return false;
        const options = this.extractSchemaOptions(component);
        if (!options.length) return false;
        const allowedValues = new Set(options.map(o => this.optionLookupKey(o.value)).filter(Boolean));
        const current = submissionData[key];
        if (Array.isArray(current)) {
            const filtered = current.filter(e => allowedValues.has(this.optionLookupKey(e, component)));
            if (filtered.length === current.length) return false;
            submissionData[key] = filtered;
            return true;
        }
        if (current == null || current === '') return false;
        if (allowedValues.has(this.optionLookupKey(current, component))) return false;
        submissionData[key] = null;
        return true;
    }

    private extractChangeEventSubmissionData(eventRecord: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!eventRecord) return null;
        const submission = this.asRecord(eventRecord['submission']);
        const submissionData = submission ? this.asRecord(submission['data']) : null;
        if (submissionData) return submissionData;
        return this.asRecord(eventRecord['data']);
    }

    private extractChangedComponentKey(eventRecord: Record<string, unknown> | null): string {
        if (!eventRecord) return '';
        const changed = this.asRecord(eventRecord['changed']);
        const changedComponent = changed ? this.asRecord(changed['component']) : null;
        const changedInstance = changed ? this.asRecord(changed['instance']) : null;
        const changedInstanceComponent = changedInstance ? this.asRecord(changedInstance['component']) : null;
        const eventComponent = this.asRecord(eventRecord['component']);
        const key = this.readFirstString(changedComponent?.['key'], changedInstanceComponent?.['key'], changed?.['key'], eventComponent?.['key']);
        if (key) return key;
        const path = this.readFirstString(changed?.['path'], changedComponent?.['path'], changedInstanceComponent?.['path']);
        if (!path) return '';
        const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
        const segments = normalizedPath.split('.').map(e => e.trim()).filter(Boolean).filter(e => !/^\d+$/.test(e));
        if (!segments.length) return '';
        return segments[segments.length - 1];
    }

    private shouldIgnoreBootstrapSubmissionChange(nextData: Record<string, unknown>, changedKey: string): boolean {
        if (changedKey) return false;
        const current = this.formSubmission?.data;
        if (!current || !this.isRecord(current) || !this.formSchema) return false;
        const fieldKeys = this.collectInputComponentKeys(this.formSchema);
        if (!fieldKeys.length) return false;
        let downgraded = false;
        for (const key of fieldKeys) {
            const currentValue = current[key];
            if (this.isBlankSubmissionValue(currentValue)) continue;
            const nextValue = nextData[key];
            if (this.isBlankSubmissionValue(nextValue)) { downgraded = true; continue; }
            if (!this.areSubmissionValuesEquivalent(currentValue, nextValue)) return false;
        }
        return downgraded;
    }

    private reapplyCanonicalSubmissionToViewer(): void {
        const current = this.formSubmission?.data;
        if (!current || !this.isRecord(current)) return;
        this.formSubmission = { data: this.normalizeFormSubmissionData({ ...current }) };
    }

    private isBlankSubmissionValue(value: unknown): boolean {
        if (value == null) return true;
        if (typeof value === 'string') return !value.trim();
        if (Array.isArray(value)) return value.length === 0;
        if (this.isRecord(value)) return Object.keys(value).length === 0;
        return false;
    }

    private areSubmissionValuesEquivalent(left: unknown, right: unknown): boolean {
        if (left === right) return true;
        if (typeof left === 'object' || typeof right === 'object') {
            try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
        }
        return false;
    }

    private clearScheduledRemoteSelectHydration(): void {
        if (this.pendingPostRenderHydration) {
            this.pendingPostRenderHydration.resolve();
            this.pendingPostRenderHydration = null;
        }
        this.pendingHydrationPromise = null;
    }

    private invalidateActiveFormAsyncWork(): void {
        this.formAsyncContextId += 1;
        this.clearScheduledRemoteSelectHydration();
        this.activePostRenderHydrationRequestId = 0;
        this.activePostRenderHydrationPromise = null;
        this.formViewerLoading = false;
        this.formDataReady = true;
    }

    private isCurrentFormAsyncContext(contextId: number, schema: Record<string, unknown> | null = null): boolean {
        if (contextId !== this.formAsyncContextId) return false;
        if (!schema) return true;
        return this.formSchema === schema;
    }

    private schemaHasRemoteSelectHydrationTargets(schema: Record<string, unknown>): boolean {
        const formKey = String(schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
        return this.findSelectComponents(schema).some(comp => Boolean(this.extractResourceSelectPayload(comp, formKey) || this.extractRemoteSelectPayload(comp, formKey)));
    }

    private cloneSubmissionData(submission: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!submission) return null;
        try { return this.normalizeFormSubmissionData(JSON.parse(JSON.stringify(submission))); }
        catch { return this.normalizeFormSubmissionData({ ...submission }); }
    }

    private normalizeFormTableComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'table' && this.isOzonDataTableStub(node)) {
                // Legacy builder-palette stub reuses Form.io's native `table` layout type name for our
                // custom data-grid component. Retype it so it doesn't collide with the real table layout.
                node['type'] = 'ozon_data_table';
                node['input'] = false;
                node['tableView'] = false;
                node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-data-table');
            } else if (type === 'table') {
                node['tableView'] = true; node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-table');
            } else if (type === 'datagrid' || type === 'editgrid') {
                node['tableView'] = true; node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-datagrid');
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private isOzonDataTableStub(node: Record<string, unknown>): boolean {
        const props = this.readComponentProperties(node);
        return typeof props['action_url'] === 'string' && props['action_url'].trim().length > 0;
    }

    private normalizeFormWysiwygComponents(schema: Record<string, unknown>, submissionData: Record<string, unknown> | null = null): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const key = String(node['key'] ?? '').trim().toLowerCase();
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'content' && this.isActiveWysiwygEditor(node)) {
                this.activateContentWysiwygEditor(node, submissionData);
            } else if (key === 'content' && type === 'textarea' && this.isActiveWysiwygEditor(node)) {
                node['editor'] = 'quill';
                node['wysiwyg'] = true;
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private normalizeFormJsonEditorComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'textarea' && this.isActiveJsonEditor(node)) {
                node['type'] = 'ozonjsoneditor';
                node['input'] = true;
                node['tableView'] = false;
                node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-formio-json-editor-field');
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private isActiveJsonEditor(component: Record<string, unknown>): boolean {
        const props = this.readComponentProperties(component);
        const raw = props['jeditor'] ?? component['jeditor'];
        if (raw === true) return true;
        return ['y', 'yes', 'true', '1'].includes(String(raw ?? '').trim().toLowerCase());
    }

    private isActiveWysiwygEditor(component: Record<string, unknown>): boolean {
        const props = this.readComponentProperties(component);
        return this.readFirstString(component['editor'], props['editor']).toLowerCase() === 'active';
    }

    private activateContentWysiwygEditor(component: Record<string, unknown>, submissionData: Record<string, unknown> | null = null): void {
        const html = typeof component['html'] === 'string' ? component['html'] : '';
        const key = String(component['key'] ?? '').trim();
        component['type'] = 'textarea';
        component['input'] = true;
        component['editor'] = 'quill';
        component['wysiwyg'] = true;
        component['inputFormat'] = 'html';
        component['tableView'] = false;
        if (html && component['defaultValue'] == null) component['defaultValue'] = html;
        if (html && key && submissionData && this.isBlankSubmissionValue(submissionData[key])) {
            submissionData[key] = html;
        }
        delete component['html'];
    }

    /**
     * Content/HTMLElement components interpolate their markup against Formio's
     * `data` namespace (submission data), not `form`. Backend schemas author
     * placeholders as `{{ form.path }}`, so rewrite the `form.` prefix to `data.`
     * inside each `{{ }}` block, letting Formio resolve live submission values.
     */
    private normalizeFormContentComponents(schema: Record<string, unknown>): void {
        const rewrite = (markup: string): string =>
            markup.replace(/\{\{([\s\S]*?)\}\}/g, (_full, expr: string) => `{{${expr.replace(/\bform\./g, 'data.')}}}`);
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            const field = type === 'content' ? 'html' : (type === 'htmlelement' ? 'content' : '');
            if (field && typeof node[field] === 'string' && (node[field] as string).includes('form.')) {
                node[field] = rewrite(node[field] as string);
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private normalizeInteractiveSchemaComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            this.aliasFormVarsToDataInLogic(node);
            this.normalizeReadonlyComponent(node);
            this.normalizeFileComponent(node);
            this.normalizeNativeSubmitButtonComponent(node);
            this.normalizeInlineActionButtonComponent(node);
            this.normalizeOutlineButtonComponent(node);
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    /**
     * Form.io's own `type: 'json'` logic trigger (Utils.checkJsonConditional) evaluates against
     * `{data, row, form, _}` only — `options.evalContext` (where `user.*`/`session.*`/`app.*` live,
     * used elsewhere for interpolation) is never passed in. `{var: 'app.selection_count'}` here
     * would always resolve to undefined, so the guard could never actually flip — it'd stay however
     * it started. Reading `data.selection_count` instead works because it's real submission data,
     * and RecordListComponent binds `[submission]` with that key so Form.io's normal
     * setSubmission -> setValue -> checkConditions cascade re-evaluates this on every selection
     * change, no manual poke required.
     */
    private injectFastActionsSelectionGuard(schema: Record<string, unknown>): void {
        const addLogic = (component: Record<string, unknown>, selectionCountValue: number, state: boolean): void => {
            const logic = Array.isArray(component['logic']) ? [...component['logic'] as unknown[]] : [];
            logic.push({
                name: state ? 'disableSelectionGuard' : 'enableSelectionGuard',
                trigger: {
                    type: 'json',
                    json: {
                        [state ? '<=' : '>']: [
                            { var: 'data.selection_count' },
                            selectionCountValue
                        ]
                    }
                },
                actions: [
                    {
                        name: 'show',
                        type: 'property',
                        property: {
                            label: 'Disabled',
                            value: 'disabled',
                            type: 'boolean'
                        },
                        state
                    }
                ]
            });
            component['logic'] = logic;
        };

        const visit = (node: unknown): void => {
            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'button') {
                const key = String(node['key'] ?? '').trim().toLowerCase();
                if (key !== 'submit') {
                    const hasGuard = Array.isArray(node['logic']) && (node['logic'] as unknown[]).some(item => {
                        if (!this.isRecord(item)) return false;
                        const actions = Array.isArray(item['actions']) ? item['actions'] as unknown[] : [];
                        return actions.some(action => {
                            if (!this.isRecord(action)) return false;
                            const property = this.isRecord(action['property']) ? action['property'] : null;
                            return String(action['type'] ?? '').trim().toLowerCase() === 'property'
                                && String(property?.['value'] ?? '').trim().toLowerCase() === 'disabled';
                        });
                    });
                    node['tooltip'] = this.readFirstString(node['tooltip'], this.isRecord(node['properties']) ? (node['properties'] as Record<string, unknown>)['tooltip'] : '') || 'Seleziona almeno una riga';
                    if (!hasGuard) {
                        addLogic(node, 0, true);
                        addLogic(node, 0, false);
                    }
                }
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    /**
     * A `customDefaultValue` (e.g. `value = value || user.uid`) is evaluated at component init,
     * BEFORE the loaded submission is bound — so `value` is empty and it sets a default that then
     * clobbers the saved value through the change-merge. Defaults must only fill blanks, so when
     * the submission already holds a non-blank value for a field, drop its customDefaultValue.
     */
    private stripClobberingDefaultsForSavedValues(schema: Record<string, unknown>, sub: Record<string, unknown> | null): void {
        if (!this.isRecord(sub)) return;
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const key = String(node['key'] ?? '').trim();
            if (key && node['input'] !== false && !this.isBlankSubmissionValue(sub[key])) {
                delete node['customDefaultValue'];
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private logicEvalContextProvider?: () => Record<string, unknown>;
    setLogicEvalContextProvider(fn: () => Record<string, unknown>): void { this.logicEvalContextProvider = fn; }

    /**
     * Form.io native `logic[].trigger` json conditionals run with a fixed context of only
     * `{ data, row, form, _ }` (see FormioUtils.checkJsonConditional) — `user`, `session`,
     * `is_admin`, `app` are NOT available, and `form` is the form *schema*, not the data.
     * So at render we normalize each logic/conditional json:
     *   - `{ "var": "form.x" }`   -> `{ "var": "data.x" }`            (keep dynamic, reads submission)
     *   - `{ "var": "user.x" }` / `session.*` / `is_admin` / `app.*` -> baked literal value
     * user/session/is_admin/app are constant for the render, so baking them as literals makes
     * authored logic work without patching Form.io or polluting submission data.
     */
    private aliasFormVarsToDataInLogic(component: Record<string, unknown>): void {
        const ctx = this.logicEvalContextProvider?.() ?? {};
        const refPath = (ref: unknown): { path: string; def: unknown; hasDef: boolean } | null => {
            if (typeof ref === 'string') return { path: ref, def: undefined, hasDef: false };
            if (Array.isArray(ref) && typeof ref[0] === 'string') return { path: ref[0], def: ref[1], hasDef: ref.length > 1 };
            return null;
        };
        const transform = (node: unknown): unknown => {
            if (Array.isArray(node)) return node.map(transform);
            if (!this.isRecord(node)) return node;
            const keys = Object.keys(node);
            if (keys.length === 1 && keys[0] === 'var') {
                const info = refPath(node['var']);
                if (info) {
                    if (info.path.startsWith('form.')) {
                        const dataPath = `data.${info.path.slice(5)}`;
                        return info.hasDef ? { var: [dataPath, info.def] } : { var: dataPath };
                    }
                    const root = info.path.split('.')[0];
                    if (root === 'user' || root === 'session' || root === 'app' || info.path === 'is_admin') {
                        const resolved = info.path === 'is_admin' ? ctx['is_admin'] : this.resolvePath(ctx, info.path);
                        if ((resolved === undefined || resolved === null) && info.hasDef) return info.def;
                        return resolved ?? null;
                    }
                }
                return node;
            }
            const out: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(node)) out[key] = transform(value);
            return out;
        };
        const logic = Array.isArray(component['logic']) ? component['logic'] : [];
        for (const item of logic) {
            if (!this.isRecord(item)) continue;
            const trigger = this.isRecord(item['trigger']) ? item['trigger'] : null;
            if (trigger && this.isRecord(trigger['json'])) trigger['json'] = transform(trigger['json']);
        }
        const conditional = this.isRecord(component['conditional']) ? component['conditional'] : null;
        if (conditional && this.isRecord(conditional['json'])) conditional['json'] = transform(conditional['json']);
    }

    private normalizeReadonlyComponent(component: Record<string, unknown>): void {
        const properties = this.readComponentProperties(component);
        const readonlyFlag = this.toOptionalBooleanFlag(properties['readonly'])
            ?? this.toOptionalBooleanFlag(component['readonly'])
            ?? this.toOptionalBooleanFlag(component['readOnly']);
        if (readonlyFlag !== true) return;

        component['disabled'] = true;
        component['readOnly'] = true;

        const type = String(component['type'] ?? '').trim().toLowerCase();
        if (type !== 'select') return;

        component['searchEnabled'] = false;
        component['removeItemButton'] = false;
        component['customClass'] = this.appendCustomClass(component['customClass'], 'ozon-select-readonly');
    }

    /**
     * Style file fields as the Bootstrap Italia v2 upload widget and keep them usable: forcing
     * `multiple` leaves the browse/drop area visible even when files already exist, so users can
     * add and remove files in both phases. readonly stays gated by normalizeReadonlyComponent,
     * which disables the component (Form.io then hides add/remove).
     */
    private normalizeFileComponent(component: Record<string, unknown>): void {
        if (String(component['type'] ?? '').trim().toLowerCase() !== 'file') return;
        if (typeof component['multiple'] !== 'boolean') component['multiple'] = true;
        component['customClass'] = this.appendCustomClass(component['customClass'], 'ozon-file-upload');
        // Form.io silently no-ops file selection when `component.storage` is unset (see
        // File.js#prepareFilesToUpload). Forms that don't configure a storage provider still need
        // uploads to work, so fall back to inline base64 — normalizeFileEntry() already round-trips
        // base64 file values on read, so this is consistent with how saved files are handled.
        if (!component['storage']) component['storage'] = 'base64';
    }

    private normalizeNativeSubmitButtonComponent(component: Record<string, unknown>): void {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        const key = String(component['key'] ?? '').trim().toLowerCase();
        if (type !== 'button' || key !== 'submit') return;
        component['customClass'] = this.appendCustomClass(component['customClass'], 'ozon-native-submit');
    }

    private normalizeInlineActionButtonComponent(component: Record<string, unknown>): void {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        const key = String(component['key'] ?? '').trim().toLowerCase();
        if (type !== 'button' || key === 'submit') return;
        const properties = this.readComponentProperties(component);
        const hasActionConfig = this.readFirstString(component['url_action'], properties['url_action'])
            || this.readFirstString(component['btn_action_type'], properties['btn_action_type']);
        if (!hasActionConfig) return;
        component['action'] = 'event';
        component['event'] = OZON_INLINE_ACTION_EVENT;
        // `modalEdit` is Form.io's builder-only "edit in modal" flag; at render it draws a
        // "Click to set value" wrapper. We drive confirmation via properties.modal_*, so strip it.
        delete component['modalEdit'];
        // These buttons carry a computed `url_action` value set by an always-true `value` logic
        // action. With the default clearOnHide, hiding the button clears that value, which the
        // logic immediately re-sets -> change -> re-eval -> flicker loop. Keep the value on hide.
        component['clearOnHide'] = false;
        component['customClass'] = this.appendCustomClass(component['customClass'], 'ozon-inline-action');
    }

    private normalizeOutlineButtonComponent(component: Record<string, unknown>): void {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        if (type !== 'button') return;

        const customClass = String(component['customClass'] ?? '').trim();
        if (!/\bbtn-outline-/.test(customClass)) return;
        component['customClass'] = this.appendCustomClass(customClass, 'ozon-btn-custom-outline');
    }

    private appendCustomClass(source: unknown, className: string): string {
        const classes = String(source ?? '').split(/\s+/).map(e => e.trim()).filter(Boolean);
        if (!classes.includes(className)) classes.push(className);
        return classes.join(' ').trim();
    }

    private findSelectComponents(src: unknown): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        const visit = (n: unknown): void => {
            if (Array.isArray(n)) n.forEach(visit);
            else if (this.isRecord(n)) { if (n['type'] === 'select') out.push(n); Object.values(n).forEach(visit); }
        };
        visit(src);
        return out;
    }

    private extractRemoteSelectPayload(comp: Record<string, unknown>, formKey: string): RemoteSelectRequestPayload | null {
        const data = this.isRecord(comp['data']) ? comp['data'] : {};
        const props = this.readComponentProperties(comp);
        const key = String(comp['key'] ?? '').trim();
        const currModel = String(formKey || this.selectedModel || '').trim();
        const url = this.readFirstString(data['url'], comp['url'], this.readPropertyValue(props, ['url']));
        const src = this.readFirstString(comp['dataSrc'], props['src'], url ? 'url' : '');
        if (src === 'resource') return null;
        const hasInlineValues = (Array.isArray(data['values']) && (data['values'] as unknown[]).length > 0) || (Array.isArray(comp['values']) && (comp['values'] as unknown[]).length > 0);
        if (src === 'values' || (!url && !src && hasInlineValues)) return null;
        const hasAbsoluteRemoteUrl = /^https?:\/\//i.test(url);
        const useInternalSelect = !hasAbsoluteRemoteUrl;
        const payloadData: Record<string, unknown> = {};
        const pathValue = this.readFirstString(data['pathValue'], data['path_value'], props['pathValue'], props['path_value']);
        const headerKey = this.readFirstString(data['headerKey'], data['header_key'], props['headerKey'], props['header_key']);
        const headerValueKey = this.readFirstString(data['headerValueKey'], data['header_value_key'], props['headerValueKey'], props['header_value_key']);
        const headers = this.normalizeRemoteHeaders(data['headers']);
        if (url) payloadData['url'] = url;
        if (pathValue) payloadData['pathValue'] = pathValue;
        if (headers.length) payloadData['headers'] = headers;
        if (headerKey) payloadData['headerKey'] = headerKey;
        if (headerValueKey) payloadData['headerValueKey'] = headerValueKey;
        const payloadProperties: Record<string, unknown> = {};
        if (useInternalSelect) {
            const sourceModel = this.readFirstString(props['model'], data['model']);
            const sourceDomain = this.normalizeRemoteDomain(props['domain'] ?? data['domain']);
            const sourceComputeLabel = this.readFirstString(props['compute_label'], props['computeLabel'], data['compute_label'], data['computeLabel']);
            const labelKey = this.readFirstString(props['label'], comp['label'], key, 'label');
            const idKey = this.resolveSelectIdentifierPath(comp);
            if (src) payloadProperties['src'] = src;
            if (sourceModel) payloadProperties['model'] = sourceModel;
            if (sourceDomain) payloadProperties['domain'] = sourceDomain;
            if (sourceComputeLabel) payloadProperties['compute_label'] = sourceComputeLabel;
            if (labelKey) payloadProperties['label'] = labelKey;
            if (idKey) payloadProperties['id'] = idKey;
        }
        const payload: RemoteSelectRequestPayload = { key: useInternalSelect ? key : '', curr_model: useInternalSelect ? currModel : '', data: payloadData, properties: payloadProperties };
        if (!Boolean(payload.key && payload.curr_model) && !Boolean(url)) return null;
        return payload;
    }

    private extractResourceSelectPayload(comp: Record<string, unknown>, _formKey: string): { model: string; payload: ListRequestPayload } | null {
        const data = this.isRecord(comp['data']) ? comp['data'] : {};
        const props = this.readComponentProperties(comp);
        const src = this.readFirstString(comp['dataSrc'], props['src']);
        if (src !== 'resource') return null;

        const model = this.readFirstString(data['resource'], comp['resource'], props['resource']);
        if (!model) return null;

        const query = this.normalizeResourceSelectQuery(data['query'], props['query'], data['filter'], props['filter']);
        const limit = this.readFirstNumber(data['limit'], props['limit']) ?? 1000;
        const order = this.readFirstString(data['order'], props['order']) || 'rec_name asc';
        return {
            model,
            payload: {
                query,
                skip: 0,
                limit,
                order
            }
        };
    }

    private normalizeResourceSelectQuery(...candidates: unknown[]): Record<string, unknown> {
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (this.isRecord(candidate)) return candidate;
            const parsed = this.parseJsonMaybe(candidate);
            if (this.isRecord(parsed)) return parsed;
        }
        return {};
    }

    private normalizeRemoteHeaders(raw: unknown): Array<{ key: string; value: string }> {
        if (!Array.isArray(raw)) return [];
        const headers: Array<{ key: string; value: string }> = [];
        raw.forEach((entry: unknown) => {
            if (!this.isRecord(entry)) return;
            const k = String(entry['key'] ?? '').trim(); const v = String(entry['value'] ?? '').trim();
            if (!k || !v) return;
            headers.push({ key: k, value: v });
        });
        return headers;
    }

    private normalizeRemoteDomain(raw: unknown): Record<string, unknown> | null {
        if (this.isRecord(raw)) return raw;
        const text = String(raw ?? '').trim();
        if (!text) return null;
        try { const parsed = JSON.parse(text); return this.isRecord(parsed) ? parsed : null; } catch { return null; }
    }

    private getCachedSelectOptions(cacheKey: string): SelectValueOption[] | null {
        const entry = this.remoteSelectCache.get(cacheKey);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) { this.remoteSelectCache.delete(cacheKey); return null; }
        return entry.value;
    }

    private setCachedSelectOptions(cacheKey: string, value: SelectValueOption[]): void {
        this.remoteSelectCache.set(cacheKey, { value, expiresAt: Date.now() + AppFormioRendererService.REMOTE_SELECT_CACHE_TTL_MS });
    }

    private async fetchRemoteSelectOptions(comp: Record<string, unknown>, payload: RemoteSelectRequestPayload): Promise<SelectValueOption[]> {
        const cacheKey = this.stableStringify(payload);
        const cached = this.getCachedSelectOptions(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const request = this.api.getRemoteSelect(payload)
            .then((response: unknown) => this.normalizeRemoteSelectResponse(response, comp))
            .then((options: SelectValueOption[]) => { this.setCachedSelectOptions(cacheKey, options); return options; })
            .finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private async fetchResourceSelectOptions(comp: Record<string, unknown>, payload: { model: string; payload: ListRequestPayload }): Promise<SelectValueOption[]> {
        const cacheKey = `resource:${this.stableStringify(payload)}`;
        const cached = this.getCachedSelectOptions(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const options: SelectValueOption[] = [];
        const request = this.api.streamList(payload.model, payload.payload, (item: unknown) => {
            const option = this.toSelectValueOption(item, comp);
            if (option) options.push(option);
        }, undefined, { stream: false }).then(() => {
                this.setCachedSelectOptions(cacheKey, options);
                return options;
            })
            .finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private normalizeRemoteSelectResponse(payload: unknown, comp: Record<string, unknown>): SelectValueOption[] {
        let target: unknown = payload;
        for (let i = 0; i < 4; i++) {
            if (this.isRecord(target) && this.isRecord(target['content'])) { target = target['content']['data'] ?? target['content']; continue; }
            if (this.isRecord(target)) { const next = target['data'] ?? target['items'] ?? target['records'] ?? target['values']; if (next !== undefined) { target = next; continue; } }
            break;
        }
        if (!Array.isArray(target)) return [];
        return target.map(e => this.toSelectValueOption(e, comp)).filter((e): e is SelectValueOption => Boolean(e));
    }

    private extractSubmissionSelectOptions(comp: Record<string, unknown>, sub: Record<string, unknown> | null): SelectValueOption[] {
        if (!sub) return [];
        const key = String(comp['key'] ?? '').trim();
        if (!key) return [];
        const current = sub[key];
        if (current == null) return [];
        const values = Array.isArray(current) ? current : [current];
        return values.map(e => this.toSelectValueOption(e, comp)).filter((e): e is SelectValueOption => Boolean(e));
    }

    private mergeSelectValues(primary: SelectValueOption[], secondary: SelectValueOption[]): SelectValueOption[] {
        const merged: SelectValueOption[] = []; const seen = new Set<string>();
        const pushUnique = (entry: SelectValueOption) => {
            const id = `${typeof entry.value}:${this.toDisplayValue(entry.value)}`;
            if (seen.has(id)) return; seen.add(id); merged.push(entry);
        };
        primary.forEach(pushUnique); secondary.forEach(pushUnique);
        return merged;
    }

    private ensureSelectTemplate(comp: Record<string, unknown>): void {
        const props = this.readComponentProperties(comp);
        if (!comp['template'] && props['label']) comp['template'] = '<span>{{ item.label || item.data?.label || item }}</span>';
    }

    private applyRemoteSelectValues(c: Record<string, unknown>, v: SelectValueOption[]): void {
        const currentData = this.isRecord(c['data']) ? c['data'] : {};
        const cleanedData: Record<string, unknown> = {};
        Object.entries(currentData).forEach(([key, value]) => {
            if (key === 'url' || key === 'method' || key === 'headers' || key === 'selectValues' || key === 'resource' || key === 'searchField' || key === 'searchDebounce') return;
            cleanedData[key] = value;
        });
        c['data'] = { ...cleanedData, values: v };
        c['dataSrc'] = 'values';
        delete c['url']; delete c['method']; delete c['lazyLoad']; delete c['selectValues']; delete c['resource']; delete c['searchField']; delete c['searchDebounce'];
        if (!c['valueProperty']) c['valueProperty'] = 'value';
    }

    private extractSchemaOptions(component: Record<string, unknown>): SelectValueOption[] {
        const data = this.isRecord(component['data']) ? component['data'] : {};
        const candidates: unknown[] = [data['values'], component['values'], data['items'], component['items']];
        for (const candidate of candidates) {
            if (!Array.isArray(candidate)) continue;
            const parsed = candidate.map(e => this.toSelectValueOption(e, component)).filter((e): e is SelectValueOption => Boolean(e));
            if (parsed.length) return parsed;
        }
        return [];
    }

    private buildSelectOptionMappingConfig(component?: Record<string, unknown>): SelectOptionMappingConfig {
        if (!component) return {};
        const valuePath = this.resolveSelectIdentifierPath(component);
        const props = this.readComponentProperties(component);
        const labelPath = this.readFirstString(
            props['label'],
            props['compute_label'],
            props['computeLabel'],
            props['labelPath'],
            props['label_path']
        );
        return {
            valuePaths: valuePath ? [valuePath] : [],
            labelPaths: labelPath ? [labelPath] : [],
            aliasValuePaths: valuePath ? [valuePath] : []
        };
    }

    private resolveSelectIdentifierPath(component: Record<string, unknown>): string {
        const props = this.readComponentProperties(component);
        return this.readFirstString(
            component['idPath'],
            props['idPath'],
            props['id_path'],
            props['id'],
            component['valueProperty'],
            'rec_name'
        );
    }

    private optionLookupKey(value: unknown, component?: Record<string, unknown>): string {
        const primitive = this.optionPrimitiveValue(value, component);
        if (primitive == null) return '';
        if (typeof primitive === 'string') return `s:${primitive}`;
        if (typeof primitive === 'number') return `n:${primitive}`;
        if (typeof primitive === 'boolean') return `b:${primitive}`;
        if (Array.isArray(primitive)) return `a:${primitive.map(e => this.optionLookupKey(e, component)).join('|')}`;
        if (this.isRecord(primitive)) return `j:${this.stableStringify(primitive)}`;
        return `x:${String(primitive)}`;
    }

    private optionPrimitiveValue(value: unknown, component?: Record<string, unknown>): unknown {
        return selectOptionPrimitiveValue(value, this.buildSelectOptionMappingConfig(component));
    }

    toSelectValueOption(e: unknown, component?: Record<string, unknown>): SelectValueOption | null {
        return mapSelectValueOption(e, this.buildSelectOptionMappingConfig(component));
    }

    private normalizeArrayValue(value: unknown): unknown[] {
        if (Array.isArray(value)) return value;
        const text = String(value ?? '').trim();
        if (!text) return [];
        if (text.startsWith('[') && text.endsWith(']')) { try { const p = JSON.parse(text); if (Array.isArray(p)) return p; } catch { return text.split(',').map(e => e.trim()).filter(Boolean); } }
        return text.split(',').map(e => e.trim()).filter(Boolean);
    }

    private readPropertyValue(p: Record<string, unknown>, keys: string[]): string {
        for (const k of keys) { const value = p[k]; if (typeof value === 'string' && value.trim()) return value.trim(); }
        return '';
    }
}
