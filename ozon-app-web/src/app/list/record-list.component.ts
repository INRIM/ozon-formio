import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { FormioComponent, FormioModule } from '@formio/angular';
import {
    ContextAction, FormNotification, ListExportConfig, ListImportConfig, ListPageChange, ListRowReorderChange,
    ListSearchSessionContext, ListSortChange, QueryBuilderConfig, Rule, RuleSet,
    TableColumn, TableRow, TableSortDirection
} from '../models/app.types';
import { RecordCardsComponent } from './record-cards.component';
import { RecordTransferToolsComponent } from './record-transfer-tools.component';
import { RecordTableAgGridComponent } from './record-table-ag-grid.component';

@Component({
    selector: 'app-record-list',
    standalone: true,
    imports: [CommonModule, FormsModule, FormioModule, RecordTableAgGridComponent, RecordCardsComponent, RecordTransferToolsComponent],
    templateUrl: './record-list.component.html',
    styleUrl: './record-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordListComponent implements OnChanges {
    @ViewChild('fastActionsFormioRef') fastActionsFormioRef?: FormioComponent;

    @Input() dashboardTitle = '';
    @Input() isAdmin = false;
    @Input() streamCount = 0;
    @Input() totalRecords = 0;
    @Input() limit = 20;
    @Input() skip = 0;
    @Input() sortField = 'rec_name';
    @Input() sortDirection: TableSortDirection = 'asc';
    @Input() tableColumns: readonly TableColumn[] = [];
    @Input() tableRows: readonly TableRow[] = [];
    @Input() selectedRows: readonly TableRow[] = [];
    @Input() selectedRecordName = '';
    @Input() pageSizeOptions: readonly number[] = [];
    @Input() showTableRowCopyAction = false;
    @Input() showTableRowRemoveAction = false;
    @Input() canOpenRecord = false;
    @Input() canOpenNewRecord = false;
    @Input() canDeleteRecord = false;
    @Input() showStaticActionButtons = true;
    @Input() contextActions: readonly ContextAction[] = [];
    @Input() isLoadingRecords = false;
    @Input() fastSearchEnabled = false;
    @Input() fastSearchLoading = false;
    @Input() fastSearchSchema: Record<string, unknown> | null = null;
    @Input() fastSearchSubmission: { data: Record<string, unknown> } = { data: {} };
    @Input() fastActionsEnabled = false;
    @Input() fastActionsLoading = false;
    @Input() fastActionsSchema: Record<string, unknown> | null = null;
    @Input() tableRenderLoading = false;
    @Input() formioRenderOptions: Record<string, unknown> | null = null;
    @Input() exportConfig: ListExportConfig | null = null;
    @Input() importConfig: ListImportConfig | null = null;
    @Input() searchContext: ListSearchSessionContext | null = null;
    @Input() filterConfig: QueryBuilderConfig = { fields: {} };
    @Input() filterRules: RuleSet = { condition: 'and', rules: [] };
    @Input() filterPreview = '{}';
    @Input() statusText = '';
    @Input() statusError = false;
    @Input() serverErrorRetryVisible = false;
    @Input() formNotifications: FormNotification[] = [];
    @Input() displayCell: (row: TableRow, field: string) => string = () => '';

    @Output() fastSearchFormChange = new EventEmitter<unknown>();
    @Output() fastSearchKeydown = new EventEmitter<KeyboardEvent>();
    @Output() fastSearchSearch = new EventEmitter<void>();
    @Output() fastSearchReset = new EventEmitter<void>();
    @Output() fastActionCustomEvent = new EventEmitter<unknown>();
    @Output() openRecord = new EventEmitter<void>();
    @Output() openNewRecord = new EventEmitter<void>();
    @Output() deleteRecord = new EventEmitter<void>();
    @Output() contextActionClick = new EventEmitter<ContextAction>();
    @Output() retryServerError = new EventEmitter<void>();
    @Output() dismissFormNotifications = new EventEmitter<void>();
    @Output() rowClick = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() desktopRowOpen = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() rowDblClick = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() selectionChange = new EventEmitter<TableRow[]>();
    @Output() sortChange = new EventEmitter<ListSortChange>();
    @Output() pageChange = new EventEmitter<ListPageChange>();
    @Output() rowReorder = new EventEmitter<ListRowReorderChange>();
    @Output() copyRow = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() removeRow = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() importBusyChange = new EventEmitter<boolean>();
    @Output() importFinished = new EventEmitter<void>();
    @Output() filterRulesChange = new EventEmitter<RuleSet>();
    @Output() filterApply = new EventEmitter<void>();
    @Output() filterReset = new EventEmitter<void>();

    isMobile = false;
    gearOpen = false;
    filterOpen = false;
    fastSearchCollapsed = false;

    private lastMobileClickTime = 0;
    private lastMobileClickRec = '';
    private fastActionsRenderOptionsCache: Record<string, unknown> | undefined;
    private fastActionsRenderOptionsBase: Record<string, unknown> | null = null;
    private fastActionsRenderOptionsSelectionCount = -1;

    private readonly breakpointObserver = inject(BreakpointObserver);
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        this.isMobile = this.breakpointObserver.isMatched('(max-width: 991px)');
        this.breakpointObserver.observe('(max-width: 991px)')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(result => {
                this.isMobile = result.matches;
                if (!result.matches) this.fastSearchCollapsed = false;
            });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['selectedRows']) void this.refreshFastActionsSelectionGuard();
    }

    /**
     * Drives the fast-actions button enable/disable guard. Two things had to both be true, and
     * verified empirically (a first attempt got each half wrong separately):
     *  1. Form.io's `type: 'json'` logic trigger only ever sees `{data, row, form}` (see
     *     AppFormioRendererService.injectFastActionsSelectionGuard) — it can't read
     *     `options.evalContext`, so the guard reads `data.selection_count`, real submission data,
     *     not a context var.
     *  2. `setSubmission()` updates `form.data` but does *not* itself cascade into
     *     `checkConditions()` for a top-level button component — logic only re-runs on an explicit
     *     `checkConditions()` call. `[submission]` binding alone (relying on @formio/angular's own
     *     ngOnChanges -> setSubmission) updates the data but the guard never re-evaluates.
     * So: set the submission, wait for it, then force the recheck — in that order, explicitly.
     */
    async refreshFastActionsSelectionGuard(): Promise<void> {
        const instance = this.fastActionsFormioRef?.formio as {
            setSubmission?: (submission: { data: Record<string, unknown> }) => Promise<unknown>;
            checkConditions?: () => void;
        } | undefined;
        if (!instance?.setSubmission) return;
        await instance.setSubmission({ data: { selection_count: this.selectedRows.length } });
        instance.checkConditions?.();
    }

    get selectionInfo(): string {
        const count = this.selectedRows.length;
        if (count === 0) return 'Nessun record selezionato';
        if (count === 1) return '1 record selezionato';
        return `${count} record selezionati`;
    }

    get hasTransferTools(): boolean {
        return Boolean(this.exportConfig?.visible || this.importConfig?.visible);
    }

    get filterFieldOptions(): Array<{ field: string; title: string; type: string }> {
        const fields = this.filterConfig?.fields ?? {};
        return Object.entries(fields)
            .map(([field, config]) => ({
                field,
                title: String(config?.name ?? field),
                type: String(config?.type ?? 'string')
            }))
            .filter(option => Boolean(option.field));
    }

    get directFilterRules(): Rule[] {
        const rules = Array.isArray(this.filterRules?.rules) ? this.filterRules.rules : [];
        return rules.filter((rule): rule is Rule => Boolean(rule && !Array.isArray((rule as RuleSet).rules)));
    }

    get filterCondition(): string {
        return String(this.filterRules?.condition ?? 'and').toLowerCase() === 'or' ? 'or' : 'and';
    }

    get hasActiveFilters(): boolean {
        return this.directFilterRules.some(rule => this.isMeaningfulFilterRule(rule));
    }

    get filterCount(): number {
        return this.directFilterRules.filter(rule => this.isMeaningfulFilterRule(rule)).length;
    }

    toggleGear(): void {
        this.gearOpen = !this.gearOpen;
    }

    showMongoQuery = false;
    toggleMongoQuery(): void {
        this.showMongoQuery = !this.showMongoQuery;
    }

    toggleFilters(): void {
        this.filterOpen = !this.filterOpen;
    }

    toggleFastSearch(): void {
        this.fastSearchCollapsed = !this.fastSearchCollapsed;
    }

    addFilterRule(): void {
        const field = this.filterFieldOptions[0]?.field ?? 'rec_name';
        this.emitFilterRules([...this.directFilterRules, {
            field,
            operator: '=',
            value: this.defaultFilterValue(field)
        }]);
    }

    removeFilterRule(index: number): void {
        const nextRules = this.directFilterRules.filter((_rule, ruleIndex) => ruleIndex !== index);
        this.emitFilterRules(nextRules);
    }

    onFilterConditionChange(condition: string): void {
        const normalized = String(condition ?? '').toLowerCase() === 'or' ? 'or' : 'and';
        this.filterRulesChange.emit({ condition: normalized, rules: this.cloneRules(this.directFilterRules) });
    }

    onFilterRuleFieldChange(index: number, field: string): void {
        const nextRules = this.cloneRules(this.directFilterRules);
        const rule = nextRules[index];
        if (!rule) return;
        rule.field = String(field ?? '').trim();
        rule.value = this.defaultFilterValue(rule.field || 'rec_name');
        this.emitFilterRules(nextRules);
    }

    onFilterRuleOperatorChange(index: number, operator: string): void {
        const nextRules = this.cloneRules(this.directFilterRules);
        const rule = nextRules[index];
        if (!rule) return;
        rule.operator = String(operator ?? '=').trim() || '=';
        if (!this.operatorRequiresValue(rule.operator)) delete rule.value;
        else if (rule.value === undefined) rule.value = this.defaultFilterValue(rule.field || 'rec_name');
        this.emitFilterRules(nextRules);
    }

    onFilterRuleValueChange(index: number, value: unknown): void {
        const nextRules = this.cloneRules(this.directFilterRules);
        const rule = nextRules[index];
        if (!rule) return;
        rule.value = this.normalizeFilterValue(rule.field || '', value);
        this.emitFilterRules(nextRules);
    }

    applyFilters(): void {
        this.filterApply.emit();
    }

    resetFilters(): void {
        this.filterReset.emit();
    }

    filterFieldType(field: string): string {
        return String(this.filterConfig?.fields?.[field]?.type ?? 'string').toLowerCase();
    }

    filterValueInputType(field: string): string {
        const type = this.filterFieldType(field);
        if (type === 'number') return 'number';
        if (type === 'datetime') return 'datetime-local';
        if (type === 'date') return 'date';
        if (type === 'time') return 'time';
        return 'text';
    }

    operatorRequiresValue(operator: string | undefined): boolean {
        const normalized = String(operator ?? '').trim().toLowerCase();
        return normalized !== 'is null' && normalized !== 'is not null';
    }

    filterOperatorOptions(field: string): Array<{ value: string; label: string }> {
        const type = this.filterFieldType(field);
        const base = [
            { value: '=', label: '=' },
            { value: '!=', label: '!=' },
            { value: 'is null', label: 'Vuoto' },
            { value: 'is not null', label: 'Non vuoto' }
        ];
        if (type === 'number' || type === 'date' || type === 'datetime' || type === 'time') {
            return [
                ...base,
                { value: '<', label: '<' },
                { value: '<=', label: '<=' },
                { value: '>', label: '>' },
                { value: '>=', label: '>=' },
                { value: 'in', label: 'In' },
                { value: 'not in', label: 'Non in' }
            ];
        }
        if (type === 'boolean') return base;
        return [
            ...base,
            { value: 'contains', label: 'Contiene' },
            { value: 'does not contain', label: 'Non contiene' },
            { value: 'begins with', label: 'Inizia con' },
            { value: 'ends with', label: 'Finisce con' },
            { value: 'in', label: 'In' },
            { value: 'not in', label: 'Non in' }
        ];
    }

    private emitFilterRules(rules: Rule[]): void {
        this.filterRulesChange.emit({
            condition: this.filterCondition,
            rules: this.cloneRules(rules)
        });
    }

    private cloneRules(rules: Rule[]): Rule[] {
        return rules.map(rule => ({
            field: rule.field,
            operator: rule.operator,
            value: rule.value
        }));
    }

    private defaultFilterValue(field: string): unknown {
        const type = this.filterFieldType(field);
        if (type === 'number') return 0;
        if (type === 'boolean') return true;
        return '';
    }

    toDateValue(value: unknown): Date | null {
        if (value instanceof Date) return value;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Date.parse(value);
            if (!Number.isNaN(parsed)) return new Date(parsed);
        }
        return null;
    }

    private normalizeFilterValue(field: string, value: unknown): unknown {
        const type = this.filterFieldType(field);
        if (type === 'number') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (type === 'boolean') {
            if (typeof value === 'boolean') return value;
            return String(value ?? '').toLowerCase() === 'true';
        }
        if (type === 'datetime' || type === 'date') {
            if (value instanceof Date) {
                if (Number.isNaN(value.getTime())) return '';
                if (type === 'date') {
                    const year = value.getFullYear();
                    const month = String(value.getMonth() + 1).padStart(2, '0');
                    const day = String(value.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                } else {
                    const year = value.getFullYear();
                    const month = String(value.getMonth() + 1).padStart(2, '0');
                    const day = String(value.getDate()).padStart(2, '0');
                    const hours = String(value.getHours()).padStart(2, '0');
                    const minutes = String(value.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                }
            }
        }
        return value;
    }

    private isMeaningfulFilterRule(rule: Rule): boolean {
        const operator = String(rule.operator ?? '=').trim().toLowerCase();
        if (!String(rule.field ?? '').trim()) return false;
        if (!this.operatorRequiresValue(operator)) return true;
        const value = rule.value;
        if (Array.isArray(value)) return value.length > 0;
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    onMobileRowClick(payload: { row: TableRow; event: Event }): void {
        const now = Date.now();
        const recName = String((payload.row as Record<string, unknown>)['rec_name'] ?? '');
        if (recName && recName === this.lastMobileClickRec && now - this.lastMobileClickTime < 350) {
            this.lastMobileClickTime = 0;
            this.lastMobileClickRec = '';
            this.rowDblClick.emit(payload);
        } else {
            this.lastMobileClickTime = now;
            this.lastMobileClickRec = recName;
            this.rowClick.emit(payload);
        }
    }

    contextActionBtnClass(action: ContextAction): string {
        switch (action.action_type) {
            case 'save':   return 'btn btn-primary';
            case 'copy':   return 'btn btn-outline-secondary';
            case 'delete': return 'btn btn-danger';
            default:       return 'btn btn-outline-primary';
        }
    }

    get pageStart(): number {
        if (this.totalRecords <= 0 || this.tableRows.length === 0) return 0;
        return this.skip + 1;
    }

    get pageEnd(): number {
        if (this.totalRecords <= 0 || this.tableRows.length === 0) return 0;
        return Math.min(this.skip + this.tableRows.length, this.totalRecords);
    }

    get currentPage(): number {
        return Math.floor((this.skip || 0) / this.pageSize) + 1;
    }

    get totalPages(): number {
        return Math.max(1, Math.ceil(this.totalRecords / this.pageSize));
    }

    get pageSize(): number {
        return Number(this.limit) || 20;
    }

    get sortFieldOptions(): readonly TableColumn[] {
        return this.tableColumns;
    }

    get showFastSearchShell(): boolean {
        return this.fastSearchLoading || (this.fastSearchEnabled && Boolean(this.fastSearchSchema));
    }

    get showFastActionsShell(): boolean {
        return this.fastActionsLoading || (this.fastActionsEnabled && Boolean(this.fastActionsSchema));
    }

    get showFastSearchForm(): boolean {
        return !this.fastSearchLoading && this.fastSearchEnabled && Boolean(this.fastSearchSchema);
    }

    get showFastActionsForm(): boolean {
        return !this.fastActionsLoading && this.fastActionsEnabled && Boolean(this.fastActionsSchema);
    }

    get fastSearchFormSchema(): Record<string, unknown> | undefined {
        return this.fastSearchSchema ?? undefined;
    }

    get fastActionsFormSchema(): Record<string, unknown> | undefined {
        return this.fastActionsSchema ?? undefined;
    }

    get fastActionsRenderOptions(): Record<string, unknown> | undefined {
        const base = this.isRecord(this.formioRenderOptions) ? this.formioRenderOptions : null;
        const selectionCount = this.selectedRows.length;
        if (this.fastActionsRenderOptionsCache && this.fastActionsRenderOptionsBase === base && this.fastActionsRenderOptionsSelectionCount === selectionCount) {
            return this.fastActionsRenderOptionsCache;
        }
        const nextBase = this.isRecord(base) ? { ...base } : {};
        const evalContext = this.isRecord(nextBase['evalContext']) ? { ...(nextBase['evalContext'] as Record<string, unknown>) } : {};
        const app = this.isRecord(evalContext['app']) ? { ...(evalContext['app'] as Record<string, unknown>) } : {};
        app['selection_count'] = selectionCount;
        evalContext['app'] = app;
        nextBase['evalContext'] = evalContext;
        this.fastActionsRenderOptionsBase = base;
        this.fastActionsRenderOptionsSelectionCount = selectionCount;
        this.fastActionsRenderOptionsCache = nextBase;
        return nextBase;
    }

    get showTablePlaceholder(): boolean {
        return this.isLoadingRecords || this.tableRenderLoading;
    }

    get showTableWarning(): boolean {
        return !this.showTablePlaceholder && !this.tableColumns.length;
    }

    get showDesktopTable(): boolean {
        return !this.showTablePlaceholder && !this.isMobile && this.tableColumns.length > 0;
    }

    get showMobileCards(): boolean {
        return !this.showTablePlaceholder && this.isMobile && this.tableColumns.length > 0;
    }

    get fastSearchPlaceholderRows(): number[] {
        return [0, 1, 2];
    }

    get fastActionsPlaceholderRows(): number[] {
        return [0];
    }

    get tablePlaceholderRows(): number[] {
        const count = this.isLoadingRecords ? 4 : (this.tableRows.length ? Math.min(Math.max(this.tableRows.length, 2), 6) : 3);
        return Array.from({ length: count }, (_value, index) => index);
    }

    get tablePlaceholderColumns(): number[] {
        const count = this.tableColumns.length ? Math.min(Math.max(this.tableColumns.length, 3), 5) : 4;
        return Array.from({ length: count }, (_value, index) => index);
    }

    get listPlaceholderMessage(): string {
        if (this.isLoadingRecords) return 'Caricamento lista in corso';
        if (this.tableRenderLoading) return 'Preparazione tabella in corso';
        return 'Caricamento in corso';
    }

    get pageItems(): Array<number | string> {
        return this.buildPageItems(this.currentPage, this.totalPages);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    onPageSizeChanged(pageSize: string | number): void {
        const parsed = Number(pageSize);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        this.pageChange.emit({ pageIndex: 0, pageSize: parsed });
    }

    goToPage(page: number | string): void {
        if (typeof page !== 'number') return;
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;
        this.pageChange.emit({ pageIndex: page - 1, pageSize: this.pageSize });
    }

    previousPage(): void {
        this.goToPage(this.currentPage - 1);
    }

    nextPage(): void {
        this.goToPage(this.currentPage + 1);
    }

    firstPage(): void {
        this.goToPage(1);
    }

    lastPage(): void {
        this.goToPage(this.totalPages);
    }

    onMobileSortFieldChange(field: string): void {
        const normalizedField = String(field ?? '').trim();
        if (!normalizedField) return;
        this.sortChange.emit({ field: normalizedField, direction: this.sortDirection });
    }

    toggleMobileSortDirection(): void {
        const fallbackField = this.sortFieldOptions[0]?.field ?? 'rec_name';
        const nextDirection: TableSortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.sortChange.emit({
            field: this.normalizeSortField(this.sortField || fallbackField),
            direction: nextDirection
        });
    }

    trackByFilterRuleIndex(index: number): number {
        return index;
    }

    private buildPageItems(currentPage: number, totalPages: number): Array<number | string> {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_value, index) => index + 1);
        }

        const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
        const sortedPages = [...pages]
            .filter(page => page >= 1 && page <= totalPages)
            .sort((left, right) => left - right);

        const pageItems: Array<number | string> = [];
        sortedPages.forEach((page, index) => {
            const previous = sortedPages[index - 1];
            if (previous && page - previous > 1) pageItems.push('…');
            pageItems.push(page);
        });
        return pageItems;
    }

    private normalizeSortField(field: string): string {
        const normalized = String(field ?? '').trim();
        return normalized === '__rec_name' ? 'rec_name' : normalized;
    }
}
