import { Injectable } from '@angular/core';
import { TableLazyLoadEvent, TableRowReorderEvent } from 'primeng/table';
import { OzonApiService } from '../core/ozon-api.service';
import {
    TableColumn, TableRow, SelectValueOption,
    QueryBuilderConfig, QueryBuilderFieldConfig, QueryMode, RuleSet, Rule
} from '../models/app.types';
import { ListRequestPayload, RemoteSelectRequestPayload } from '../models/ozon.types';

@Injectable()
export class AppTableManagerService {
    tableColumns: TableColumn[] = [{ field: '__rec_name', title: 'Record' }];
    tableRows: TableRow[] = [];
    selectedRows: TableRow[] = [];
    tableCalledInsideForm = false;
    tableCopyEnabled = false;
    tableRemoveEnabled = false;
    tableCopyActionPath = '';
    tableRemoveActionPath = '';
    filterText = '';
    primeSortField = 'rec_name';
    primeSortOrder = 1;
    currentPageIndex = 0;
    tableTotalRecords = 0;
    streamCount = 0;

    skip = 0;
    limit = 20;
    order = 'rec_name asc';

    queryText = '{}';
    queryMode: QueryMode = 'builder';
    queryBuilderRules: RuleSet = { condition: 'and', rules: [] };
    queryBuilderConfig: QueryBuilderConfig = {
        fields: { rec_name: { name: 'Record', type: 'string' } }
    };

    selectedRecordName = '';
    selectedModel = '';

    private tableColumnsInitialized = false;
    private serverColumns: TableColumn[] | null = null;
    strictHeaderColumns = true;
    private rowCounter = 0;
    allRows: TableRow[] = [];
    private rowBuffer: TableRow[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private lastColumnsRaw = '';
    isLoadingRecords = false;
    private lastQuerySignature = '';
    listQuerySeed: Record<string, unknown> | null = null;
    private tableRenderSchema: Record<string, unknown> | null = null;
    private tableCellRenderers = new Map<string, (value: unknown) => string>();
    private tableFieldRendererCache = new Map<string, ((value: unknown) => string) | null>();

    rawFormSchema: Record<string, unknown> | null = null;
    rawFormSchemaModel = '';

    sessionLocale = 'it';
    sessionTimezone = '';

    private readonly defaultPageSizeOptions = [10, 20, 30, 50];
    private readonly responseWrappers: Array<'content' | 'payload' | 'response' | 'result' | 'action'> = [
        'content', 'payload', 'response', 'result', 'action'
    ];

    private remoteSelectCache = new Map<string, SelectValueOption[]>();
    private remoteSelectInflight = new Map<string, Promise<SelectValueOption[]>>();

    constructor(private readonly api: OzonApiService) {}

    isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
    errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }

    get pageSize(): number { return this.getPageSize(); }

    get pageSizeOptions(): number[] {
        const pageSize = this.getPageSize();
        const options = [...this.defaultPageSizeOptions];
        if (!options.includes(pageSize)) options.push(pageSize);
        return options.sort((left, right) => left - right);
    }

    get tableColumnCount(): number { return this.tableColumns.length || 1; }

    get showTableRowCopyAction(): boolean { return this.tableCalledInsideForm && this.tableCopyEnabled; }
    get showTableRowRemoveAction(): boolean { return this.tableCalledInsideForm && this.tableRemoveEnabled; }
    get tableActionColumnCount(): number { return Number(this.showTableRowCopyAction) + Number(this.showTableRowRemoveAction); }
    get tableExtraColumnCount(): number { return 2 + this.tableActionColumnCount; }

    trackRowBy(_index: number, row: TableRow): number { return row.__rowid; }
    trackColumnBy(_index: number, column: TableColumn): string { return column.field; }

    displayCell(row: TableRow, field: string): string {
        const value = this.resolveFieldValue(row, field);
        const renderer = this.resolveTableCellRenderer(field);
        if (renderer) return renderer(value);
        return this.toDisplayValue(value);
    }

    setQueryMode(mode: QueryMode): void { this.queryMode = mode; }

    onQueryBuilderChanged(): void {
        if (this.queryMode !== 'builder') return;
        const query = this.queryBuilderToBackend(this.queryBuilderRules);
        this.queryText = JSON.stringify(query, null, 2);
    }

    resetQueryBuilderRules(): void {
        this.queryBuilderRules = { condition: 'and', rules: [] };
        this.onQueryBuilderChanged();
    }

    onFilterChanged(refreshFn: () => void): void { refreshFn(); }

    computeCurrentPageIndex(): number { return Math.floor((this.skip || 0) / this.getPageSize()); }
    getPageSize(): number { return Number(this.limit) || 20; }

    onTableLazyLoad(event: TableLazyLoadEvent, loadRecordsFn: (preserve: boolean) => Promise<void>): void {
        const previousSkip = this.skip;
        const previousLimit = this.limit;
        const previousOrder = this.order;

        const first = Number(event.first ?? this.skip);
        const rows = Number(event.rows ?? this.limit);

        if (Number.isFinite(first) && first >= 0) this.skip = first;
        if (Number.isFinite(rows) && rows > 0) this.limit = rows;

        this.currentPageIndex = this.computeCurrentPageIndex();
        this.syncOrderFromLazyEvent(event);

        const hasQueryChange = this.skip !== previousSkip || this.limit !== previousLimit || this.order !== previousOrder;
        if (!this.selectedModel || !hasQueryChange || this.isLoadingRecords) return;
        void loadRecordsFn(true);
    }

    onTableRowClick(row: TableRow, event: Event, rebuildMenusFn: () => void): void {
        if ((event.target as HTMLElement | null)?.closest('button, .p-checkbox, .pi-bars')) return;
        this.selectedRecordName = String(row.__rec_name ?? '');
        this.selectedRows = [row];
        rebuildMenusFn();
    }

    async onTableRowDblClick(row: TableRow, event: Event, rebuildMenusFn: () => void, openRecordFn: () => Promise<void>): Promise<void> {
        if ((event.target as HTMLElement | null)?.closest('button, .p-checkbox, .pi-bars')) return;
        this.selectedRecordName = String(row.__rec_name ?? '');
        this.selectedRows = [row];
        rebuildMenusFn();
        await openRecordFn();
    }

