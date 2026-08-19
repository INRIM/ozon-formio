import { Injectable } from '@angular/core';
import jsonLogic from 'json-logic-js';
import { OzonApiService } from '../core/ozon-api.service';
import { AppFormioRendererService } from './app-formio-renderer.service';
import {
    SelectOptionMappingConfig,
    selectOptionPrimitiveValue,
    toSelectValueOption as mapSelectValueOption
} from '../core/select-option.util';
import { normalizeFormioDateTimeFormat, UNSAFE_PATH_SEGMENTS } from '../core/utils';
import {
    ListPageChange, ListSortChange, ListRowReorderChange,
    TableColumn, TableRow, SelectValueOption, TableSortDirection,
    QueryBuilderConfig, QueryBuilderFieldConfig, QueryMode, RuleSet, Rule,
    ListExportConfig, ListImportConfig, ListSearchSessionContext
} from '../models/app.types';
import { FastSearchPayload, ListRequestPayload, RemoteSelectRequestPayload } from '../models/ozon.types';

interface FastSearchStorageEntry {
    savedAt: number;
    data: Record<string, unknown>;
}

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
    private filterReloadTimer: ReturnType<typeof setTimeout> | null = null;
    private lastColumnsRaw = '';
    isLoadingRecords = false;
    private lastQuerySignature = '';
    private pendingReloadRequested = false;
    private pendingReloadPreservePaginatorState = false;
    listQuerySeed: Record<string, unknown> | null = null;
    menuBaseQuery: Record<string, unknown> | null = null;
    menuBaseSort = '';
    private tableRenderSchema: Record<string, unknown> | null = null;
    private tableCellRenderers = new Map<string, (value: unknown) => string>();
    private tableFieldRendererCache = new Map<string, ((value: unknown) => string) | null>();

    private _rawFormSchema: Record<string, unknown> | null = null;
    get rawFormSchema(): Record<string, unknown> | null {
        return this._rawFormSchema;
    }
    set rawFormSchema(val: Record<string, unknown> | null) {
        this._rawFormSchema = val;
        if (this.tableColumns && this.tableColumns.length) {
            this.syncQueryBuilderFields(this.tableColumns);
        }
    }
    rawFormSchemaModel = '';
    listExportConfig: ListExportConfig = {
        visible: false,
        model: '',
        searchModel: '',
        parent: '',
        hideAll: true,
        xlsFilteredLabel: 'XLS',
        csvFilteredLabel: 'CSV',
        jsonFilteredLabel: 'JSON'
    };
    listImportConfig: ListImportConfig = {
        visible: false,
        model: '',
        title: 'Import Data'
    };
    private listActionName = '';
    private listSearchModel = '';
    private fastSearchFormModel = '';
    private fastSearchConfigRevision = 0;
    private fastActionsFormModel = '';
    fastActionsDataModel = '';
    private fastActionsConfigRevision = 0;
    private tableCellRendererRevision = 0;
    fastSearchLoading = false;
    fastActionsLoading = false;
    tableRenderLoading = false;

    fastSearchEnabled = false;
    fastSearchActive = false;
    fastSearchSchema: Record<string, unknown> | null = null;
    fastSearchSubmission: { data: Record<string, unknown> } = { data: {} };
    fastSearchActionName = '';
    fastActionsEnabled = false;
    fastActionsSchema: Record<string, unknown> | null = null;
    fastActionsActionName = '';
    private fastSearchQueryFields: Record<string, unknown>[] = [];
    private isRefreshingFastSearchDependentSelects = false;
    private readonly fastSearchStoragePrefix = 'ozon.fs.';
    private readonly fastSearchStorageTtlMs = 8 * 60 * 60 * 1000;

    sessionLocale = 'it';
    sessionTimezone = '';

    private readonly defaultPageSizeOptions = [10, 20, 30, 50];

    private remoteSelectCache = new Map<string, SelectValueOption[]>();
    private remoteSelectInflight = new Map<string, Promise<SelectValueOption[]>>();

    constructor(
        private readonly api: OzonApiService,
        private readonly renderer: AppFormioRendererService
    ) {}

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
    get sortDirection(): TableSortDirection { return this.primeSortOrder === -1 ? 'desc' : 'asc'; }
    get listSearchSessionContext(): ListSearchSessionContext | null {
        const searchModel = this.readFirstString(this.listSearchModel, this.listExportConfig.searchModel, this.selectedModel);
        if (!searchModel) return null;
        const baseQuery = this.listQuerySeed ? this.cloneSchema(this.listQuerySeed) : {};
        const currentQuery = this.parseQueryInput((_message, _error) => undefined) ?? baseQuery;
        const submissionData = this.fastSearchSubmission?.data && this.isRecord(this.fastSearchSubmission.data)
            ? this.cloneSchema(this.fastSearchSubmission.data)
            : {};
        return {
            searchModel,
            dataModel: this.selectedModel,
            actionName: this.listActionName,
            baseQuery,
            currentQuery: this.isRecord(currentQuery) ? this.cloneSchema(currentQuery) : baseQuery,
            order: this.order,
            totalCount: Math.max(0, Number(this.tableTotalRecords) || 0),
            fastSearchActive: this.fastSearchActive,
            fastSearchFormModel: this.fastSearchFormModel,
            fastSearchDataModel: this.selectedModel,
            fastSearchQueryFields: this.fastSearchActive ? this.buildFastSearchQueryFields() : [],
            fastSearchFormData: submissionData
        };
    }

    trackRowBy(_index: number, row: TableRow): number { return row.__rowid; }
    trackColumnBy(_index: number, column: TableColumn): string { return column.field; }

    displayCell(row: TableRow, field: string): string {
        const value = this.resolveFieldValue(row, field);
        const renderer = this.resolveTableCellRenderer(field);
        if (renderer) return renderer(value);
        return this.toDisplayValue(value);
    }

    setQueryMode(mode: QueryMode): void { this.queryMode = mode; }

    setQueryBuilderRules(rules: RuleSet): void {
        this.queryMode = 'builder';
        this.queryBuilderRules = this.cloneRuleSet(rules);
        this.onQueryBuilderChanged();
    }

    onQueryBuilderChanged(): void {
        if (this.queryMode !== 'builder') return;
        const query = this.queryBuilderToBackend(this.queryBuilderRules);
        this.queryText = JSON.stringify(query, null, 2);
    }

    resetQueryBuilderRules(): void {
        this.queryBuilderRules = { condition: 'and', rules: [] };
        this.onQueryBuilderChanged();
    }

    applyQueryBuilderFilters(): void {
        this.queryMode = 'builder';
        this.onQueryBuilderChanged();
        this.skip = 0;
        this.currentPageIndex = 0;
    }

    resetQueryBuilderFilters(): void {
        this.queryMode = 'builder';
        this.skip = 0;
        this.currentPageIndex = 0;
        this.resetQueryBuilderRules();
    }

    onFilterChanged(refreshFn: () => void): void {
        this.skip = 0;
        this.currentPageIndex = 0;
        if (this.filterReloadTimer) clearTimeout(this.filterReloadTimer);
        this.filterReloadTimer = setTimeout(() => {
            this.filterReloadTimer = null;
            refreshFn();
        }, 250);
    }

    computeCurrentPageIndex(): number { return Math.floor((this.skip || 0) / this.getPageSize()); }
    getPageSize(): number { return Number(this.limit) || 20; }

    onTableLazyLoad(event: unknown, loadRecordsFn: (preserve: boolean) => Promise<void>): void {
        const parsed = this.parseLazyLoadEvent(event);
        if (!parsed) return;
        this.applyViewportQueryChange(parsed, loadRecordsFn);
    }

    onListPageChange(change: ListPageChange, loadRecordsFn: (preserve: boolean) => Promise<void>): void {
        const pageIndex = Number(change.pageIndex);
        const pageSize = Number(change.pageSize);
        if (!Number.isFinite(pageIndex) || pageIndex < 0 || !Number.isFinite(pageSize) || pageSize <= 0) return;
        this.applyViewportQueryChange({
            skip: pageIndex * pageSize,
            limit: pageSize,
            order: this.order
        }, loadRecordsFn);
    }

    onListSortChange(change: ListSortChange, loadRecordsFn: (preserve: boolean) => Promise<void>): void {
        const field = this.normalizeSortField(change.field);
        if (!field) return;
        const direction: TableSortDirection = change.direction === 'desc' ? 'desc' : 'asc';
        this.applyViewportQueryChange({
            skip: 0,
            limit: this.limit,
            order: this.buildOrderValue(field, direction)
        }, loadRecordsFn);
    }

    onTableRowClick(row: TableRow, event: Event, rebuildMenusFn: () => void): void {
        if (this.isIgnoredRowInteractionTarget(event)) return;
        this.selectSingleRow(row);
        rebuildMenusFn();
    }

    async onTableRowOpen(row: TableRow, event: Event, rebuildMenusFn: () => void, openRecordFn: () => Promise<void>): Promise<void> {
        if (this.isIgnoredRowInteractionTarget(event)) return;
        this.selectSingleRow(row);
        rebuildMenusFn();
        await openRecordFn();
    }

    async onTableRowDblClick(row: TableRow, event: Event, rebuildMenusFn: () => void, openRecordFn: () => Promise<void>): Promise<void> {
        await this.onTableRowOpen(row, event, rebuildMenusFn, openRecordFn);
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

    onRowReorder(event: unknown, setStatusFn: (m: string, e: boolean) => void): void {
        if (this.filterText.trim()) {
            setStatusFn('Disattiva il filtro prima di riordinare le righe', true);
            return;
        }
        const indices = this.parseRowReorderIndices(event);
        if (!indices) return;
        const { previousIndex: from, currentIndex: to } = indices;
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
        this.clearFilterReloadTimer();
        this.pendingReloadRequested = false;
        this.pendingReloadPreservePaginatorState = false;
        this.fastSearchLoading = false;
        this.tableRenderLoading = false;
        this.skip = 0;
        this.currentPageIndex = 0;
        this.tableTotalRecords = 0;
        this.listQuerySeed = null;
        this.menuBaseQuery = null;
        this.menuBaseSort = '';
        this.clearTableCellRenderers();
        this.lastQuerySignature = '';
        this.remoteSelectCache.clear();
        this.remoteSelectInflight.clear();
        this.resetQueryBuilderRules();
        this.resetTableRowActionsConfig();
        this.resetListTransferConfig();
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
        let userQuery: Record<string, unknown> | null = null;
        if (this.queryMode === 'builder') {
            try {
                const query = this.queryBuilderToBackend(this.queryBuilderRules);
                this.queryText = JSON.stringify(query, null, 2);
                userQuery = query;
            } catch (e) {
                setStatusFn(this.errorMessage(e), true);
                return null;
            }
        } else {
            const raw = (this.queryText || '').trim();
            if (raw) {
                try {
                    const p = JSON.parse(raw);
                    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Query JSON deve essere un oggetto');
                    userQuery = p as Record<string, unknown>;
                } catch (e) {
                    setStatusFn(this.errorMessage(e), true);
                    return null;
                }
            }
        }

        const searchQuery = this.buildSearchQuery(this.filterText);

        const queriesToMerge: Record<string, unknown>[] = [];
        if (this.menuBaseQuery) queriesToMerge.push(this.menuBaseQuery);
        if (this.listQuerySeed) queriesToMerge.push(this.listQuerySeed);
        if (userQuery) queriesToMerge.push(userQuery);
        if (searchQuery) queriesToMerge.push(searchQuery);

        return this.mergeMongoQueries(queriesToMerge);
    }

    buildListPayload(): ListRequestPayload {
        return {
            query: {},
            skip: Number.isFinite(this.skip) && this.skip >= 0 ? this.skip : 0,
            limit: Number.isFinite(this.limit) && this.limit > 0 ? this.limit : 20,
            order: (this.order || 'rec_name asc').trim() || 'rec_name asc'
        };
    }

    buildFastSearchPayload(): FastSearchPayload {
        const queriesToMerge: Record<string, unknown>[] = [];
        if (this.menuBaseQuery) queriesToMerge.push(this.menuBaseQuery);
        if (this.listQuerySeed) queriesToMerge.push(this.listQuerySeed);
        const searchQuery = this.buildSearchQuery(this.filterText);
        if (searchQuery) queriesToMerge.push(searchQuery);

        const mergedQuery = this.mergeMongoQueries(queriesToMerge);

        return {
            query_fields: [...this.fastSearchQueryFields],
            query: Object.keys(mergedQuery).length ? mergedQuery : undefined,
            order: (this.order || 'rec_name asc').trim() || 'rec_name asc',
            skip: Number.isFinite(this.skip) && this.skip >= 0 ? this.skip : 0,
            limit: Number.isFinite(this.limit) && this.limit > 0 ? this.limit : 20
        };
    }

    async applyFastSearchFormChange(event: unknown): Promise<boolean> {
        const eventRecord = this.asRecord(event);
        if (this.isFastSearchSubmissionReplayEvent(eventRecord)) return false;
        const data = this.extractChangeEventSubmissionData(eventRecord);
        if (data) this.mergeFastSearchSubmissionData(data);
        const changedKey = this.extractChangedComponentKey(eventRecord);
        if (changedKey) await this.refreshFastSearchDependentSelectComponents(changedKey);
        this.saveFastSearchStateToStorage();
        return this.shouldAutoSubmitFastSearchChange(changedKey);
    }

    resetFastSearch(): void {
        this.fastSearchActive = false;
        this.fastSearchQueryFields = [];
        this.replaceFastSearchSubmission({});
        this.clearFastSearchStateFromStorage();
    }

    activateFastSearch(): void {
        this.fastSearchQueryFields = this.buildFastSearchQueryFields();
        this.fastSearchActive = true;
        this.skip = 0;
        this.currentPageIndex = 0;
        this.saveFastSearchStateToStorage();
    }

    beginFastSearchWarmup(expected: boolean): number {
        const revision = ++this.fastSearchConfigRevision;
        this.fastSearchLoading = expected;
        this.fastSearchEnabled = false;
        this.fastSearchSchema = null;
        this.fastSearchActive = false;
        this.fastSearchQueryFields = [];
        this.replaceFastSearchSubmission({});
        if (!expected) {
            this.fastSearchActionName = '';
            this.fastSearchFormModel = '';
        }
        return revision;
    }

    async setFastSearchConfig(actionName: string, schema: Record<string, unknown> | null, formModel = '', revision?: number): Promise<boolean> {
        const effectiveRevision = revision ?? ++this.fastSearchConfigRevision;
        const normalizedActionName = String(actionName ?? '').trim();
        const normalizedFormModel = String(formModel ?? '').trim();
        const normalizedSchema = this.normalizeFastSearchSchema(schema);
        const savedData = this.readFastSearchStateFromStorage(normalizedActionName);
        const hydratedSchema = normalizedSchema
            ? await this.hydrateRemoteSelectSchema(normalizedSchema, savedData, normalizedFormModel)
            : null;
        if (effectiveRevision !== this.fastSearchConfigRevision) return false;
        this.fastSearchActionName = normalizedActionName;
        this.fastSearchFormModel = normalizedFormModel;
        this.fastSearchSchema = hydratedSchema;
        this.fastSearchEnabled = Boolean(normalizedActionName && this.fastSearchSchema);
        this.fastSearchLoading = false;
        this.fastSearchActive = false;
        this.fastSearchQueryFields = [];
        this.replaceFastSearchSubmission({});

        // Restore temporary fast-search cache when returning to the list.
        if (savedData && this.fastSearchEnabled) {
            this.mergeFastSearchSubmissionData(savedData);
            this.fastSearchQueryFields = this.buildFastSearchQueryFields();
            this.fastSearchActive = true;
            this.saveFastSearchStateToStorage();
            return true;
        }
        return false;
    }

    beginFastActionsWarmup(expected: boolean): number {
        const revision = ++this.fastActionsConfigRevision;
        this.fastActionsLoading = expected;
        this.fastActionsEnabled = false;
        this.fastActionsSchema = null;
        if (!expected) {
            this.fastActionsActionName = '';
            this.fastActionsFormModel = '';
            this.fastActionsDataModel = '';
        }
        return revision;
    }

    async setFastActionsConfig(actionName: string, schema: Record<string, unknown> | null, formModel = '', revision?: number): Promise<boolean> {
        const effectiveRevision = revision ?? ++this.fastActionsConfigRevision;
        const normalizedActionName = String(actionName ?? '').trim();
        const normalizedFormModel = String(formModel ?? '').trim();
        // `prepareFastActionsSchema` (not a plain clone) is what stamps buttons with
        // `action: 'event'` / `event: OZON_INLINE_ACTION_EVENT` (same as regular inline action
        // buttons) and injects the selection-count enable/disable logic — skipping it left buttons
        // with no click behavior wired at all, so they rendered but did nothing when clicked.
        const hydratedSchema = schema ? this.renderer.prepareFastActionsSchema(schema) : null;
        if (effectiveRevision !== this.fastActionsConfigRevision) return false;
        this.fastActionsActionName = normalizedActionName;
        this.fastActionsFormModel = normalizedFormModel;
        this.fastActionsDataModel = normalizedFormModel;
        this.fastActionsSchema = hydratedSchema;
        this.fastActionsEnabled = Boolean(normalizedActionName && this.fastActionsSchema);
        this.fastActionsLoading = false;
        return false;
    }

    saveFastSearchStateToStorage(actionName = this.fastSearchActionName): void {
        const normalizedActionName = String(actionName ?? '').trim();
        if (!normalizedActionName) return;
        try {
            const key = this.buildFastSearchStorageKey(normalizedActionName);
            const data = this.fastSearchSubmission?.data && this.isRecord(this.fastSearchSubmission.data)
                ? this.cloneSchema(this.fastSearchSubmission.data)
                : {};
            if (!this.hasPersistableFastSearchData(data)) {
                localStorage.removeItem(key);
                return;
            }
            const entry: FastSearchStorageEntry = {
                savedAt: Date.now(),
                data
            };
            localStorage.setItem(key, JSON.stringify(entry));
        } catch { /* ignore storage errors */ }
    }

    clearFastSearchStateFromStorage(actionName = this.fastSearchActionName): void {
        const normalizedActionName = String(actionName ?? '').trim();
        if (!normalizedActionName) return;
        try {
            localStorage.removeItem(this.buildFastSearchStorageKey(normalizedActionName));
        } catch { /* ignore storage errors */ }
    }

    private readFastSearchStateFromStorage(actionName: string): Record<string, unknown> | null {
        const normalizedActionName = String(actionName ?? '').trim();
        if (!normalizedActionName) return null;
        try {
            const key = this.buildFastSearchStorageKey(normalizedActionName);
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const entry = this.normalizeFastSearchStorageEntry(parsed);
            if (!entry) {
                localStorage.removeItem(key);
                return null;
            }
            if ((Date.now() - entry.savedAt) > this.fastSearchStorageTtlMs || !this.hasPersistableFastSearchData(entry.data)) {
                localStorage.removeItem(key);
                return null;
            }
            return this.cloneSchema(entry.data);
        } catch {
            this.clearFastSearchStateFromStorage(normalizedActionName);
            return null;
        }
    }

    private mergeFastSearchSubmissionData(nextData: Record<string, unknown>): void {
        if (!this.fastSearchSubmission || !this.isRecord(this.fastSearchSubmission.data)) {
            this.fastSearchSubmission = { data: { ...nextData } };
            return;
        }
        Object.assign(this.fastSearchSubmission.data, nextData);
    }

    private replaceFastSearchSubmission(nextData: Record<string, unknown>): void {
        this.fastSearchSubmission = { data: { ...nextData } };
    }

    private isFastSearchSubmissionReplayEvent(eventRecord: Record<string, unknown> | null): boolean {
        if (!eventRecord) return false;
        const flags = this.asRecord(eventRecord['flags']);
        return this.toOptionalBooleanFlag(flags?.['fromSubmission']) === true;
    }

    private buildFastSearchQueryFields(): Record<string, unknown>[] {
        const data = this.fastSearchSubmission?.data ?? {};
        const compMap = this.getFastSearchComponentMap();
        const queryFields: Record<string, unknown>[] = [];
        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('__') || key === 'submit') continue;
            if (value === undefined || value === null || value === '') continue;
            if (typeof value === 'string' && !value.trim()) continue;
            if (Array.isArray(value) && !value.length) continue;
            const comp = compMap.get(key);
            const compType = String(comp?.['type'] ?? '').toLowerCase();
            const logicQf = comp ? this.evaluateFastSearchLogicQuery(comp, data) : null;
            const qf = logicQf ?? this.buildFastSearchQueryField(key, value, compType);
            if (qf) queryFields.push(qf);
        }
        return queryFields;
    }

    private buildFastSearchStorageKey(actionName: string): string {
        return `${this.fastSearchStoragePrefix}${actionName}`;
    }

    private normalizeFastSearchStorageEntry(value: unknown): FastSearchStorageEntry | null {
        if (!this.isRecord(value)) return null;
        const hasEnvelope = Object.prototype.hasOwnProperty.call(value, 'savedAt')
            || Object.prototype.hasOwnProperty.call(value, 'data');
        if (!hasEnvelope) {
            return {
                savedAt: Date.now(),
                data: value as Record<string, unknown>
            };
        }
        const savedAt = Number(value['savedAt']);
        const data = this.asRecord(value['data']);
        if (!Number.isFinite(savedAt) || savedAt <= 0 || !data) return null;
        return {
            savedAt: Math.floor(savedAt),
            data
        };
    }

    private hasPersistableFastSearchData(data: Record<string, unknown>): boolean {
        return Object.entries(data).some(([key, value]) => this.isPersistableFastSearchField(key, value));
    }

    private isPersistableFastSearchField(key: string, value: unknown): boolean {
        if (!key || key.startsWith('__') || key === 'submit') return false;
        return this.hasMeaningfulFastSearchValue(value);
    }

    private hasMeaningfulFastSearchValue(value: unknown): boolean {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return Boolean(value.trim());
        if (Array.isArray(value)) return value.some(entry => this.hasMeaningfulFastSearchValue(entry));
        if (this.isRecord(value)) {
            return Object.entries(value).some(([key, entry]) => this.isPersistableFastSearchField(key, entry));
        }
        return true;
    }

    private getFastSearchComponentMap(): Map<string, Record<string, unknown>> {
        const map = new Map<string, Record<string, unknown>>();
        if (!this.fastSearchSchema) return map;
        const comps = Array.isArray(this.fastSearchSchema['components'])
            ? (this.fastSearchSchema['components'] as unknown[])
            : Array.isArray(this.fastSearchSchema) ? (this.fastSearchSchema as unknown[]) : [];
        this.collectFormioComponents(comps, map);
        return map;
    }

    private shouldAutoSubmitFastSearchChange(changedKey: string): boolean {
        if (!changedKey) return false;
        const component = this.getFastSearchComponentMap().get(changedKey);
        const type = String(component?.['type'] ?? '').trim().toLowerCase();
        return type === 'select';
    }

    private async refreshFastSearchDependentSelectComponents(changedKey: string): Promise<void> {
        if (!changedKey || !this.fastSearchSchema || this.isRefreshingFastSearchDependentSelects) return;
        const schema = this.fastSearchSchema;
        const dependents = this.findDependentSelectComponents(schema, changedKey);
        if (!dependents.length) return;
        const formKey = this.resolveSchemaFormKey(schema, this.fastSearchFormModel);
        const submissionData = this.fastSearchSubmission?.data && this.isRecord(this.fastSearchSubmission.data)
            ? this.fastSearchSubmission.data
            : null;
        let schemaChanged = false;
        let submissionChanged = false;
        this.isRefreshingFastSearchDependentSelects = true;
        try {
            for (const comp of dependents) {
                const payload = this.extractRemoteSelectPayload(comp, formKey);
                if (payload) {
                    try {
                        const remoteOptions = await this.fetchRemoteSelectOptions(comp, payload);
                        this.applyRemoteSelectValues(comp, remoteOptions);
                        schemaChanged = true;
                    } catch (error) {
                        console.error('Dependent fast search remote select fetch failed', error);
                    }
                    this.ensureSelectTemplate(comp);
                    submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    continue;
                }
                if (String(comp['dataSrc'] ?? '').trim() === 'custom' && submissionData) {
                    const data = this.isRecord(comp['data']) ? comp['data'] : {};
                    const customKey = String(data['custom'] ?? '').trim();
                    const customValue = customKey ? (submissionData[customKey] ?? null) : null;
                    if (Array.isArray(customValue)) {
                        const options = customValue.map(entry => this.toSelectValueOption(entry, comp)).filter((entry): entry is SelectValueOption => Boolean(entry));
                        this.applyRemoteSelectValues(comp, options);
                        schemaChanged = true;
                        submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    }
                }
            }
        } finally {
            this.isRefreshingFastSearchDependentSelects = false;
        }
        if (schemaChanged && this.fastSearchSchema) this.fastSearchSchema = this.cloneSchema(this.fastSearchSchema);
        if (submissionChanged && submissionData) this.replaceFastSearchSubmission(submissionData);
    }

    private collectFormioComponents(components: unknown[], map: Map<string, Record<string, unknown>>): void {
        for (const comp of components) {
            if (!this.isRecord(comp)) continue;
            if (comp['key']) map.set(String(comp['key']), comp);
            const nested = Array.isArray(comp['components']) ? (comp['components'] as unknown[]) : [];
            if (nested.length) this.collectFormioComponents(nested, map);
            const columns = Array.isArray(comp['columns']) ? (comp['columns'] as unknown[]) : [];
            columns.forEach(column => {
                const columnComponents = this.isRecord(column) && Array.isArray(column['components'])
                    ? (column['components'] as unknown[])
                    : [];
                if (columnComponents.length) this.collectFormioComponents(columnComponents, map);
            });
            const rows = Array.isArray(comp['rows']) ? (comp['rows'] as unknown[]) : [];
            rows.forEach(row => {
                if (!Array.isArray(row)) return;
                row.forEach(cell => {
                    const cellComponents = this.isRecord(cell) && Array.isArray(cell['components'])
                        ? (cell['components'] as unknown[])
                        : [];
                    if (cellComponents.length) this.collectFormioComponents(cellComponents, map);
                });
            });
        }
    }

    private normalizeFastSearchSchema(schema: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!schema) return null;
        const normalized = this.cloneSchema(schema);
        this.stripSubmitButtonsFromFastSearch(normalized);
        return normalized;
    }

    private stripSubmitButtonsFromFastSearch(schema: Record<string, unknown>): void {
        const components = Array.isArray(schema['components']) ? (schema['components'] as unknown[]) : [];
        schema['components'] = this.sanitizeFastSearchComponents(components);
    }

    private sanitizeFastSearchComponents(components: unknown[]): unknown[] {
        return components.flatMap(component => {
            if (!this.isRecord(component)) return [];
            const type = String(component['type'] ?? '').trim().toLowerCase();
            const action = String(component['action'] ?? '').trim().toLowerCase();
            if (type === 'button' && action === 'submit') return [];

            const normalized = component;
            if (Array.isArray(normalized['components'])) {
                normalized['components'] = this.sanitizeFastSearchComponents(normalized['components'] as unknown[]);
            }
            if (Array.isArray(normalized['columns'])) {
                normalized['columns'] = (normalized['columns'] as unknown[]).map(column => {
                    if (!this.isRecord(column)) return column;
                    if (Array.isArray(column['components'])) {
                        column['components'] = this.sanitizeFastSearchComponents(column['components'] as unknown[]);
                    }
                    return column;
                });
            }
            if (Array.isArray(normalized['rows'])) {
                normalized['rows'] = (normalized['rows'] as unknown[]).map(row => {
                    if (!Array.isArray(row)) return row;
                    return row.map(cell => {
                        if (!this.isRecord(cell)) return cell;
                        if (Array.isArray(cell['components'])) {
                            cell['components'] = this.sanitizeFastSearchComponents(cell['components'] as unknown[]);
                        }
                        return cell;
                    });
                });
            }
            return [normalized];
        });
    }

    private findDependentSelectComponents(schema: Record<string, unknown>, changedKey: string): Record<string, unknown>[] {
        const sourceKey = String(changedKey ?? '').trim();
        if (!sourceKey) return [];
        return this.findSelectComponents(schema)
            .filter(component => this.isRecord(component))
            .filter(component => {
                const componentKey = String(component['key'] ?? '').trim();
                if (!componentKey || componentKey === sourceKey) return false;
                return this.readSelectOnChangeFields(component).includes(sourceKey);
            });
    }

    private readSelectOnChangeFields(component: Record<string, unknown>): string[] {
        const properties = this.readComponentProperties(component);
        const data = this.isRecord(component['data']) ? component['data'] : {};
        const raw = properties['onChangeFields'] ?? properties['on_change_fields'] ?? data['onChangeFields'] ?? data['on_change_fields'] ?? component['onChangeFields'] ?? component['on_change_fields'];
        const entries = this.normalizeArrayValue(raw).map(entry => String(entry ?? '').trim()).filter(Boolean);
        return Array.from(new Set(entries));
    }

    private pruneSelectSubmissionValue(component: Record<string, unknown>, submissionData: Record<string, unknown> | null): boolean {
        if (!submissionData) return false;
        const key = String(component['key'] ?? '').trim();
        if (!key || !Object.prototype.hasOwnProperty.call(submissionData, key)) return false;
        const options = this.extractSchemaOptions(component);
        if (!options.length) return false;
        const allowedValues = new Set(options.map(option => this.optionLookupKey(option.value)).filter(Boolean));
        const current = submissionData[key];
        if (Array.isArray(current)) {
            const filtered = current.filter(entry => allowedValues.has(this.optionLookupKey(entry, component)));
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
        const segments = normalizedPath.split('.').map(entry => entry.trim()).filter(Boolean).filter(entry => !/^\d+$/.test(entry));
        if (!segments.length) return '';
        return segments[segments.length - 1];
    }

    private buildFastSearchQueryField(key: string, value: unknown, compType: string): Record<string, unknown> | null {
        if (compType === 'select' || compType === 'radio') {
            if (Array.isArray(value)) return value.length ? { [key]: { $in: value } } : null;
            return { [key]: value };
        }
        if (compType === 'checkbox') return { [key]: Boolean(value) };
        if (compType === 'number' || compType === 'currency') {
            const n = Number(value);
            return Number.isFinite(n) ? { [key]: n } : null;
        }
        if (typeof value === 'string') {
            const t = value.trim();
            return t ? { [key]: { $regex: t, $options: 'i' } } : null;
        }
        if (typeof value === 'boolean') return { [key]: value };
        if (typeof value === 'number') return Number.isFinite(value) ? { [key]: value } : null;
        if (this.isRecord(value)) return Object.keys(value).length ? { [key]: value } : null;
        return null;
    }

    prepareLoadRecords(preservePaginatorState: boolean, querySignature: string, opt: { preserveColumns?: boolean } = {}): void {
        if (!preservePaginatorState && this.lastQuerySignature && this.lastQuerySignature !== querySignature) {
            this.skip = 0;
            this.currentPageIndex = 0;
        }
        this.isLoadingRecords = true;
        this.resetSelectionAndTable({
            preservePaginationState: preservePaginatorState,
            preserveFilterText: preservePaginatorState,
            preserveColumns: opt.preserveColumns
        });
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

    appendRecordRow(item: unknown): void {
        if (!this.isRecord(item)) return;
        this.rowCounter += 1;
        const recName = this.computeRecordName(item as Record<string, unknown>, this.rowCounter);
        const row: TableRow = {
            ...(item as Record<string, unknown>),
            rec_name: this.readFirstString((item as Record<string, unknown>)['rec_name'], recName) || recName,
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

    resetListTransferConfig(): void {
        this.listActionName = '';
        this.listSearchModel = '';
        this.listExportConfig = {
            visible: false,
            model: '',
            searchModel: '',
            parent: '',
            hideAll: true,
            xlsFilteredLabel: 'XLS',
            csvFilteredLabel: 'CSV',
            jsonFilteredLabel: 'JSON'
        };
        this.listImportConfig = {
            visible: false,
            model: '',
            title: 'Import Data'
        };
    }

    syncTableRowActionsConfig(fields: Record<string, unknown>): void {
        const candidates: Array<Record<string, unknown>> = [
            fields,
            this.isRecord(fields['table']) ? fields['table'] : {},
            this.isRecord(fields['table_action']) ? fields['table_action'] : {},
            this.isRecord(fields['table_actions']) ? fields['table_actions'] : {}
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
        const revision = ++this.tableCellRendererRevision;
        this.tableRenderLoading = Boolean(this.resolveTableCellRendererSchema() && rows.length);
        await this.configureTableCellRenderers(this.resolveTableCellRendererSchema(), rows, revision);
    }

    prepareTableCellRenderers(rows: Array<Record<string, unknown>> = []): number {
        const revision = ++this.tableCellRendererRevision;
        const schema = this.resolveTableCellRendererSchema();
        this.tableRenderLoading = Boolean(schema && rows.length);
        if (!schema) {
            this.applyTableCellRendererSchema(null, revision, false);
            return revision;
        }
        this.applyTableCellRendererSchema(this.cloneSchema(schema), revision, false);
        this.tableRenderLoading = Boolean(rows.length);
        return revision;
    }

    async warmTableCellRenderers(rows: Array<Record<string, unknown>> = [], revision = this.tableCellRendererRevision): Promise<void> {
        const schema = this.resolveTableCellRendererSchema();
        if (!schema) {
            this.applyTableCellRendererSchema(null, revision, true);
            return;
        }
        const sampleSubmission = this.buildTableRenderSubmission(rows);
        let renderSchema = this.cloneSchema(schema);
        if (sampleSubmission) {
            try {
                renderSchema = await this.hydrateRemoteSelectSchema(renderSchema, sampleSubmission);
            } catch {
                // Fallback: keep raw schema if remote select hydration fails.
            }
        }
        this.applyTableCellRendererSchema(renderSchema, revision, true);
    }

    async configureTableCellRenderers(
        schema: Record<string, unknown> | null,
        rows: Array<Record<string, unknown>> = [],
        revision = this.tableCellRendererRevision
    ): Promise<void> {
        if (!schema) {
            this.applyTableCellRendererSchema(null, revision, false);
            return;
        }
        let renderSchema = this.cloneSchema(schema);
        const sampleSubmission = this.buildTableRenderSubmission(rows);
        if (sampleSubmission) {
            try {
                renderSchema = await this.hydrateRemoteSelectSchema(renderSchema, sampleSubmission);
            } catch {
                // Fallback: keep raw schema if remote select hydration fails.
            }
        }
        this.applyTableCellRendererSchema(renderSchema, revision, false);
    }

    clearTableCellRenderers(): void {
        this.tableRenderSchema = null;
        this.tableCellRenderers.clear();
        this.tableFieldRendererCache.clear();
    }

    resetSelectionAndTable(opt: { preservePaginationState?: boolean; preserveFilterText?: boolean; preserveColumns?: boolean } = {}): void {
        const preserveColumns = Boolean(opt.preserveColumns && this.hasStableTableColumns());
        const preservedColumns = preserveColumns ? [...this.tableColumns] : null;
        const preservedServerColumns = preserveColumns && this.serverColumns?.length ? [...this.serverColumns] : null;
        this.selectedRecordName = '';
        this.selectedRows = [];
        this.streamCount = 0;
        this.rowCounter = 0;
        this.tableColumnsInitialized = Boolean(preservedColumns?.length);
        this.serverColumns = preservedServerColumns;
        this.tableColumns = preservedColumns ?? [{ field: '__rec_name', title: 'Record' }];
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

    private hasStableTableColumns(): boolean {
        if (this.serverColumns?.length) return true;
        return this.tableColumns.some(column => String(column.field ?? '').trim() !== '__rec_name');
    }

    private resolveTableCellRendererSchema(): Record<string, unknown> | null {
        const canReuseCachedSchema =
            Boolean(this.rawFormSchema)
            && (!this.selectedModel || !this.rawFormSchemaModel || this.rawFormSchemaModel === this.selectedModel);
        return canReuseCachedSchema ? this.rawFormSchema : null;
    }

    private applyTableCellRendererSchema(
        schema: Record<string, unknown> | null,
        revision: number,
        refreshRows: boolean
    ): void {
        if (revision !== this.tableCellRendererRevision) return;
        this.tableRenderLoading = false;
        if (!schema) {
            this.clearTableCellRenderers();
            if (refreshRows) this.refreshTableRows();
            return;
        }
        this.tableRenderSchema = schema;
        this.rebuildTableCellRenderers(schema);
        if (refreshRows) this.refreshTableRows();
    }

    refreshTableRows(): void {
        this.tableRows = [...this.allRows];
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
        fields: Record<string, unknown>,
        listSchema: Record<string, unknown> | null
    ): void {
        const tableField = this.isRecord(fields['table']) ? fields['table'] : {};
        const directCandidates: unknown[] = [fields['query'], tableField['query']];
        for (const candidate of directCandidates) {
            const normalized = this.normalizeQuerySeed(candidate);
            if (normalized) { this.listQuerySeed = normalized; return; }
        }
        this.listQuerySeed = this.findWellQuerySeed(listSchema);
    }

    syncListTransferConfig(
        fields: Record<string, unknown>,
        listSchema: Record<string, unknown> | null,
        actionName = ''
    ): void {
        const responseModel = this.readFirstString(fields['model'], this.selectedModel);
        const relatedName = this.readFirstString(
            fields['related_name'],
            fields['parent']
        );
        const transferComponents = this.findTransferComponents(listSchema);
        const searchArea = transferComponents.find(component => this.readTransferComponentKind(component) === 'search_area') ?? null;
        const exportArea = transferComponents.find(component => this.readTransferComponentKind(component) === 'export_area') ?? null;
        const importArea = transferComponents.find(component => this.readTransferComponentKind(component) === 'import_component') ?? null;

        const searchProps = searchArea ? this.readComponentProperties(searchArea) : {};
        const exportProps = exportArea ? this.readComponentProperties(exportArea) : {};
        const importProps = importArea ? this.readComponentProperties(importArea) : {};

        const searchModel = this.readFirstString(
            searchProps['model'],
            exportProps['search_model'],
            responseModel,
            this.selectedModel
        );
        const exportModel = this.readFirstString(exportProps['model'], responseModel, this.selectedModel);
        const importModel = this.readFirstString(importProps['model'], searchProps['model'], responseModel, this.selectedModel);
        const hideAll = this.toOptionalBooleanFlag(exportProps['hide_all']) === true;
        const allowImplicitImport = this.shouldShowImplicitListImport(fields);

        this.listActionName = this.readFirstString(actionName);
        this.listSearchModel = searchModel || importModel || responseModel;
        this.listExportConfig = {
            visible: Boolean(exportArea || exportModel),
            model: exportModel,
            searchModel: searchModel || importModel || exportModel,
            parent: relatedName,
            hideAll,
            xlsFilteredLabel: this.readFirstString(exportProps['xls_f'], 'XLS'),
            csvFilteredLabel: this.readFirstString(exportProps['csv_f'], 'CSV'),
            jsonFilteredLabel: this.readFirstString(exportProps['json_f'], 'JSON')
        };

        this.listImportConfig = {
            visible: Boolean((importArea && importModel) || (!importArea && importModel && allowImplicitImport)),
            model: importModel,
            title: this.readFirstString(importProps['title'], 'Import Data')
        };
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

    async hydrateRemoteSelectSchema(
        schema: Record<string, unknown>,
        sub: Record<string, unknown> | null,
        formModel = ''
    ): Promise<Record<string, unknown>> {
        const hydrated = this.cloneSchema(schema);
        const formKey = this.resolveSchemaFormKey(hydrated, formModel);
        this.normalizeFormTableComponents(hydrated);
        this.normalizeFormWysiwygComponents(hydrated, sub);

        for (const comp of this.findSelectComponents(hydrated)) {
            const resourcePayload = this.extractResourceSelectPayload(comp);
            if (resourcePayload) {
                try {
                    const resourceOptions = await this.fetchResourceSelectOptions(comp, resourcePayload);
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(resourceOptions, selectedOptions));
                } catch (error) {
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Resource select fetch failed', error);
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
                    const options = customValue.map(entry => this.toSelectValueOption(entry, comp)).filter((entry): entry is SelectValueOption => Boolean(entry));
                    this.applyRemoteSelectValues(comp, options);
                }
            }
            this.ensureSelectTemplate(comp);
        }
        return hydrated;
    }

    private resolveSchemaFormKey(schema: Record<string, unknown>, formModel = ''): string {
        return String(formModel || schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
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

    cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
    }

    private cloneRuleSet(rules: RuleSet): RuleSet {
        const condition = String(rules?.condition ?? 'and').toLowerCase() === 'or' ? 'or' : 'and';
        const entries = Array.isArray(rules?.rules) ? rules.rules : [];
        return {
            condition,
            rules: entries
                .map(entry => {
                    if (entry && Array.isArray((entry as RuleSet).rules)) return this.cloneRuleSet(entry as RuleSet);
                    const rule = entry as Rule;
                    return {
                        field: rule?.field,
                        operator: rule?.operator,
                        value: rule?.value
                    };
                })
                .filter(entry => Boolean(entry))
        };
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

    clearFilterReloadTimer(): void {
        if (!this.filterReloadTimer) return;
        clearTimeout(this.filterReloadTimer);
        this.filterReloadTimer = null;
    }

    requestReloadAfterCurrentLoad(preservePaginatorState: boolean): void {
        this.pendingReloadRequested = true;
        if (!this.pendingReloadPreservePaginatorState) this.pendingReloadPreservePaginatorState = preservePaginatorState;
        else this.pendingReloadPreservePaginatorState = this.pendingReloadPreservePaginatorState && preservePaginatorState;
    }

    hasPendingReloadRequest(): boolean {
        return this.pendingReloadRequested;
    }

    consumePendingReloadRequest(): boolean {
        const preserve = this.pendingReloadPreservePaginatorState;
        this.pendingReloadRequested = false;
        this.pendingReloadPreservePaginatorState = false;
        return preserve;
    }

    private mergeMongoQueries(queries: Array<Record<string, unknown>>): Record<string, unknown> {
        const clauses: Record<string, unknown>[] = [];
        for (const query of queries) {
            if (!query || !Object.keys(query).length) continue;
            if (this.isAndQuery(query)) {
                clauses.push(...this.extractAndClauses(query));
                continue;
            }
            clauses.push(query);
        }
        if (!clauses.length) return {};
        if (clauses.length === 1) return clauses[0];
        return { $and: clauses };
    }

    private isAndQuery(query: Record<string, unknown>): boolean {
        return Object.keys(query).length === 1 && Array.isArray(query['$and']);
    }

    private extractAndClauses(query: Record<string, unknown>): Record<string, unknown>[] {
        const clauses = query['$and'];
        if (!Array.isArray(clauses)) return [query];
        return clauses.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
    }

    private queryBuilderToBackend(root: RuleSet): Record<string, unknown> {
        const expr = this.convertRuleSetToMongo(root);
        if (!expr) return {};
        if (this.isRecord(expr)) return expr;
        return {};
    }

    private buildSearchQuery(filterText: string): Record<string, unknown> | null {
        const text = String(filterText ?? '').trim();
        if (!text) return null;
        const tokens = this.tokenizeSearchText(text);
        if (!tokens.length) return null;
        const searchableFields = this.getSearchableFields();
        if (!searchableFields.length) return null;
        const clauses = tokens.map(token => this.buildSearchClause(token, searchableFields)).filter((clause): clause is Record<string, unknown> => Boolean(clause && Object.keys(clause).length));
        if (!clauses.length) return null;
        return clauses.length === 1 ? clauses[0] : { $and: clauses };
    }

    private tokenizeSearchText(text: string): string[] {
        const tokens: string[] = [];
        let current = '';
        let quote: string | null = null;
        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            if (quote) {
                if (char === quote) quote = null;
                else current += char;
                continue;
            }
            if (char === '"' || char === '\'') { quote = char; continue; }
            if (/\s/.test(char)) {
                if (current.trim()) tokens.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        if (current.trim()) tokens.push(current.trim());
        return tokens;
    }

    private getSearchableFields(): string[] {
        const fields = new Set<string>(['rec_name']);
        this.tableColumns.forEach(column => {
            const field = String(column.field ?? '').trim();
            if (field && !field.startsWith('__')) fields.add(field);
        });
        Object.entries(this.queryBuilderConfig.fields ?? {}).forEach(([key, config]) => {
            const field = String(key ?? '').trim();
            if (!field) return;
            if (this.isSearchableFieldType(config?.type)) fields.add(field);
        });
        return [...fields];
    }

    private isSearchableFieldType(type: unknown): boolean {
        const normalized = String(type ?? '').trim().toLowerCase();
        if (!normalized) return true;
        return ['string', 'text', 'textarea', 'email', 'phone', 'url', 'password', 'datetime', 'date', 'time'].includes(normalized);
    }

    private buildSearchClause(token: string, searchableFields: string[]): Record<string, unknown> | null {
        const trimmed = String(token ?? '').trim();
        if (!trimmed) return null;
        const negated = trimmed.startsWith('-') && trimmed.length > 1;
        const raw = negated ? trimmed.slice(1) : trimmed;
        const fieldMatch = raw.match(/^([A-Za-z0-9_.-]+)\s*(>=|<=|!=|=|>|<|~|:)\s*(.+)$/);
        const clause = fieldMatch && searchableFields.includes(fieldMatch[1])
            ? this.buildFieldSearchClause(fieldMatch[1], fieldMatch[2], fieldMatch[3])
            : this.buildGlobalSearchClause(raw, searchableFields);
        if (!clause) return null;
        return negated ? { $nor: [clause] } : clause;
    }

    private buildFieldSearchClause(field: string, operator: string, value: string): Record<string, unknown> | null {
        const parsedValue = this.parseSearchValue(value);
        switch (operator) {
            case ':':
            case '~':
                return { [field]: { $regex: this.escapeRegex(this.toDisplayValue(parsedValue)), $options: 'i' } };
            case '=':
                return { [field]: parsedValue };
            case '!=':
                return { [field]: { $ne: parsedValue } };
            case '>':
                return { [field]: { $gt: parsedValue } };
            case '>=':
                return { [field]: { $gte: parsedValue } };
            case '<':
                return { [field]: { $lt: parsedValue } };
            case '<=':
                return { [field]: { $lte: parsedValue } };
            default:
                return { [field]: { $regex: this.escapeRegex(this.toDisplayValue(parsedValue)), $options: 'i' } };
        }
    }

    private buildGlobalSearchClause(value: string, searchableFields: string[]): Record<string, unknown> | null {
        const parsedValue = this.parseSearchValue(value);
        const text = this.toDisplayValue(parsedValue);
        if (!text) return null;
        return {
            $or: searchableFields.map(field => ({ [field]: { $regex: this.escapeRegex(text), $options: 'i' } }))
        };
    }

    private parseSearchValue(value: string): unknown {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) return '';
        const quoted = trimmed.match(/^(['"])(.*)\1$/);
        const raw = quoted ? quoted[2] : trimmed;
        if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        return raw;
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

    private applyViewportQueryChange(
        next: { skip: number; limit: number; order: string },
        loadRecordsFn: (preserve: boolean) => Promise<void>
    ): void {
        const previousSkip = this.skip;
        const previousLimit = this.limit;
        const previousOrder = this.order;

        if (Number.isFinite(next.skip) && next.skip >= 0) this.skip = next.skip;
        if (Number.isFinite(next.limit) && next.limit > 0) this.limit = next.limit;
        this.order = String(next.order || this.order).trim() || this.order;
        this.currentPageIndex = this.computeCurrentPageIndex();
        this.syncPrimeSortFromOrder(this.order);

        const hasQueryChange = this.skip !== previousSkip || this.limit !== previousLimit || this.order !== previousOrder;
        if (!this.selectedModel || !hasQueryChange || this.isLoadingRecords) return;
        void loadRecordsFn(true);
    }

    private parseLazyLoadEvent(event: unknown): { skip: number; limit: number; order: string } | null {
        if (!this.isRecord(event)) return null;
        const first = Number(event['first'] ?? this.skip);
        const rows = Number(event['rows'] ?? this.limit);
        const field = this.normalizeSortField(Array.isArray(event['sortField']) ? event['sortField'][0] : event['sortField']);
        const dir: TableSortDirection = Number(event['sortOrder']) === -1 ? 'desc' : 'asc';
        const order = field ? this.buildOrderValue(field, dir) : this.order;
        return {
            skip: Number.isFinite(first) && first >= 0 ? first : this.skip,
            limit: Number.isFinite(rows) && rows > 0 ? rows : this.limit,
            order
        };
    }

    private parseRowReorderIndices(event: unknown): ListRowReorderChange | null {
        if (!this.isRecord(event)) return null;
        const previousIndex = Number(event['previousIndex'] ?? event['dragIndex']);
        const currentIndex = Number(event['currentIndex'] ?? event['dropIndex']);
        if (!Number.isInteger(previousIndex) || !Number.isInteger(currentIndex)) return null;
        return { previousIndex, currentIndex };
    }

    private buildOrderValue(field: string, direction: TableSortDirection): string {
        return `${this.normalizeSortField(field)} ${direction === 'desc' ? 'desc' : 'asc'}`;
    }

    private normalizeSortField(field: unknown): string {
        const normalized = String(field ?? '').trim();
        if (!normalized) return '';
        return normalized === '__rec_name' ? 'rec_name' : normalized;
    }

    private isIgnoredRowInteractionTarget(event: Event): boolean {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest('button, input, label, select, textarea, a, [data-row-action], [data-row-select], [data-row-handle]'));
    }

    private selectSingleRow(row: TableRow): void {
        this.selectedRecordName = String(row.__rec_name ?? '');
        this.selectedRows = [row];
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
        if (nestedData && !contexts.includes(nestedData)) contexts.push(nestedData);
        return contexts;
    }

    private resolvePath(src: Record<string, unknown>, path: string): unknown {
        const norm = String(path).replace(/\[(\d+)\]/g, '.$1').trim();
        if (!norm) return undefined;
        let curr: unknown = src;
        for (const p of norm.split('.').filter(Boolean)) {
            if (curr === null || typeof curr !== 'object') return undefined;
            if (UNSAFE_PATH_SEGMENTS.has(p)) return undefined;
            // Read-only traversal; prototype-reaching segments are rejected above.
            // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
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

    private evaluateFastSearchLogicQuery(comp: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> | null {
        const logicArray = Array.isArray(comp['logic']) ? (comp['logic'] as unknown[]) : [];
        if (!logicArray.length) return null;
        const context = { data };
        for (const logicItem of logicArray) {
            if (!this.isRecord(logicItem)) continue;
            const trigger = this.asRecord(logicItem['trigger']);
            if (trigger && !this.evaluateFormioLogicTrigger(trigger, context)) continue;
            const actions = Array.isArray(logicItem['actions']) ? (logicItem['actions'] as unknown[]) : [];
            for (const action of actions) {
                if (!this.isRecord(action)) continue;
                const result = this.evaluateFormioQueryAction(action, context);
                if (result !== null) return result;
            }
        }
        return null;
    }

    private evaluateFormioLogicTrigger(trigger: Record<string, unknown>, context: unknown): boolean {
        const type = String(trigger['type'] ?? '').trim().toLowerCase();
        if (type === 'json') {
            const json = trigger['json'];
            if (json == null) return true;
            try { return Boolean(jsonLogic.apply(json, context)); } catch { return false; }
        }
        return false;
    }

    private evaluateFormioQueryAction(action: Record<string, unknown>, context: unknown): Record<string, unknown> | null {
        if (String(action['type'] ?? '').trim().toLowerCase() !== 'value') return null;
        const value = action['value'];
        if (typeof value !== 'string') return null;
        const eqIdx = value.indexOf('=');
        if (eqIdx < 1) return null;
        if (value.slice(0, eqIdx).trim() !== 'query') return null;
        const logicStr = value.slice(eqIdx + 1).trim();
        let logicExpr: unknown;
        try { logicExpr = JSON.parse(logicStr); } catch { return null; }
        let evaluated: unknown;
        try { evaluated = jsonLogic.apply(logicExpr, context); } catch { return null; }
        if (typeof evaluated === 'string') return this.parsePythonStyleQuery(evaluated.trim());
        return this.isRecord(evaluated) && Object.keys(evaluated).length ? this.cloneSchema(evaluated) : null;
    }

    private parsePythonStyleQuery(queryStr: string): Record<string, unknown> | null {
        if (!queryStr.trim()) return null;
        try {
            const jsonStr = queryStr
                .replace(/'/g, '"')
                .replace(/\bTrue\b/g, 'true')
                .replace(/\bFalse\b/g, 'false')
                .replace(/\bNone\b/g, 'null');
            const parsed = JSON.parse(jsonStr);
            return this.isRecord(parsed) && Object.keys(parsed).length ? this.cloneSchema(parsed) : null;
        } catch { return null; }
    }

    private buildTableColumnsFromRow(row: TableRow): TableColumn[] {
        const cols: TableColumn[] = [{ field: '__rec_name', title: 'Record' }];
        Object.keys(row).filter(k => k !== '__rowid' && k !== '__rec_name').forEach(k => cols.push({ field: k, title: k }));
        return cols;
    }

    private syncQueryBuilderFields(columns: TableColumn[]): void {
        const fields: QueryBuilderConfig['fields'] = {};
        const compMap = this.getModelSchemaComponentMap();
        columns.filter(c => c.field !== '__rowid' && c.field !== '__rec_name').forEach(c => {
            const comp = compMap.get(c.field);
            const compLabel = comp && typeof comp['label'] === 'string' ? comp['label'].trim() : '';
            const name = c.title && c.title !== c.field ? c.title : (compLabel || c.title || c.field);
            fields[c.field] = { name, type: this.detectQueryFieldType(c.field) };
        });
        if (!fields['rec_name']) fields['rec_name'] = { name: 'Record', type: 'string' };
        this.queryBuilderConfig = { ...this.queryBuilderConfig, fields };
        this.pruneInvalidRules(this.queryBuilderRules, new Set(Object.keys(fields)));
    }

    private getModelSchemaComponentMap(): Map<string, Record<string, unknown>> {
        const map = new Map<string, Record<string, unknown>>();
        if (!this._rawFormSchema) return map;
        const comps = Array.isArray(this._rawFormSchema['components'])
            ? (this._rawFormSchema['components'] as unknown[])
            : Array.isArray(this._rawFormSchema) ? (this._rawFormSchema as unknown[]) : [];
        this.collectFormioComponents(comps, map);
        return map;
    }

    private mapComponentTypeToFieldType(type: string): string {
        const t = String(type ?? '').trim().toLowerCase();
        switch (t) {
            case 'number':
            case 'currency':
                return 'number';
            case 'checkbox':
                return 'boolean';
            case 'datetime':
                return 'datetime';
            case 'date':
                return 'date';
            case 'time':
                return 'time';
            default:
                return 'string';
        }
    }

    private detectQueryFieldType(field: string): string {
        const compMap = this.getModelSchemaComponentMap();
        const comp = compMap.get(field);
        if (comp && comp['type']) {
            return this.mapComponentTypeToFieldType(String(comp['type']));
        }
        for (const row of this.allRows) {
            const value = this.resolveFieldValue(row, field);
            if (value == null) continue;
            if (typeof value === 'number') return 'number';
            if (typeof value === 'boolean') return 'boolean';
            if (typeof value === 'string') {
                if (!value.trim()) continue;
                return this.detectStringTemporalType(value) || 'string';
            }
            return 'string';
        }
        return 'string';
    }

    private detectStringTemporalType(value: string): 'datetime' | 'date' | '' {
        const v = String(value ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return 'datetime';
        if (/^\d{2}\/\d{2}\/\d{4}[ T]\d{2}:\d{2}/.test(v)) return 'datetime';
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return 'date';
        return '';
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
        const enableDate = this.firstOptionalBooleanFlag(component['enableDate'], widget['enableDate']);
        const enableTime = this.firstOptionalBooleanFlag(component['enableTime'], widget['enableTime']);
        const noCalendar = this.firstOptionalBooleanFlag(widget['noCalendar']);
        const showDate = type === 'time'
            ? false
            : type === 'day'
                ? true
                : noCalendar === true
                    ? false
                    : enableDate ?? (format ? showDateFromFormat : true);
        const showTime = type === 'day'
            ? false
            : type === 'time'
                ? true
                : enableTime ?? (format ? showTimeFromFormat : true);
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
        const format = this.readFirstString(component['format'], widget['format'], data['format'], component['displayFormat']);
        const enableDate = this.firstOptionalBooleanFlag(component['enableDate'], widget['enableDate']) !== false
            && this.firstOptionalBooleanFlag(widget['noCalendar']) !== true;
        return normalizeFormioDateTimeFormat(format, enableDate);
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
            if (['1', 'true', 'yes', 'on', 'si', 'sì'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
            return null;
        }
        return null;
    }

    private firstOptionalBooleanFlag(...values: unknown[]): boolean | null {
        for (const value of values) {
            const flag = this.toOptionalBooleanFlag(value);
            if (flag !== null) return flag;
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
            const parsed = this.toSelectValueOption(entry, component);
            if (parsed) {
                const mappedFromParsed = labelsByValue.get(this.optionLookupKey(parsed.value, component));
                if (mappedFromParsed) return mappedFromParsed;
                if (this.isRecord(entry) && parsed.label) return parsed.label;
            }
            const mapped = labelsByValue.get(this.optionLookupKey(entry, component));
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
            if (Array.isArray(value)) return value.map(e => labelsByValue.get(this.optionLookupKey(e, component)) || this.toDisplayValue(e)).filter(Boolean).join(', ');
            if (this.isRecord(value)) {
                const labels: string[] = [];
                lookup.forEach(e => { if (!e.field) return; if (this.toOptionalBooleanFlag(value[e.field]) === true) labels.push(e.label); });
                if (labels.length) return labels.join(', ');
            }
            const mapped = labelsByValue.get(this.optionLookupKey(value, component));
            if (mapped) return mapped;
            return this.toDisplayValue(value);
        };
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

    private optionFieldKey(value: unknown, component?: Record<string, unknown>): string {
        const primitive = this.optionPrimitiveValue(value, component);
        if (typeof primitive === 'string' || typeof primitive === 'number') return String(primitive);
        return '';
    }

    private optionPrimitiveValue(value: unknown, component?: Record<string, unknown>): unknown {
        return selectOptionPrimitiveValue(value, this.buildSelectOptionMappingConfig(component));
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
            const contexts = this.resolveRowValueContexts(row as TableRow);
            for (const context of contexts) {
                Object.entries(context).forEach(([field, value]) => {
                    if (field.startsWith('__')) return;
                    if (value === undefined || value === null) return;
                    if (Object.prototype.hasOwnProperty.call(sample, field)) return;
                    sample[field] = value;
                });
            }
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

    private isBlankSubmissionValue(value: unknown): boolean {
        if (value == null) return true;
        if (typeof value === 'string') return !value.trim();
        if (Array.isArray(value)) return value.length === 0;
        if (this.isRecord(value)) return Object.keys(value).length === 0;
        return false;
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
        const hasInternalSource = Boolean(payload.key && payload.curr_model);
        const hasRemoteSource = Boolean(url);
        if (!hasInternalSource && !hasRemoteSource) return null;
        return payload;
    }

    private extractResourceSelectPayload(comp: Record<string, unknown>): { model: string; payload: ListRequestPayload } | null {
        const data = this.isRecord(comp['data']) ? comp['data'] : {};
        const props = this.readComponentProperties(comp);
        const src = this.readFirstString(comp['dataSrc'], props['src']);
        if (src !== 'resource') return null;

        const model = this.readFirstString(data['resource'], comp['resource'], props['resource']);
        if (!model) return null;

        return {
            model,
            payload: {
                query: this.normalizeResourceSelectQuery(data['query'], props['query'], data['filter'], props['filter']),
                skip: 0,
                limit: this.readFirstNumber(data['limit'], props['limit']) ?? 1000,
                order: this.readFirstString(data['order'], props['order']) || 'rec_name asc'
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

    private async fetchRemoteSelectOptions(comp: Record<string, unknown>, payload: RemoteSelectRequestPayload): Promise<SelectValueOption[]> {
        const cacheKey = this.stableStringify(payload);
        const cached = this.remoteSelectCache.get(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const request = this.api.getRemoteSelect(payload)
            .then((response: unknown) => this.normalizeRemoteSelectResponse(response, comp))
            .then((options: SelectValueOption[]) => { this.remoteSelectCache.set(cacheKey, options); return options; })
            .finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private async fetchResourceSelectOptions(comp: Record<string, unknown>, payload: { model: string; payload: ListRequestPayload }): Promise<SelectValueOption[]> {
        const cacheKey = `resource:${this.stableStringify(payload)}`;
        const cached = this.remoteSelectCache.get(cacheKey);
        if (cached) return cached;
        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;
        const options: SelectValueOption[] = [];
        const request = this.api.streamList(payload.model, payload.payload, (item: unknown) => {
            const option = this.toSelectValueOption(item, comp);
            if (option) options.push(option);
        }, undefined, { stream: false }).then(() => {
            this.remoteSelectCache.set(cacheKey, options);
            return options;
        }).finally(() => { this.remoteSelectInflight.delete(cacheKey); });
        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private normalizeRemoteSelectResponse(payload: unknown, comp: Record<string, unknown>): SelectValueOption[] {
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

    private readComponentProperties(c: Record<string, unknown>): Record<string, unknown> {
        if (this.isRecord(c['properties'])) return c['properties'];
        if (this.isRecord(c['property'])) return c['property'];
        return {};
    }

    private readPropertyValue(p: Record<string, unknown>, keys: string[]): string {
        for (const k of keys) { const value = p[k]; if (typeof value === 'string' && value.trim()) return value.trim(); }
        return '';
    }

    private toSelectValueOption(e: unknown, component?: Record<string, unknown>): SelectValueOption | null {
        const option = mapSelectValueOption(e, this.buildSelectOptionMappingConfig(component));
        if (!option || !component) return option;
        const templatedLabel = this.renderSelectTemplateLabel(component, option);
        if (templatedLabel) option.label = templatedLabel;
        return option;
    }

    private renderSelectTemplateLabel(component: Record<string, unknown>, option: SelectValueOption): string {
        const template = this.readFirstString(component['template']);
        if (!template || !template.includes('{{')) return '';
        const rendered = template.replace(/{{\s*([^}]+?)\s*}}/g, (_match, expression: string) => {
            const value = this.resolveSelectTemplateExpression(String(expression), option);
            return value == null ? '' : this.toDisplayValue(value);
        });
        return rendered.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private resolveSelectTemplateExpression(expression: string, option: SelectValueOption): unknown {
        const normalized = expression
            .replace(/\|\s*[^|]+$/g, '')
            .replace(/\?\./g, '.')
            .trim();
        if (!normalized || normalized === 'item') return option.label || option.value;
        if (!normalized.startsWith('item.')) return undefined;
        const path = normalized.slice('item.'.length);
        return this.resolvePath(option as unknown as Record<string, unknown>, path);
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

    private shouldShowImplicitListImport(fields: Record<string, unknown>): boolean {
        const candidates = [fields];
        const canCreate = this.readFirstBooleanFromCandidates(candidates, ['can_create', 'canCreate']);
        const editable = this.readFirstBooleanFromCandidates(candidates, ['editable', 'write_access', 'writeAccess']);
        if (canCreate === true || editable === true) return true;
        if (canCreate === false && editable === false) return false;
        return true;
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
        const wells = this.findTransferComponents(schema);
        const preferredTypes = new Set(['search_area', 'export_area']);
        for (const well of wells) {
            const kind = this.readTransferComponentKind(well);
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

    private findTransferComponents(src: unknown): Record<string, unknown>[] {
        const components: Record<string, unknown>[] = [];
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (!this.isRecord(node)) return;
            const kind = this.readTransferComponentKind(node);
            const looksLikeComponent =
                Object.prototype.hasOwnProperty.call(node, 'key')
                || Object.prototype.hasOwnProperty.call(node, 'label')
                || Object.prototype.hasOwnProperty.call(node, 'input')
                || Array.isArray(node['components'])
                || Array.isArray(node['columns'])
                || Array.isArray(node['rows']);
            if (looksLikeComponent && (kind === 'search_area' || kind === 'export_area' || kind === 'import_component')) {
                components.push(node);
            }
            Object.values(node).forEach(visit);
        };
        visit(src);
        return components;
    }

    private readTransferComponentKind(component: Record<string, unknown>): string {
        const directType = String(component['type'] ?? '').trim().toLowerCase();
        if (directType === 'search_area' || directType === 'export_area' || directType === 'import_component') {
            return directType;
        }
        const properties = this.readComponentProperties(component);
        return this.readFirstString(properties['type'], component['well_type'], component['wellType']).toLowerCase();
    }
}
