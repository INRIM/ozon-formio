import { Injectable } from '@angular/core';
import { OzonApiService } from '../core/ozon-api.service';
import { selectOptionPrimitiveValue, toSelectValueOption as mapSelectValueOption } from '../core/select-option.util';
import { SelectValueOption } from '../models/app.types';
import { ListRequestPayload, RemoteSelectRequestPayload } from '../models/ozon.types';

@Injectable()
export class AppFormioRendererService {
    formSchema: Record<string, unknown> | null = null;
    formSubmission: { data: Record<string, unknown> } | null = null;
    formPreviewSubmission: { data: Record<string, unknown> } | null = null;
    rawFormSchema: Record<string, unknown> | null = null;
    rawFormSchemaModel = '';
    formViewerLoading = false;

    selectedModel = '';
    selectedRecordName = '';
    sessionLocale = 'it';
    sessionTimezone = '';

    pendingHydrationPromise: Promise<void> | null = null;
    private isRefreshingDependentSelects = false;
    private remoteSelectCache = new Map<string, SelectValueOption[]>();
    private remoteSelectInflight = new Map<string, Promise<SelectValueOption[]>>();
    private pendingPostRenderHydration: {
        requestId: number;
        submission: Record<string, unknown> | null;
        resolve: () => void;
        reject: (reason?: unknown) => void;
    } | null = null;
    private nextPostRenderHydrationRequestId = 0;
    private activePostRenderHydrationRequestId = 0;
    private activePostRenderHydrationPromise: Promise<void> | null = null;
    private readonly responseWrappers: Array<'content' | 'payload' | 'response' | 'result' | 'action'> = [
        'content', 'payload', 'response', 'result', 'action'
    ];

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

    extractFormSchema(payload: unknown): Record<string, unknown> | null {
        if (!this.isRecord(payload)) return null;
        const content = this.asRecord(payload['content']);
        if (content) {
            const schema = content['schema'];
            if (Array.isArray(schema)) return { display: 'form', components: schema };
            if (this.isRecord(schema) && Array.isArray(schema['components'])) return schema as Record<string, unknown>;
        }
        // Fallback: top-level components array (e.g. { components: [...] })
        if (Array.isArray(payload['components'])) return { display: 'form', components: payload['components'] };
        return null;
    }

    extractActionFormSchema(payload: unknown): Record<string, unknown> | null {
        const source = this.isRecord(payload) ? payload : null;
        if (!source) return null;
        const candidates: unknown[] = [
            this.asRecord(source['content'])?.['schema'],
            source['schema'],
            this.asRecord(source['payload'])?.['schema'],
            this.asRecord(this.asRecord(source['data'])?.['payload'])?.['schema']
        ];
        for (const candidate of candidates) {
            const parsed = this.parseJsonMaybe(candidate);
            const normalized = parsed ?? candidate;
            if (Array.isArray(normalized)) return { display: 'form', components: normalized };
            if (this.isRecord(normalized) && Array.isArray(normalized['components'])) return normalized as Record<string, unknown>;
        }
        return null;
    }

    extractSubmission(payload: unknown): { data: Record<string, unknown> } | null {
        const nodes = this.collectResponseNodes(payload);
        for (const target of nodes) {
            const data = this.asRecord(target['data']);
            if (!data || !Object.keys(data).length) continue;
            if (this.isEnvelopeNode(target)) continue;
            return { data: this.normalizeFormSubmissionData(data) };
        }
        const rec = this.extractRecord(payload);
        return rec ? { data: this.normalizeFormSubmissionData(rec) } : null;
    }

    normalizeFormSubmissionData(raw: Record<string, unknown>): Record<string, unknown> {
        const normalized: Record<string, unknown> = { ...raw };
        const nestedData = this.asRecord(normalized['data']);
        const nestedDataValue = this.asRecord(normalized['data_value']);
        const promoteMissingFields = (source: Record<string, unknown> | null): void => {
            if (!source) return;
            Object.entries(source).forEach(([key, value]) => {
                if (value === undefined) return;
                if (Object.prototype.hasOwnProperty.call(normalized, key)) return;
                normalized[key] = value;
            });
        };
        promoteMissingFields(nestedData);
        promoteMissingFields(nestedDataValue);
        normalized['data_value'] = this.buildSubmissionDataValueAlias(normalized, nestedDataValue);
        return normalized;
    }