    onTableSelectionChange(value: unknown, rebuildMenusFn: () => void): void {
        const resolved = this.isRecord(value) && Array.isArray(value['value']) ? value['value'] : value;
        const rows = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
        const normalized = rows
            .filter((row): row is TableRow => this.isRecord(row))
            .map(row => row as TableRow);
        this.selectedRows = normalized;
        this.selectedRecordName = String(normalized[0]?.__rec_name ?? '').trim();
        rebuildMenusFn();
    }

    onRowReorder(event: TableRowReorderEvent, setStatusFn: (m: string, e: boolean) => void): void {
        if (this.filterText.trim()) {
            setStatusFn('Disattiva il filtro prima di riordinare le righe', true);
            return;
        }
        const from = Number(event.dragIndex);
        const to = Number(event.dropIndex);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
        const rows = [...this.allRows];
        const moved = rows.splice(from, 1)[0];
        if (!moved) return;
        rows.splice(to, 0, moved);
        this.allRows = [...rows];
        this.refreshTableRows();
        setStatusFn('Ordine righe aggiornato (solo vista corrente)', false);
    }

    onModelChanged(): void {
        this.skip = 0;
        this.currentPageIndex = 0;
        this.tableTotalRecords = 0;
        this.listQuerySeed = null;
        this.clearTableCellRenderers();
        this.lastQuerySignature = '';
        this.remoteSelectCache.clear();
        this.remoteSelectInflight.clear();
        this.resetQueryBuilderRules();
        this.resetTableRowActionsConfig();
        this.resetSelectionAndTable();
    }

    async prevPage(loadRecordsFn: () => Promise<void>): Promise<void> {
        this.skip = Math.max(0, (this.skip || 0) - this.getPageSize());
        await loadRecordsFn();
    }

    async nextPage(loadRecordsFn: () => Promise<void>): Promise<void> {
        this.skip = Math.max(0, (this.skip || 0) + this.getPageSize());
        await loadRecordsFn();
    }

    parseQueryInput(setStatusFn: (m: string, e: boolean) => void): Record<string, unknown> | null {
        if (this.queryMode === 'builder') {
            try {
                const query = this.queryBuilderToBackend(this.queryBuilderRules);
                this.queryText = JSON.stringify(query, null, 2);
                return this.applyListQuerySeed(query);
            } catch (e) {
                setStatusFn(this.errorMessage(e), true);
                return null;
            }
        }
        const raw = (this.queryText || '').trim();
        if (!raw) return this.applyListQuerySeed({});
        try {
            const p = JSON.parse(raw);
            if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Query JSON deve essere un oggetto');
            return this.applyListQuerySeed(p as Record<string, unknown>);
        } catch (e) {
            setStatusFn(this.errorMessage(e), true);
            return null;
        }
    }

    buildListPayload(): ListRequestPayload {
        return {
            query: {},
            skip: Number.isFinite(this.skip) && this.skip >= 0 ? this.skip : 0,
            limit: Number.isFinite(this.limit) && this.limit > 0 ? this.limit : 20,
            order: (this.order || 'rec_name asc').trim() || 'rec_name asc'
        };
    }

    prepareLoadRecords(preservePaginatorState: boolean, querySignature: string): void {
        if (!preservePaginatorState && this.lastQuerySignature && this.lastQuerySignature !== querySignature) {
            this.skip = 0;
            this.currentPageIndex = 0;
        }
        this.isLoadingRecords = true;
        this.resetSelectionAndTable({ preservePaginationState: preservePaginatorState, preserveFilterText: preservePaginatorState });
        this.strictHeaderColumns = true;
        this.currentPageIndex = this.computeCurrentPageIndex();
        this.syncPrimeSortFromOrder(this.order);
    }

    finishLoadRecords(querySignature: string, streamResult: { count: number; totalCount: number; skip?: string; limit?: string }): void {
        this.flushRows();
        this.lastQuerySignature = querySignature;
        this.syncPaginationStateFromStream(streamResult);
        this.isLoadingRecords = false;
    }

