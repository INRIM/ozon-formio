import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OzonApiService } from '../core/ozon-api.service';
import { AppFormioRendererService } from '../managers/app-formio-renderer.service';
import { AppTableManagerService } from '../managers/app-table-manager.service';
import { RecordListComponent } from '../list/record-list.component';
import { ListPageChange, ListSortChange, RuleSet, TableRow } from '../models/app.types';
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
  imports: [CommonModule, RecordListComponent],
  providers: [AppTableManagerService],
  templateUrl: './ozon-embedded-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OzonEmbeddedListComponent implements OnInit, OnChanges {
  @Input() actionName = '';
  @Input() orderDefault = '';
  /** Default scoping query from the paired search_area well's logic (e.g. only rows for the
   * current parent record) - always applied, merged with whatever the user's own filter adds. */
  @Input() baseQuery: Record<string, unknown> | null = null;

  statusText = '';
  statusError = false;

  // Matches AppComponent.recordDisplayCell: resolveFieldValue supports comma-separated candidate
  // fields, remote-select value resolution and cell renderers - a naive row[field] lookup here
  // silently returned '' for every cell whose key didn't happen to match those rules exactly.
  readonly displayCell = (row: TableRow, field: string): string => this.tableManager.displayCell(row, field);

  constructor(
    private readonly api: OzonApiService,
    private readonly renderer: AppFormioRendererService,
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
    readonly tableManager: AppTableManagerService
  ) {}

  ngOnInit(): void {
    if (this.orderDefault) this.tableManager.order = this.orderDefault;
    void this.load(false);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['actionName'] && !changes['actionName'].firstChange) void this.load(false);
  }

  onSortChange(change: ListSortChange): void {
    this.tableManager.onListSortChange(change, preserve => this.load(preserve));
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
    this.tableManager.prepareLoadRecords(preservePaginatorState, querySignature);
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
        console.log('[ozon_embedded_list] tableColumns after flush', this.tableManager.tableColumns);
        console.log('[ozon_embedded_list] tableRows[0] after flush', this.tableManager.tableRows[0]);
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
    const base = this.baseQuery;
    if (!base || !Object.keys(base).length) return dynamicQuery;
    if (!Object.keys(dynamicQuery).length) return base;
    return { $and: [base, dynamicQuery] };
  }

  private applyListResponse(content: ResponseObjectData): number {
    const rows = Array.isArray(content.data) ? content.data : [];
    this.tableManager.strictHeaderColumns = Object.keys(content.columns || {}).length > 0;
    this.tableManager.applyTableColumnsFromHeader(content.columns);
    rows.forEach(row => this.tableManager.appendRecordRow(row));
    if (content.sort) this.tableManager.order = content.sort;
    console.log('[ozon_embedded_list] content.columns', content.columns);
    console.log('[ozon_embedded_list] rows[0] raw', rows[0]);
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
