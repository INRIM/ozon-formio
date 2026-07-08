import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OzonApiService } from '../core/ozon-api.service';
import { AppActionManagerService } from '../managers/app-action-manager.service';
import { AppFormioRendererService } from '../managers/app-formio-renderer.service';
import { AppTableManagerService } from '../managers/app-table-manager.service';
import { RecordListComponent } from '../list/record-list.component';
import { OzonRecordModalComponent } from './ozon-record-modal.component';
import { ListPageChange, ListSortChange, Rule, RuleSet, TableRow } from '../models/app.types';
import { requireResponseObject, ResponseObjectData } from '../models/ozon.types';

/**
 * Drives a full app-record-list (grid + pagination + fast-search filter) from an /action/{name}
 * GET response, for tables embedded inside another record's form (ozon_data_table Formio
 * component). Each instance gets its own AppTableManagerService (component-level provider) so
 * multiple embedded tables on one form, and the main list view, never share pagination/filter
 * state.
 */
@Component({
  selector: 'app-ozon-embedded-list',
  standalone: true,
  imports: [CommonModule, RecordListComponent, OzonRecordModalComponent],
  providers: [AppTableManagerService],
  templateUrl: './ozon-embedded-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OzonEmbeddedListComponent implements OnInit, OnChanges {
  @Input() actionName = '';
  @Input() orderDefault = '';
  @Input() model = '';
  /** Default scoping query from the paired search_area well's logic (e.g. only rows for the
   * current parent record). Seeded into the query builder as a normal, user-editable/removable
   * rule (not silently merged in) so it's visible and behaves exactly like any other filter. */
  @Input() baseQuery: Record<string, unknown> | null = null;
  /** Whether the paired search_area well is visible in the form design (static hidden flag or
   * conditional/logic-driven) - the embedded table's own filter button mirrors it, so hiding the
   * well in the builder is the one place that turns filtering on/off for this table. */
  @Input() filterVisible = true;
  /** properties.modal === 'y' on the table's Formio schema: open rows in a modal instead of
   * navigating to a new page. */
  @Input() openInModal = false;

  statusText = '';
  statusError = false;
  modalRecName: string | null = null;
  // Set once the initial baseQuery was representable as a query-builder rule - when true,
  // buildQuery() must not also merge baseQuery in underneath, or removing the rule in the UI
  // wouldn't actually widen the query.
  private baseQueryAppliedAsRule = false;
  private defaultRule: Rule | null = null;
  private firstLoadColumnsEstablished = false;

  // Matches AppComponent.recordDisplayCell: resolveFieldValue supports comma-separated candidate
  // fields, remote-select value resolution and cell renderers - a naive row[field] lookup here
  // silently returned '' for every cell whose key didn't happen to match those rules exactly.
  readonly displayCell = (row: TableRow, field: string): string => this.tableManager.displayCell(row, field);

  constructor(
    private readonly api: OzonApiService,
    private readonly renderer: AppFormioRendererService,
    private readonly actionManager: AppActionManagerService,
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
    readonly tableManager: AppTableManagerService
  ) {}

  ngOnInit(): void {
    // AppTableManagerService.applyViewportQueryChange (sort/page reload) no-ops while
    // selectedModel is empty - it's normally set by AppComponent's own navigation flow, which
    // this embedded, component-scoped instance never goes through.
    this.tableManager.selectedModel = this.model || this.actionName;
    if (this.orderDefault) this.tableManager.order = this.orderDefault;
    this.defaultRule = this.baseQueryToRule(this.baseQuery);
    if (this.defaultRule) {
      this.baseQueryAppliedAsRule = true;
      this.tableManager.setQueryBuilderRules({ condition: 'and', rules: [this.defaultRule] });
    }
    void this.load(false);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['actionName'] && !changes['actionName'].firstChange) void this.load(false);
  }

  onSortChange(change: ListSortChange): void {
    this.tableManager.onListSortChange(change, preserve => this.load(preserve));
  }

  // Matches AppComponent's own wiring: desktop grid emits one rowClick per real click, so a
  // single click both selects and opens; mobile cards only get one tap event per interaction, so
  // RecordListComponent itself splits it into select-on-tap / open-on-double-tap.
  onRowClick(row: TableRow, event: Event): void {
    this.tableManager.onTableRowClick(row, event, () => {});
  }

  async onRowOpen(row: TableRow, _event: Event): Promise<void> {
    const recName = String(row.__rec_name ?? '').trim();
    if (!recName) return;
    this.tableManager.onTableRowClick(row, _event, () => {});
    if (this.openInModal) {
      this.modalRecName = recName;
      this.cdr.markForCheck();
      return;
    }
    // Explicit action + recName from the clicked row, not the shared selection state - this
    // component has its own AppTableManagerService, but AppActionManagerService is the app-wide
    // one, and openRecordFromListSelection()/openSelectedRecord() read ITS OWN tableManager's
    // selectedRecordName, which would be whatever the main list last had selected (or nothing).
    await this.actionManager.openRecordByAction(this.actionName, recName);
  }

  onModalClosed(): void {
    this.modalRecName = null;
    this.cdr.markForCheck();
  }

  onModalSaved(): void {
    this.modalRecName = null;
    void this.load(true);
  }

  onPageChange(change: ListPageChange): void {
    this.tableManager.onListPageChange(change, preserve => this.load(preserve));
  }

  onSelectionChange(rows: TableRow[]): void {
    this.tableManager.onTableSelectionChange(rows, () => {});
  }

  onFilterRulesChange(rules: RuleSet): void {
    this.tableManager.setQueryBuilderRules(rules);
  }

  applyFilters(): void {
    this.tableManager.applyQueryBuilderFilters();
    void this.load(false);
  }

  resetFilters(): void {
    this.tableManager.resetQueryBuilderFilters();
    void this.load(false);
  }

  async onFastSearchFormChange(event: unknown): Promise<void> {
    const autoSubmit = await this.tableManager.applyFastSearchFormChange(event);
    if (autoSubmit) void this.doFastSearch();
  }

  async doFastSearch(): Promise<void> {
    this.tableManager.activateFastSearch();
    await this.load(false);
  }

  async resetFastSearch(): Promise<void> {
    this.tableManager.resetFastSearch();
    await this.load(false);
  }

  private async load(preservePaginatorState: boolean): Promise<void> {
    const actionName = String(this.actionName ?? '').trim();
    if (!actionName || this.tableManager.isLoadingRecords) return;

    const query = this.buildQuery();
    const querySignature = this.tableManager.stableStringify({
      action: actionName, query, order: this.tableManager.order, limit: this.tableManager.limit, skip: this.tableManager.skip
    });
    // preserveColumns keeps tableColumns (and, critically, the query-builder field allow-list
    // that pruneInvalidRules checks rules against) intact across reloads - without it, every
    // reload transiently resets tableColumns to a rec_name-only placeholder, and pruneInvalidRules
    // wipes out any rule (including the seeded default one) whose field isn't rec_name.
    this.tableManager.prepareLoadRecords(preservePaginatorState, querySignature, { preserveColumns: true });
    this.cdr.markForCheck();
    try {
      // Formio renders outside NgZone (AppComponent's <formio> wraps setForm in
      // runOutsideAngular), and this component is mounted straight into that DOM node via
      // createComponent - so this await's continuation inherits the same outside-zone context.
      // Without an explicit zone.run, OnPush would never pick up these mutations.
      const response = await this.api.getAction(actionName, {
        query,
        order: this.tableManager.order,
        skip: this.tableManager.skip,
        limit: this.tableManager.limit
      });
      const content = requireResponseObject(response).content;
      await this.zone.run(async () => {
        const rowCount = this.applyListResponse(content);
        this.tableManager.finishLoadRecords(querySignature, {
          count: rowCount,
          totalCount: content.total_count || rowCount
        });
        // On the very first load, real columns aren't known yet when prepareLoadRecords() runs,
        // so preserveColumns can't help - pruneInvalidRules wipes the seeded default rule before
        // this response even lands. Re-seed it once now that real columns exist; from here on,
        // preserveColumns above keeps it (and any rule the user adds) safe on every reload.
        if (!this.firstLoadColumnsEstablished) {
          this.firstLoadColumnsEstablished = true;
          if (this.defaultRule && !this.tableManager.queryBuilderRules.rules.length) {
            this.tableManager.setQueryBuilderRules({ condition: 'and', rules: [this.defaultRule] });
          }
        }
        await this.applyFastSearchConfig(content.fields || {});
        this.statusText = `Record: ${this.tableManager.allRows.length} / Totale: ${this.tableManager.tableTotalRecords}`;
        this.statusError = false;
        this.cdr.markForCheck();
      });
    } catch (error) {
      this.zone.run(() => {
        this.statusText = error instanceof Error ? error.message : String(error);
        this.statusError = true;
        this.tableManager.isLoadingRecords = false;
        this.cdr.markForCheck();
      });
    }
  }

  private buildQuery(): Record<string, unknown> {
    const dynamicQuery = this.tableManager.fastSearchActive
      ? {}
      : (this.tableManager.parseQueryInput((m, e) => { this.statusText = m; this.statusError = e; }) ?? {});
    // When baseQuery was seeded as a query-builder rule, it's already inside dynamicQuery (and
    // the user may have edited/removed it there) - merging it again here would make it
    // unremovable, defeating the point of exposing it as a normal filter.
    if (this.baseQueryAppliedAsRule) return dynamicQuery;
    const base = this.baseQuery;
    if (!base || !Object.keys(base).length) return dynamicQuery;
    if (!Object.keys(dynamicQuery).length) return base;
    return { $and: [base, dynamicQuery] };
  }

  /** Converts a resolved single-field-equality scoping query (e.g. {"group": "admin"}) into a
   * query-builder rule. Anything more complex (nested operators, multiple keys) isn't safely
   * representable as one rule, so it's left to the invisible-merge fallback in buildQuery(). */
  private baseQueryToRule(query: Record<string, unknown> | null): Rule | null {
    if (!query) return null;
    const keys = Object.keys(query);
    if (keys.length !== 1) return null;
    const field = keys[0];
    const value = query[field];
    if (value === null || typeof value === 'object') return null;
    return { field, operator: '=', value };
  }

  private applyListResponse(content: ResponseObjectData): number {
    const rows = Array.isArray(content.data) ? content.data : [];
    this.tableManager.strictHeaderColumns = Object.keys(content.columns || {}).length > 0;
    this.tableManager.applyTableColumnsFromHeader(content.columns);
    rows.forEach(row => this.tableManager.appendRecordRow(row));
    if (content.sort) this.tableManager.order = content.sort;
    return rows.length;
  }

  private async applyFastSearchConfig(fields: Record<string, unknown>): Promise<void> {
    const rawConfig = fields['fast_search'];
    if (!rawConfig || typeof rawConfig !== 'object') {
      this.tableManager.beginFastSearchWarmup(false);
      return;
    }
    const revision = this.tableManager.beginFastSearchWarmup(true);
    const cfg = rawConfig as Record<string, unknown>;
    const schema = this.renderer.extractFormSchema(cfg['schema']);
    const formModel = String(cfg['fast_serch_model'] ?? cfg['fast_search_model'] ?? '').trim();
    await this.tableManager.setFastSearchConfig(this.actionName, schema, formModel, revision);
  }
}