    stableStringify(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map(entry => this.stableStringify(entry)).join(',')}]`;
        if (this.isRecord(value)) {
            const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
            return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`).join(',')}}`;
        }
        return JSON.stringify(value ?? null);
    }

    appendRecordRow(payload: unknown): void {
        const rec = this.extractRecord(payload);
        if (!rec) return;
        this.rowCounter += 1;
        const recName = this.computeRecordName(rec, this.rowCounter);
        const row: TableRow = {
            ...rec,
            rec_name: this.readFirstString(rec['rec_name'], recName) || recName,
            __rowid: this.rowCounter,
            __rec_name: recName
        };
        if (!this.tableColumnsInitialized) {
            this.tableColumns = this.serverColumns ? [...this.serverColumns] : (this.strictHeaderColumns ? [] : this.buildTableColumnsFromRow(row));
            this.tableColumnsInitialized = true;
            this.syncQueryBuilderFields(this.tableColumns);
        }
        this.enqueueRow(row);
    }

    applyTableColumnsFromHeader(payload: unknown): void {
        const cols = this.buildTableColumnsFromHeader(payload);
        if (!cols?.length) return;
        this.serverColumns = cols;
        this.tableColumns = [...cols];
        this.tableColumnsInitialized = true;
        this.syncQueryBuilderFields(this.tableColumns);
        this.refreshTableRows();
    }

    setLastColumnsRaw(raw: string): void {
        this.lastColumnsRaw = raw;
        this.strictHeaderColumns = Boolean(raw.trim());
    }

    resetTableRowActionsConfig(): void {
        this.tableCalledInsideForm = false;
        this.tableCopyEnabled = false;
        this.tableRemoveEnabled = false;
        this.tableCopyActionPath = '';
        this.tableRemoveActionPath = '';
    }

    syncTableRowActionsConfig(response: Record<string, unknown>): void {
        const fields = this.isRecord(response['fields']) ? response['fields'] : {};
        const data = this.isRecord(response['data']) ? response['data'] : {};
        const candidates: Array<Record<string, unknown>> = [
            fields, data,
            this.isRecord(fields['table']) ? fields['table'] : {},
            this.isRecord(fields['table_action']) ? fields['table_action'] : {},
            this.isRecord(fields['table_actions']) ? fields['table_actions'] : {},
            this.isRecord(data['table']) ? data['table'] : {},
            this.isRecord(data['table_action']) ? data['table_action'] : {},
            this.isRecord(data['table_actions']) ? data['table_actions'] : {},
            this.isRecord(data['settings']) ? data['settings'] : {}
        ];

        const inForm = this.readFirstBooleanFromCandidates(candidates, ['table_in_form', 'in_form', 'inside_form', 'is_form_context', 'form_context', 'called_in_form', 'from_form']);
        const copyEnabled = this.readFirstBooleanFromCandidates(candidates, ['table_copy_enabled', 'copy_enabled', 'enable_copy', 'allow_copy', 'copy_active', 'show_copy']);
        const removeEnabled = this.readFirstBooleanFromCandidates(candidates, ['table_remove_enabled', 'remove_enabled', 'enable_remove', 'allow_remove', 'remove_active', 'show_remove', 'delete_enabled', 'enable_delete']);
        const copyActionPath = this.readFirstStringFromCandidates(candidates, ['copy_url', 'table_copy_url', 'copy_action_url', 'copy_action', 'url_action_copy']);
        const removeActionPath = this.readFirstStringFromCandidates(candidates, ['remove_url', 'table_remove_url', 'delete_url', 'remove_action_url', 'delete_action_url', 'remove_action', 'delete_action', 'url_action_remove']);

        this.tableCalledInsideForm = inForm ?? false;
        this.tableCopyEnabled = copyEnabled ?? Boolean(copyActionPath);
        this.tableRemoveEnabled = removeEnabled ?? Boolean(removeActionPath);
        this.tableCopyActionPath = copyActionPath;
        this.tableRemoveActionPath = removeActionPath;
    }

    resolveTableRowActionPath(rawActionPath: string, recName: string, normalizeActionUrl: (u: string) => string, normalizeNextActionRedirectCandidate: (c: unknown) => string): string {
        const raw = this.readFirstString(rawActionPath);
        if (!raw) return '';
        const encodedRecName = encodeURIComponent(recName);
        let resolved = raw;
        const placeholderPatterns = [/\{\{\s*rec_name\s*\}\}/gi, /\{\s*rec_name\s*\}/gi, /<\s*rec_name\s*>/gi, /:rec_name\b/gi, /\$rec_name\b/gi];
        placeholderPatterns.forEach(pattern => { resolved = resolved.replace(pattern, encodedRecName); });

        let normalized = normalizeNextActionRedirectCandidate(resolved);
        if (!normalized) normalized = normalizeActionUrl(resolved);
        if (!normalized) return '';
        if (this.shouldAppendRowRecNameToActionPath(normalized, recName, encodedRecName)) {
            return this.appendRecNameToActionPath(normalized, encodedRecName, normalizeActionUrl);
        }
        return normalized;
    }

    removeRowFromView(rowId: number, recName: string, rebuildMenusFn: () => void, setStatusFn: (m: string, e: boolean) => void): void {
        this.allRows = this.allRows.filter(entry => entry.__rowid !== rowId);
        this.selectedRows = this.selectedRows.filter(entry => entry.__rowid !== rowId);
        if (this.selectedRecordName === recName) this.selectedRecordName = '';
        this.refreshTableRows();
        this.tableTotalRecords = Math.max(0, this.tableTotalRecords - 1);
        rebuildMenusFn();
        setStatusFn(`Record rimosso dalla vista: ${recName || rowId}`, false);
    }

    removeCurrentRecordFromView(rebuildMenusFn: () => void, setStatusFn: (m: string, e: boolean) => void): void {
        const recName = String(this.selectedRecordName ?? '').trim();
        if (!recName) {
            setStatusFn('Nessun record selezionato da rimuovere', true);
            return;
        }
        const before = this.allRows.length;
        this.allRows = this.allRows.filter(entry => String(entry.__rec_name ?? '') !== recName);
        this.selectedRows = this.selectedRows.filter(entry => String(entry.__rec_name ?? '') !== recName);
        this.selectedRecordName = '';
        this.refreshTableRows();
        const removed = before - this.allRows.length;
        if (removed > 0) this.tableTotalRecords = Math.max(0, this.tableTotalRecords - removed);
        rebuildMenusFn();
        setStatusFn(
            removed > 0 ? `Record rimosso dalla vista: ${recName}` : `Record non presente nella vista corrente: ${recName}`,
            removed <= 0
        );
    }

    async refreshTableCellRenderers(rows: Array<Record<string, unknown>> = []): Promise<void> {
        const canReuseCachedSchema =
            Boolean(this.rawFormSchema)
            && (!this.selectedModel || !this.rawFormSchemaModel || this.rawFormSchemaModel === this.selectedModel);
        const schema = canReuseCachedSchema ? this.rawFormSchema : null;
        await this.configureTableCellRenderers(schema, rows);
    }

    async configureTableCellRenderers(
        schema: Record<string, unknown> | null,
        rows: Array<Record<string, unknown>> = []
    ): Promise<void> {
        if (!schema) {
            this.clearTableCellRenderers();
            return;
        }
        let renderSchema = this.cloneSchema(schema);
        try {
            const sampleSubmission = this.buildTableRenderSubmission(rows);
            renderSchema = await this.hydrateRemoteSelectSchema(renderSchema, sampleSubmission);
        } catch {
            // Fallback: keep raw schema if remote select hydration fails.
        }
        this.tableRenderSchema = renderSchema;
        this.rebuildTableCellRenderers(renderSchema);
    }

    clearTableCellRenderers(): void {
        this.tableRenderSchema = null;
        this.tableCellRenderers.clear();
        this.tableFieldRendererCache.clear();
    }

    resetSelectionAndTable(opt: { preservePaginationState?: boolean; preserveFilterText?: boolean } = {}): void {
        this.selectedRecordName = '';
        this.selectedRows = [];
        this.streamCount = 0;
        this.rowCounter = 0;
        this.tableColumnsInitialized = false;
        this.serverColumns = null;
        this.tableColumns = [{ field: '__rec_name', title: 'Record' }];
        this.allRows = [];
        this.tableRows = [];
        this.rowBuffer = [];
        this.tableFieldRendererCache.clear();
        this.syncQueryBuilderFields(this.tableColumns);
        if (!opt.preserveFilterText) this.filterText = '';
        if (!opt.preservePaginationState) this.tableTotalRecords = 0;
        this.currentPageIndex = this.computeCurrentPageIndex();
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    }

    refreshTableRows(): void {
        const f = this.filterText.trim().toLowerCase();
        this.tableRows = f ? this.allRows.filter(r => this.rowMatchesFilter(r, f)) : [...this.allRows];
        return;
    }

    reconcileSelectionWithVisibleRows(): boolean {
        const visibleRecNames = new Set(this.tableRows.map(row => String(row.__rec_name ?? '')));
        let changed = false;

        const filteredRows = this.selectedRows.filter(row => visibleRecNames.has(String(row.__rec_name ?? '')));
        if (filteredRows.length !== this.selectedRows.length) {
            this.selectedRows = filteredRows;
            changed = true;
        }

        if (this.selectedRecordName && !visibleRecNames.has(this.selectedRecordName)) {
            this.selectedRecordName = '';
            changed = true;
        }

        if (!this.selectedRecordName && this.selectedRows.length) {
            this.selectedRecordName = String(this.selectedRows[0].__rec_name ?? '').trim();
            changed = true;
        }
        return changed;
    }

    flushRows(): void {
        if (!this.rowBuffer.length) return;
        this.allRows = [...this.allRows, ...this.rowBuffer.splice(0, this.rowBuffer.length)];
        this.refreshTableRows();
    }

    syncListQuerySeed(
        response: Record<string, unknown>,
        responseData: Record<string, unknown>,
        listSchema: Record<string, unknown> | null
    ): void {
        const fields = this.isRecord(response['fields']) ? response['fields'] : {};
        const data = this.isRecord(response['data']) ? response['data'] : {};
        const tableField = this.isRecord(fields['table']) ? fields['table'] : {};
        const tableData = this.isRecord(data['table']) ? data['table'] : {};
        const settingsData = this.isRecord(data['settings']) ? data['settings'] : {};
        const directCandidates: unknown[] = [fields['query'], data['query'], tableField['query'], tableData['query'], settingsData['query']];
        for (const candidate of directCandidates) {
            const normalized = this.normalizeQuerySeed(candidate);
            if (normalized) { this.listQuerySeed = normalized; return; }
        }
        this.listQuerySeed = this.findWellQuerySeed(listSchema);
    }

    normalizeActionListData(payload: unknown): Array<Record<string, unknown>> {
        if (Array.isArray(payload)) {
            return payload.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
        }
        if (!this.isRecord(payload)) return [];
        const target = payload['data'] ?? payload['items'] ?? payload['records'];
        if (Array.isArray(target)) {
            return target.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
        }
        return [];
    }

    resolveActionListColumnsPayload(
        response: Record<string, unknown>,
        responseData: Record<string, unknown>
    ): { payload: unknown; explicit: boolean } {
        const fields = this.isRecord(response['fields']) ? response['fields'] : {};
        const responseTable = this.isRecord(responseData['table']) ? responseData['table'] : {};
        const fieldTable = this.isRecord(fields['table']) ? fields['table'] : {};
        const candidates: unknown[] = [response['columns'], responseData['columns'], responseTable['columns'], fields['columns'], fieldTable['columns']];

        let fallback: unknown = null;
        for (const candidate of candidates) {
            if (candidate == null) continue;
            if (typeof candidate === 'string' && !candidate.trim()) continue;
            if (fallback == null) fallback = candidate;
            if (this.buildTableColumnsFromHeader(candidate)?.length) {
                return { payload: candidate, explicit: true };
            }
        }
        return { payload: fallback, explicit: false };
    }

    async hydrateRemoteSelectSchema(schema: Record<string, unknown>, sub: Record<string, unknown> | null): Promise<Record<string, unknown>> {
        const hydrated = this.cloneSchema(schema);
        const formKey = String(hydrated['key'] || hydrated['name'] || hydrated['path'] || this.selectedModel || '').trim();
        this.normalizeFormTableComponents(hydrated);
        this.normalizeFormWysiwygComponents(hydrated);

        for (const comp of this.findSelectComponents(hydrated)) {
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
                    const options = customValue.map(entry => this.toSelectValueOption(entry)).filter((entry): entry is SelectValueOption => Boolean(entry));
                    this.applyRemoteSelectValues(comp, options);
                }
            }
            this.ensureSelectTemplate(comp);
        }
        return hydrated;
    }

    parseNonNegativeInt(value: unknown, fallback = 0): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return fallback;
        return Math.floor(parsed);
    }

    readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) {
            if (typeof entry === 'string' && entry.trim()) return entry.trim();
        }
        return '';
    }

    cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
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

    private applyListQuerySeed(query: Record<string, unknown>): Record<string, unknown> {
        const seed = this.listQuerySeed && this.isRecord(this.listQuerySeed) ? this.cloneSchema(this.listQuerySeed) : null;
        if (!seed || !Object.keys(seed).length) return query;
        if (!query || !Object.keys(query).length) return seed;
        return { $and: [seed, query] };
    }

    private queryBuilderToBackend(root: RuleSet): Record<string, unknown> {
        const expr = this.convertRuleSetToMongo(root);
        if (!expr) return {};
        if (this.isRecord(expr)) return expr;
        return {};
    }

    private convertRuleSetToMongo(node: RuleSet): Record<string, unknown> | null {
        const condition = String(node?.condition ?? 'and').toLowerCase() === 'or' ? '$or' : '$and';
        const clauses = (Array.isArray(node?.rules) ? node.rules : [])
            .map(rule => this.convertRuleNodeToMongo(rule))
            .filter((rule): rule is Record<string, unknown> => Boolean(rule && this.isRecord(rule)));
        if (!clauses.length) return null;
        if (clauses.length === 1) return clauses[0];
        return { [condition]: clauses };
    }

    private convertRuleNodeToMongo(node: RuleSet | Rule): Record<string, unknown> | null {
        if (!node) return null;
        if (Array.isArray((node as RuleSet).rules)) return this.convertRuleSetToMongo(node as RuleSet);
        return this.convertRuleToMongo(node as Rule);
    }

    private convertRuleToMongo(rule: Rule): Record<string, unknown> | null {
        const field = String(rule.field ?? '').trim();
        if (!field) return null;
        const operator = String(rule.operator ?? '=').trim().toLowerCase();
        const value = rule.value;
        switch (operator) {
            case '=': return { [field]: value };
            case '!=': case '<>': return { [field]: { $ne: value } };
            case '<': return { [field]: { $lt: value } };
            case '<=': return { [field]: { $lte: value } };
            case '>': return { [field]: { $gt: value } };
            case '>=': return { [field]: { $gte: value } };
            case 'contains': return { [field]: { $regex: this.escapeRegex(this.toDisplayValue(value)), $options: 'i' } };
            case 'does not contain': return { [field]: { $not: { $regex: this.escapeRegex(this.toDisplayValue(value)), $options: 'i' } } };
            case 'begins with': return { [field]: { $regex: `^${this.escapeRegex(this.toDisplayValue(value))}`, $options: 'i' } };
            case 'ends with': return { [field]: { $regex: `${this.escapeRegex(this.toDisplayValue(value))}$`, $options: 'i' } };
            case 'is null': return { [field]: null };
            case 'is not null': return { [field]: { $ne: null } };
            case 'in': return { [field]: { $in: this.normalizeArrayValue(value) } };
            case 'not in': return { [field]: { $nin: this.normalizeArrayValue(value) } };
            default: return { [field]: value };
        }
    }

    private normalizeArrayValue(value: unknown): unknown[] {
        if (Array.isArray(value)) return value;
        const text = String(value ?? '').trim();
        if (!text) return [];
        if (text.startsWith('[') && text.endsWith(']')) {
            try { const p = JSON.parse(text); if (Array.isArray(p)) return p; } catch { return text.split(',').map(e => e.trim()).filter(Boolean); }
        }
        return text.split(',').map(e => e.trim()).filter(Boolean);
    }

    private escapeRegex(value: string): string { return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    private syncOrderFromLazyEvent(event: TableLazyLoadEvent): void {
        const field = String(Array.isArray(event.sortField) ? event.sortField[0] : event.sortField ?? '').trim();
        if (!field) return;
        const dir = Number(event.sortOrder) === -1 ? 'desc' : 'asc';
        this.order = `${field} ${dir}`;
        this.primeSortField = field;
        this.primeSortOrder = dir === 'asc' ? 1 : -1;
    }

    private syncPrimeSortFromOrder(orderValue: unknown): void {
        const raw = String(orderValue ?? '').trim();
        if (!raw) return;
        const parts = raw.split(/\s+/).filter(Boolean);
        if (!parts.length) return;
        const dir = (parts[parts.length - 1] ?? '').toLowerCase();
        const field = (dir === 'asc' || dir === 'desc' ? parts.slice(0, -1) : parts).join(' ').trim();
        if (!field) return;
        this.primeSortField = field;
        this.primeSortOrder = dir === 'desc' ? -1 : 1;
    }

    private syncPaginationStateFromStream(result: { count: number; totalCount: number; skip?: string; limit?: string }): void {
        const nextSkip = this.parseNonNegativeInt(result.skip, this.skip);
        const nextLimit = this.parseNonNegativeInt(result.limit, this.limit || 20);
        this.skip = nextSkip;
        this.limit = nextLimit > 0 ? nextLimit : this.limit;
        this.currentPageIndex = this.computeCurrentPageIndex();
        const totalCount = this.parseNonNegativeInt(result.totalCount, result.count);
        this.tableTotalRecords = Math.max(totalCount, result.count);
    }

    private rowMatchesFilter(row: TableRow, filter: string): boolean {
        return this.tableColumns.some(c => this.displayCell(row, c.field).toLowerCase().includes(filter));
    }

    private resolveFieldValue(row: TableRow, field: string): unknown {
        const candidates = String(field).split(',').map(v => v.trim()).filter(Boolean);
        if (!candidates.length && String(field ?? '').trim()) candidates.push(String(field).trim());
        const contexts = this.resolveRowValueContexts(row);
        for (const candidate of candidates) {
            for (const context of contexts) {
                if (Object.prototype.hasOwnProperty.call(context, candidate)) return context[candidate];
                const resolved = this.resolvePath(context, candidate);
                if (resolved !== undefined) return resolved;
            }
        }
        return undefined;
    }

    private resolveRowValueContexts(row: TableRow): Array<Record<string, unknown>> {
        const contexts: Array<Record<string, unknown>> = [row];
        const nestedData = this.asRecord(row['data']);
        const nestedDataValue = this.asRecord(row['data_value']);
        if (nestedData && !contexts.includes(nestedData)) contexts.push(nestedData);
        if (nestedDataValue && !contexts.includes(nestedDataValue)) contexts.push(nestedDataValue);
        return contexts;
    }

    private resolvePath(src: Record<string, unknown>, path: string): unknown {
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

    private enqueueRow(row: TableRow): void {
        this.rowBuffer.push(row);
        if (this.rowBuffer.length >= 100) { this.flushRows(); return; }
        if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushRows(); }, 35);
    }

    private buildTableColumnsFromHeader(payload: unknown): TableColumn[] | null {
        const normalizedPayload = this.normalizeTableColumnsPayload(payload);
        const cols: TableColumn[] = [];
        const add = (f: unknown, l: unknown) => {
            const field = String(f ?? '').trim();
            if (!field || field === '__rowid' || cols.some(e => e.field === field)) return;
            const fallbackTitle = field === 'rec_name' ? 'Record' : field;
            cols.push({ field, title: String(l ?? fallbackTitle).trim() || fallbackTitle });
        };
        if (Array.isArray(normalizedPayload)) {
            normalizedPayload.forEach(e => {
                if (typeof e === 'string') { add(e, undefined); }
                else if (Array.isArray(e) && e.length >= 1) { add(e[0], e[1]); }
                else if (this.isRecord(e)) { add((e as Record<string, unknown>)['k'] ?? (e as Record<string, unknown>)['field'] ?? (e as Record<string, unknown>)['name'], (e as Record<string, unknown>)['v'] ?? (e as Record<string, unknown>)['label'] ?? (e as Record<string, unknown>)['title']); }
            });
        } else if (this.isRecord(normalizedPayload)) {
            Object.entries(normalizedPayload).forEach(([f, v]) => add(f, this.isRecord(v) ? (v as Record<string, unknown>)['v'] ?? (v as Record<string, unknown>)['label'] ?? (v as Record<string, unknown>)['title'] : v));
        }
        return cols.length ? cols : null;
    }

    private normalizeTableColumnsPayload(payload: unknown): unknown {
        const parsed = this.parseJsonMaybe(payload);
        const normalized = parsed ?? payload;
        if (typeof normalized === 'string') return normalized.split(',').map(e => e.trim()).filter(Boolean);
        if (this.isRecord(normalized) && Object.prototype.hasOwnProperty.call(normalized, 'columns')) return normalized['columns'];
        return normalized;
    }

    private buildTableColumnsFromRow(row: TableRow): TableColumn[] {
        const cols: TableColumn[] = [{ field: '__rec_name', title: 'Record' }];
        Object.keys(row).filter(k => k !== '__rowid' && k !== '__rec_name').forEach(k => cols.push({ field: k, title: k }));
        return cols;
    }

    private syncQueryBuilderFields(columns: TableColumn[]): void {
        const fields: QueryBuilderConfig['fields'] = {};
        columns.filter(c => c.field !== '__rowid' && c.field !== '__rec_name').forEach(c => {
            fields[c.field] = { name: c.title || c.field, type: this.detectQueryFieldType(c.field) };
        });
        if (!fields['rec_name']) fields['rec_name'] = { name: 'Record', type: 'string' };
        this.queryBuilderConfig = { ...this.queryBuilderConfig, fields };
        this.pruneInvalidRules(this.queryBuilderRules, new Set(Object.keys(fields)));
    }

    private detectQueryFieldType(field: string): string {
        for (const row of this.allRows) {
            const value = this.resolveFieldValue(row, field);
            if (value == null) continue;
            if (typeof value === 'number') return 'number';
            if (typeof value === 'boolean') return 'boolean';
            return 'string';
        }
        return 'string';
    }

    private pruneInvalidRules(ruleset: RuleSet, allowedFields: Set<string>): void {
        if (!Array.isArray(ruleset.rules)) { ruleset.rules = []; return; }
        ruleset.rules = ruleset.rules.filter(rule => {
            if (!rule) return false;
            if (Array.isArray((rule as RuleSet).rules)) {
                this.pruneInvalidRules(rule as RuleSet, allowedFields);
                return (rule as RuleSet).rules.length > 0;
            }
            const field = String((rule as Rule).field ?? '').trim();
            return field ? allowedFields.has(field) : false;
        });
    }

    private rebuildTableCellRenderers(schema: Record<string, unknown>): void {
        this.tableCellRenderers.clear();
        this.tableFieldRendererCache.clear();
        this.collectTableCellRenderers(schema);
    }

    private collectTableCellRenderers(node: unknown): void {
        if (Array.isArray(node)) { node.forEach(e => this.collectTableCellRenderers(e)); return; }
        if (!this.isRecord(node)) return;
        const key = String(node['key'] ?? '').trim();
        if (key) {
            const renderer = this.createTableCellRenderer(node);
            if (renderer) this.tableCellRenderers.set(key, renderer);
        }
        Object.values(node).forEach(e => this.collectTableCellRenderers(e));
    }

    private createTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        if (type === 'select' || type === 'radio') return this.createOptionsTableCellRenderer(component);
        if (type === 'selectboxes') return this.createSelectBoxesTableCellRenderer(component);
        if (type === 'datetime' || type === 'day' || type === 'time') return this.createDateTableCellRenderer(component);
        return null;
    }

    private createDateTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        const format = this.readDateComponentFormat(component);
        const widget = this.isRecord(component['widget']) ? component['widget'] : {};
        const showDateFromFormat = this.dateFormatContainsDateToken(format);
        const showTimeFromFormat = this.dateFormatContainsTimeToken(format);
        const showDate = type === 'time' ? false : (showDateFromFormat || type === 'datetime' || type === 'day');
        const showTime = type === 'day'
            ? false
            : (showTimeFromFormat || type === 'datetime' || type === 'time'
                || this.toOptionalBooleanFlag(component['enableTime']) === true
                || this.toOptionalBooleanFlag(widget['enableTime']) === true);
        const showSeconds = format.includes('ss');

        const renderSingle = (entry: unknown): string => {
            const parsed = this.parseDateLikeValue(entry, showDate, showTime);
            if (!parsed) return this.toDisplayValue(entry);
            return this.formatDateLikeValue(parsed, showDate, showTime, showSeconds);
        };
        return (value: unknown): string => {
            if (Array.isArray(value)) return value.map(e => renderSingle(e)).filter(Boolean).join(', ');
            return renderSingle(value);
        };
    }

    private readDateComponentFormat(component: Record<string, unknown>): string {
        const widget = this.isRecord(component['widget']) ? component['widget'] : {};
        const data = this.isRecord(component['data']) ? component['data'] : {};
        return this.readFirstString(component['format'], widget['format'], data['format'], component['displayFormat']);
    }

    private dateFormatContainsDateToken(format: string): boolean { return /[dDMyY]/.test(format); }
    private dateFormatContainsTimeToken(format: string): boolean { return /[hHsSaA]/.test(format) || /(^|[^M])m/.test(format); }

    private parseDateLikeValue(value: unknown, showDate: boolean, showTime: boolean): Date | null {
        if (value == null) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        const normalized = this.normalizeDateLikeValue(value);
        if (normalized instanceof Date) return Number.isNaN((normalized as Date).getTime()) ? null : normalized as Date;
        if (typeof normalized === 'number') return this.dateFromEpoch(normalized);
        if (typeof normalized !== 'string') return null;
        const raw = normalized.trim();
        if (!raw) return null;
        if (showTime && !showDate) {
            const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (timeMatch) {
                const hours = Number(timeMatch[1]); const minutes = Number(timeMatch[2]); const seconds = Number(timeMatch[3] ?? '0');
                if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
                    const base = new Date(); base.setHours(hours, minutes, seconds, 0); return base;
                }
            }
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const [year, month, day] = raw.split('-').map(part => Number(part));
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            const parsed = new Date(year, month - 1, day);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (/^-?\d+(\.\d+)?$/.test(raw) && raw.replace('-', '').length >= 10) {
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) return this.dateFromEpoch(numeric);
        }
        const normalizedIso = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
        const parsed = new Date(normalizedIso);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private normalizeDateLikeValue(value: unknown): unknown {
        if (this.isRecord(value)) {
            const nested = this.isRecord(value['data']) ? value['data'] : null;
            const candidate = value['value'] ?? value['date'] ?? value['datetime'] ?? value['time'] ?? value['timestamp']
                ?? value['_value'] ?? nested?.['value'] ?? nested?.['date'] ?? nested?.['datetime'] ?? nested?.['time'] ?? nested?.['timestamp'];
            if (candidate !== undefined) return candidate;
        }
        return value;
    }

    private dateFromEpoch(value: number): Date | null {
        if (!Number.isFinite(value)) return null;
        const asMillis = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(asMillis);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private formatDateLikeValue(date: Date, showDate: boolean, showTime: boolean, showSeconds: boolean): string {
        if (!showDate && !showTime) return this.toDisplayValue(date.toISOString());
        const options: Intl.DateTimeFormatOptions = {};
        if (showDate) { options.day = '2-digit'; options.month = '2-digit'; options.year = 'numeric'; }
        if (showTime) { options.hour = '2-digit'; options.minute = '2-digit'; if (showSeconds) options.second = '2-digit'; options.hour12 = false; }
        if (this.sessionTimezone) options.timeZone = this.sessionTimezone;
        const locale = this.sessionLocale || 'it';
        try { return new Intl.DateTimeFormat(locale, options).format(date); } catch {
            if (options.timeZone) delete options.timeZone;
            return new Intl.DateTimeFormat('it', options).format(date);
        }
    }

    private toOptionalBooleanFlag(value: unknown): boolean | null {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return null;
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
            return null;
        }
        return null;
    }

    private createOptionsTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const options = this.extractSchemaOptions(component);
        if (!options.length) return null;
        const labelsByValue = new Map<string, string>();
        options.forEach(e => { const k = this.optionLookupKey(e.value); if (!k || labelsByValue.has(k)) return; labelsByValue.set(k, e.label); });
        const renderSingle = (entry: unknown): string => {
            if (entry == null) return '';
            const parsed = this.toSelectValueOption(entry);
            if (parsed) {
                const mappedFromParsed = labelsByValue.get(this.optionLookupKey(parsed.value));
                if (mappedFromParsed) return mappedFromParsed;
                if (this.isRecord(entry) && parsed.label) return parsed.label;
            }
            const mapped = labelsByValue.get(this.optionLookupKey(entry));
            if (mapped) return mapped;
            return this.toDisplayValue(entry);
        };
        return (value: unknown): string => {
            if (Array.isArray(value)) return value.map(e => renderSingle(e)).filter(Boolean).join(', ');
            return renderSingle(value);
        };
    }

    private createSelectBoxesTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const options = this.extractSchemaOptions(component);
        if (!options.length) return null;
        const lookup = options.map(e => ({ field: this.optionFieldKey(e.value), valueKey: this.optionLookupKey(e.value), label: e.label })).filter(e => Boolean(e.field || e.valueKey));
        if (!lookup.length) return null;
        const labelsByValue = new Map<string, string>();
        lookup.forEach(e => { if (e.valueKey && !labelsByValue.has(e.valueKey)) labelsByValue.set(e.valueKey, e.label); });
        return (value: unknown): string => {
            if (Array.isArray(value)) return value.map(e => labelsByValue.get(this.optionLookupKey(e)) || this.toDisplayValue(e)).filter(Boolean).join(', ');
            if (this.isRecord(value)) {
                const labels: string[] = [];
                lookup.forEach(e => { if (!e.field) return; if (this.toOptionalBooleanFlag(value[e.field]) === true) labels.push(e.label); });
                if (labels.length) return labels.join(', ');
            }
            const mapped = labelsByValue.get(this.optionLookupKey(value));
            if (mapped) return mapped;
            return this.toDisplayValue(value);
        };
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

    private optionFieldKey(value: unknown): string {
        const primitive = this.optionPrimitiveValue(value);
        if (typeof primitive === 'string' || typeof primitive === 'number') return String(primitive);
        return '';
    }

    private optionPrimitiveValue(value: unknown): unknown {
        if (!this.isRecord(value)) return value;
        const nested = this.isRecord(value['data']) ? value['data'] : null;
        const primitive = value['value'] ?? value['id'] ?? value['_id'] ?? value['code'] ?? value['key'] ?? value['k'] ?? value['name']
            ?? nested?.['value'] ?? nested?.['id'] ?? nested?.['_id'] ?? nested?.['code'] ?? nested?.['key'] ?? nested?.['k'] ?? nested?.['name'];
        return primitive !== undefined ? primitive : value;
    }

    private resolveTableCellRenderer(field: string): ((value: unknown) => string) | null {
        if (this.tableFieldRendererCache.has(field)) return this.tableFieldRendererCache.get(field) ?? null;
        const renderer = this.findTableCellRenderer(field);
        this.tableFieldRendererCache.set(field, renderer);
        return renderer;
    }

    private findTableCellRenderer(field: string): ((value: unknown) => string) | null {
        const candidates = this.expandFieldCandidates(field);
        for (const candidate of candidates) {
            const renderer = this.tableCellRenderers.get(candidate);
            if (renderer) return renderer;
        }
        return null;
    }

    private expandFieldCandidates(field: string): string[] {
        const out = new Set<string>();
        String(field ?? '').split(',').map(e => e.trim()).filter(Boolean).forEach(e => {
            out.add(e);
            const normalized = e.replace(/\[(\d+)\]/g, '.$1');
            const parts = normalized.split('.').map(i => i.trim()).filter(Boolean);
            if (!parts.length) return;
            out.add(parts.join('.'));
            out.add(parts[parts.length - 1]);
        });
        return [...out];
    }

    private buildTableRenderSubmission(rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
        if (!rows.length) return null;
        const sample: Record<string, unknown> = {};
        const maxRows = Math.min(rows.length, 64);
        for (let index = 0; index < maxRows; index += 1) {
            const row = rows[index];
            Object.entries(row).forEach(([field, value]) => {
                if (field.startsWith('__')) return;
                if (value === undefined || value === null) return;
                if (Object.prototype.hasOwnProperty.call(sample, field)) return;
                sample[field] = value;
            });
        }
        return Object.keys(sample).length ? sample : null;
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

    private appendCustomClass(source: unknown, className: string): string {
        const classes = String(source ?? '').split(/\s+/).map(e => e.trim()).filter(Boolean);
        if (!classes.includes(className)) classes.push(className);
        return classes.join(' ').trim();
    }

    private findSelectComponents(src: unknown): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        const visit = (n: unknown): void => {
            if (Array.isArray(n)) n.forEach(visit);
            else if (this.isRecord(n)) {
                if (n['type'] === 'select') out.push(n);
                Object.values(n).forEach(visit);
            }
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
        const hasInternalSource = Boolean(payload.key && payload.curr_model);
        const hasRemoteSource = Boolean(url);
        if (!hasInternalSource && !hasRemoteSource) return null;
        return payload;
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

    private normalizeRemoteSelectResponse(payload: unknown): SelectValueOption[] {
        let target: unknown = payload;
        for (let i = 0; i < 4; i++) {
            if (this.isRecord(target) && this.isRecord(target['content'])) { target = target['content']['data'] ?? target['content']; continue; }
            if (this.isRecord(target)) {
                const next = target['data'] ?? target['items'] ?? target['records'] ?? target['values'];
                if (next !== undefined) { target = next; continue; }
            }
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
        const merged: SelectValueOption[] = [];
        const seen = new Set<string>();
        const pushUnique = (entry: SelectValueOption) => {
            const id = `${typeof entry.value}:${this.toDisplayValue(entry.value)}`;
            if (seen.has(id)) return;
            seen.add(id);
            merged.push(entry);
        };
        primary.forEach(pushUnique);
        secondary.forEach(pushUnique);
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
            if (key === 'url' || key === 'method' || key === 'headers' || key === 'selectValues') return;
            cleanedData[key] = value;
        });
        c['data'] = { ...cleanedData, values: v };
        c['dataSrc'] = 'values';
        delete c['url']; delete c['method']; delete c['lazyLoad']; delete c['selectValues'];
        if (!c['valueProperty']) c['valueProperty'] = 'value';
    }

    private readComponentProperties(c: Record<string, unknown>): Record<string, unknown> {
        if (this.isRecord(c['properties'])) return c['properties'];
        if (this.isRecord(c['property'])) return c['property'];
        return {};
    }

    private readPropertyValue(p: Record<string, unknown>, keys: string[]): string {
        for (const k of keys) { const value = p[k]; if (typeof value === 'string' && value.trim()) return value.trim(); }
        return '';
    }

    private toSelectValueOption(e: unknown): SelectValueOption | null {
        if (e == null) return null;
        if (!this.isRecord(e)) return { label: this.toDisplayValue(e), value: e };
        const nested = this.isRecord(e['data']) ? e['data'] : null;
        const v = e['value'] ?? e['id'] ?? e['_id'] ?? e['code'] ?? e['key'] ?? e['k'] ?? e['name'] ?? e['rec_name']
            ?? nested?.['value'] ?? nested?.['id'] ?? nested?.['_id'] ?? nested?.['code'] ?? nested?.['key'] ?? nested?.['k'] ?? nested?.['name'];
        const l = e['label'] ?? e['title'] ?? e['name'] ?? e['description'] ?? e['v']
            ?? nested?.['label'] ?? nested?.['title'] ?? nested?.['name'] ?? nested?.['description'] ?? nested?.['v'] ?? v;
        return v !== undefined ? { label: this.toDisplayValue(l), value: v } : null;
    }

    private extractRecord(payload: unknown): Record<string, unknown> | null {
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

    private collectResponseNodes(payload: unknown, maxDepth = 8): Record<string, unknown>[] {
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

    private isEnvelopeNode(node: Record<string, unknown>): boolean {
        if (!this.asRecord(node['content'])) return false;
        return Object.prototype.hasOwnProperty.call(node, 'fail') || Object.prototype.hasOwnProperty.call(node, 'message') || !Object.prototype.hasOwnProperty.call(node, 'mode');
    }

    private computeRecordName(rec: Record<string, unknown>, idx: number): string {
        return String(rec['rec_name'] || rec['name'] || rec['key'] || rec['_id'] || rec['id'] || `record_${idx}`);
    }

    private readFirstBooleanFromCandidates(candidates: Array<Record<string, unknown>>, keys: string[]): boolean | null {
        for (const candidate of candidates) {
            for (const key of keys) {
                const value = this.toOptionalBooleanFlag(candidate[key]);
                if (value !== null) return value;
            }
        }
        return null;
    }

    private readFirstStringFromCandidates(candidates: Array<Record<string, unknown>>, keys: string[]): string {
        for (const candidate of candidates) {
            for (const key of keys) {
                const value = this.readFirstString(candidate[key]);
                if (value) return value;
            }
        }
        return '';
    }

    private shouldAppendRowRecNameToActionPath(path: string, recName: string, encodedRecName: string): boolean {
        if (!recName || !path.startsWith('/action/')) return false;
        const [basePath] = path.split('?', 2);
        const decodedPath = decodeURIComponent(basePath);
        if (decodedPath.endsWith(`/${recName}`) || basePath.endsWith(`/${encodedRecName}`)) return false;
        const segments = basePath.split('/').map(e => e.trim()).filter(Boolean);
        if (segments.length < 2) return false;
        const actionName = String(segments[1] ?? '').toLowerCase();
        if (actionName === 'layout' || actionName === 'menu' || actionName === 'dashboard') return false;
        if (actionName === 'next_action') return segments.length === 3;
        return segments.length === 2;
    }

    private appendRecNameToActionPath(path: string, encodedRecName: string, normalizeActionUrl: (u: string) => string): string {
        const [basePath, queryString] = path.split('?', 2);
        const withRec = normalizeActionUrl(`${basePath}/${encodedRecName}`);
        return queryString ? `${withRec}?${queryString}` : withRec;
    }

    private normalizeQuerySeed(value: unknown): Record<string, unknown> | null {
        if (this.isRecord(value)) return Object.keys(value).length ? this.cloneSchema(value) : null;
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            return this.isRecord(parsed) && Object.keys(parsed).length ? this.cloneSchema(parsed) : null;
        } catch { return null; }
    }

    private findWellQuerySeed(schema: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!schema) return null;
        const wells = this.findWellComponents(schema);
        const preferredTypes = new Set(['search_area', 'export_area']);
        for (const well of wells) {
            const kind = this.readWellComponentKind(well);
            if (!preferredTypes.has(kind)) continue;
            const properties = this.readComponentProperties(well);
            const normalized = this.normalizeQuerySeed(properties['query']);
            if (normalized) return normalized;
            const data = this.isRecord(well['data']) ? well['data'] : {};
            const fallback = this.normalizeQuerySeed(data['query']);
            if (fallback) return fallback;
        }
        return null;
    }

    private findWellComponents(src: unknown): Record<string, unknown>[] {
        const wells: Record<string, unknown>[] = [];
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'well') wells.push(node);
            Object.values(node).forEach(visit);
        };
        visit(src);
        return wells;
    }

    private readWellComponentKind(component: Record<string, unknown>): string {
        const properties = this.readComponentProperties(component);
        return this.readFirstString(properties['type'], component['well_type'], component['wellType']).toLowerCase();
    }
}