    buildSubmissionDataValueAlias(submission: Record<string, unknown>, explicitDataValue: Record<string, unknown> | null): Record<string, unknown> {
        const alias: Record<string, unknown> = explicitDataValue ? { ...explicitDataValue } : {};
        const excludedKeys = new Set(['data', 'data_value', 'schema', 'formio', 'components']);
        Object.entries(submission).forEach(([key, value]) => {
            if (excludedKeys.has(key) || value === undefined) return;
            if (Object.prototype.hasOwnProperty.call(alias, key)) return;
            alias[key] = value;
        });
        return alias;
    }

    async hydrateRemoteSelectSchema(schema: Record<string, unknown>, sub: Record<string, unknown> | null): Promise<Record<string, unknown>> {
        const hydrated = this.cloneSchema(schema);
        const formKey = String(hydrated['key'] || hydrated['name'] || hydrated['path'] || this.selectedModel || '').trim();
        this.normalizeFormTableComponents(hydrated);
        this.normalizeFormWysiwygComponents(hydrated);
        this.normalizeInteractiveSchemaComponents(hydrated);

        for (const comp of this.findSelectComponents(hydrated)) {
            const resourcePayload = this.extractResourceSelectPayload(comp, formKey);
            if (resourcePayload) {
                try {
                    const resourceOptions = await this.fetchResourceSelectOptions(resourcePayload);
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
                    const remoteOptions = await this.fetchRemoteSelectOptions(payload);
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
                const customValue = customKey ? (sub[customKey] ?? (this.isRecord(sub['data_value']) ? sub['data_value'][customKey] : null)) : null;
                if (Array.isArray(customValue)) {
                    const options = customValue.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
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
        this.normalizeFormWysiwygComponents(hydrated);
        this.normalizeInteractiveSchemaComponents(hydrated);

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
                const customValue = customKey ? (sub[customKey] ?? (this.isRecord(sub['data_value']) ? sub['data_value'][customKey] : null)) : null;
                if (Array.isArray(customValue)) {
                    const options = customValue.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
                    this.applyRemoteSelectValues(comp, options);
                }
            }
            this.ensureSelectTemplate(comp);
        }
        return hydrated;
    }

    /** Background: fetch remote selects for the current formSchema and patch it in-place, then trigger re-render. */
    async hydrateRemoteSelectsInBackground(sub: Record<string, unknown> | null): Promise<void> {
        if (!this.formSchema) return;
        const schema = this.formSchema;
        const formKey = String(schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
        let changed = false;
        for (const comp of this.findSelectComponents(schema)) {
            const resourcePayload = this.extractResourceSelectPayload(comp, formKey);
            if (resourcePayload) {
                try {
                    const resourceOptions = await this.fetchResourceSelectOptions(resourcePayload);
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(resourceOptions, selectedOptions));
                    changed = true;
                } catch (error) {
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Remote select fetch failed', error);
                }
                this.ensureSelectTemplate(comp);
                continue;
            }
            const payload = this.extractRemoteSelectPayload(comp, formKey);
            if (!payload) continue;
            try {
                const remoteOptions = await this.fetchRemoteSelectOptions(payload);
                const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                this.applyRemoteSelectValues(comp, this.mergeSelectValues(remoteOptions, selectedOptions));
                changed = true;
            } catch (error) {
                const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                this.applyRemoteSelectValues(comp, selectedOptions);
                console.error('Remote select fetch failed', error);
            }
            this.ensureSelectTemplate(comp);
        }
        if (changed && this.formSchema === schema) {
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
        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.pendingHydrationPromise = promise;
        this.pendingPostRenderHydration = {
            requestId: ++this.nextPostRenderHydrationRequestId,
            submission: this.cloneSubmissionData(sub),
            resolve,
            reject
        };
        return promise;
    }

    beginFormViewerLoad(): void {
        this.formViewerLoading = true;
    }

    cancelFormViewerLoad(): void {
        this.formViewerLoading = false;
    }

    async onFormViewerReady(): Promise<void> {
        this.formViewerLoading = false;
        const scheduled = this.pendingPostRenderHydration;
        if (!scheduled) return;
        if (this.activePostRenderHydrationRequestId === scheduled.requestId && this.activePostRenderHydrationPromise) {
            return this.activePostRenderHydrationPromise;
        }
        this.activePostRenderHydrationRequestId = scheduled.requestId;
        this.activePostRenderHydrationPromise = this.hydrateRemoteSelectsInBackground(scheduled.submission)
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
        this.clearScheduledRemoteSelectHydration();
        this.formSchema = null;
        this.formSubmission = null;
        this.formPreviewSubmission = null;
        this.rawFormSchema = null;
        this.rawFormSchemaModel = '';
        this.formViewerLoading = false;
        this.remoteSelectCache.clear();
        this.remoteSelectInflight.clear();
    }

    readEnvelopeFailureMessage(payload: unknown): string {
        const nodes = this.collectResponseNodes(payload, 4);
        for (const node of nodes) {
            const hasEnvelopeSignature = Boolean(this.asRecord(node['content'])) || (Object.prototype.hasOwnProperty.call(node, 'fail') && (Object.prototype.hasOwnProperty.call(node, 'message') || Object.prototype.hasOwnProperty.call(node, 'content')));
            if (!hasEnvelopeSignature) continue;
            const failed = this.toOptionalBooleanFlag(node['fail']);
            if (failed !== true) continue;
            const data = this.asRecord(node['data']);
            const message = this.readFirstString(node['message'], data ? data['message'] : undefined, 'Operazione fallita');
            return message || 'Operazione fallita';
        }
        return '';
    }

    collectResponseNodes(payload: unknown, maxDepth = 8): Record<string, unknown>[] {
        if (!this.isRecord(payload)) return [];
        const queue: Array<{ node: Record<string, unknown>; depth: number }> = [{ node: payload, depth: 0 }];
        const visited = new Set<Record<string, unknown>>();
        const nodes: Record<string, unknown>[] = [];
        while (queue.length) {
            const current = queue.shift();
            if (!current) break;
            const { node, depth } = current;
            if (visited.has(node)) continue;
            visited.add(node);
            nodes.push(node);
            if (depth >= maxDepth) continue;
            const nestedData = this.asRecord(node['data']);
            if (nestedData) queue.push({ node: nestedData, depth: depth + 1 });
            for (const wrapper of this.responseWrappers) {
                const nested = this.asRecord(node[wrapper]);
                if (!nested) continue;
                queue.push({ node: nested, depth: depth + 1 });
            }
        }
        return nodes;
    }

    extractRecord(payload: unknown): Record<string, unknown> | null {
        const nodes = this.collectResponseNodes(payload);
        for (const target of nodes) {
            const record = this.asRecord(target['record']);
            if (record) return record;
            const item = this.asRecord(target['item']);
            if (item) return item;
            const data = this.asRecord(target['data']);
            if (data && !this.isEnvelopeNode(target)) return data;
            if (!this.isEnvelopeNode(target)) return target;
        }
        return null;
    }

    scoreFormSubmissionData(record: Record<string, unknown> | null): number {
        if (!record) return 0;
        const ignoredKeys = new Set(['data', 'data_value', 'schema', 'formio', 'components', 'content', 'payload', 'response', 'result', 'action', 'fields', 'mode', 'fail', 'status', 'message', 'res_data', 'session_diff', 'query', 'columns', 'total_count', 'batch_size', 'editable_fields', 'obfucated_fields', 'filter_kyes']);
        let score = 0;
        Object.entries(record).forEach(([key, value]) => {
            if (ignoredKeys.has(key) || value === undefined || value === null) return;
            if (typeof value === 'string' && !value.trim()) return;
            if (this.isRecord(value) && !Object.keys(value).length) return;
            if (Array.isArray(value) && !value.length) return;
            score += 1;
            if (key === 'rec_name') score += 5;
            if (key === 'display' || key === 'title' || key === 'type' || key === 'data_model') score += 3;
        });
        return score;
    }

    resolveBestActionFormData(responseData: Record<string, unknown>, initialData: Record<string, unknown>, envelopeCandidates: unknown[]): Record<string, unknown> {
        let bestData = initialData;
        let bestScore = this.scoreFormSubmissionData(initialData);
        const consider = (candidate: unknown): void => {
            const record = this.asRecord(candidate);
            if (!record) return;
            const score = this.scoreFormSubmissionData(record);
            if (score <= bestScore) return;
            bestData = record;
            bestScore = score;
        };
        consider(responseData);
        consider(responseData['data']);
        envelopeCandidates.forEach(c => {
            const cr = this.asRecord(c);
            if (!cr) return;
            consider(cr);
            consider(cr['data']);
        });
        return bestData;
    }

    readComponentProperties(c: Record<string, unknown>): Record<string, unknown> {
        if (this.isRecord(c['properties'])) return c['properties'];
        if (this.isRecord(c['property'])) return c['property'];
        return {};
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
                const payload = this.extractRemoteSelectPayload(comp, formKey);
                if (payload) {
                    try {
                        const remoteOptions = await this.fetchRemoteSelectOptions(payload);
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
                        const options = customValue.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
                        this.applyRemoteSelectValues(comp, options);
                        schemaChanged = true;
                        submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    }
                }
            }
        } finally { this.isRefreshingDependentSelects = false; }
        if (schemaChanged && this.formSchema) this.formSchema = this.cloneSchema(this.formSchema);
        if (submissionChanged && submissionData) this.mergeSubmissionData(submissionData);
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
            const filtered = current.filter(e => allowedValues.has(this.optionLookupKey(e)));
            if (filtered.length === current.length) return false;
            submissionData[key] = filtered;
            return true;
        }
        if (current == null || current === '') return false;
        if (allowedValues.has(this.optionLookupKey(current))) return false;
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
            if (type === 'table') { node['tableView'] = true; node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-table'); }
            else if (type === 'datagrid' || type === 'editgrid') { node['tableView'] = true; node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-datagrid'); }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private normalizeFormWysiwygComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const key = String(node['key'] ?? '').trim().toLowerCase();
            const type = String(node['type'] ?? '').trim().toLowerCase();
            const props = this.readComponentProperties(node);
            const editorFlag = this.readFirstString(node['editor'], props['editor']).toLowerCase();
            if (key === 'content' && type === 'textarea' && editorFlag === 'active') { node['editor'] = 'ckeditor'; node['wysiwyg'] = true; }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private normalizeInteractiveSchemaComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            this.normalizeReadonlyComponent(node);
            this.normalizeOutlineButtonComponent(node);
            Object.values(node).forEach(visit);
        };
        visit(schema);
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
            const idKey = this.readFirstString(props['id'], comp['valueProperty'], 'id');
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

    private async fetchRemoteSelectOptions(payload: RemoteSelectRequestPayload): Promise<SelectValueOption[]> {
        const cacheKey = this.stableStringify(payload);
        const cached = this.remoteSelectCache.get(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const request = this.api.getRemoteSelect(payload)
            .then((response: unknown) => this.normalizeRemoteSelectResponse(response))
            .then((options: SelectValueOption[]) => { this.remoteSelectCache.set(cacheKey, options); return options; })
            .finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private async fetchResourceSelectOptions(payload: { model: string; payload: ListRequestPayload }): Promise<SelectValueOption[]> {
        const cacheKey = `resource:${this.stableStringify(payload)}`;
        const cached = this.remoteSelectCache.get(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const options: SelectValueOption[] = [];
        const request = this.api.streamList(payload.model, payload.payload, (item: unknown) => {
            const option = this.toSelectValueOption(item);
            if (option) options.push(option);
        }, undefined, { stream: false }).then(() => {
                this.remoteSelectCache.set(cacheKey, options);
                return options;
            })
            .finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private normalizeRemoteSelectResponse(payload: unknown): SelectValueOption[] {
        let target: unknown = payload;
        for (let i = 0; i < 4; i++) {
            if (this.isRecord(target) && this.isRecord(target['content'])) { target = target['content']['data'] ?? target['content']; continue; }
            if (this.isRecord(target)) { const next = target['data'] ?? target['items'] ?? target['records'] ?? target['values']; if (next !== undefined) { target = next; continue; } }
            break;
        }
        if (!Array.isArray(target)) return [];
        return target.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
    }

    private extractSubmissionSelectOptions(comp: Record<string, unknown>, sub: Record<string, unknown> | null): SelectValueOption[] {
        if (!sub) return [];
        const key = String(comp['key'] ?? '').trim();
        if (!key) return [];
        const current = sub[key];
        if (current == null) return [];
        const values = Array.isArray(current) ? current : [current];
        return values.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
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
            const parsed = candidate.map(e => this.toSelectValueOption(e)).filter((e): e is SelectValueOption => Boolean(e));
            if (parsed.length) return parsed;
        }
        return [];
    }

    private optionLookupKey(value: unknown): string {
        const primitive = this.optionPrimitiveValue(value);
        if (primitive == null) return '';
        if (typeof primitive === 'string') return `s:${primitive}`;
        if (typeof primitive === 'number') return `n:${primitive}`;
        if (typeof primitive === 'boolean') return `b:${primitive}`;
        if (Array.isArray(primitive)) return `a:${primitive.map(e => this.optionLookupKey(e)).join('|')}`;
        if (this.isRecord(primitive)) return `j:${this.stableStringify(primitive)}`;
        return `x:${String(primitive)}`;
    }

    private optionPrimitiveValue(value: unknown): unknown {
        return selectOptionPrimitiveValue(value);
    }

    toSelectValueOption(e: unknown): SelectValueOption | null {
        return mapSelectValueOption(e);
    }

    private isEnvelopeNode(node: Record<string, unknown>): boolean {
        if (!this.asRecord(node['content'])) return false;
        return Object.prototype.hasOwnProperty.call(node, 'fail') || Object.prototype.hasOwnProperty.call(node, 'message') || !Object.prototype.hasOwnProperty.call(node, 'mode');
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
