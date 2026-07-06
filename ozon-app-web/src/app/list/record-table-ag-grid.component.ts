import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import {
    AllCommunityModule, CellClickedEvent, ColDef, GridApi, GridReadyEvent, ModuleRegistry, RowClickedEvent,
    RowDoubleClickedEvent, RowDragEndEvent, SelectionChangedEvent, SortChangedEvent, themeQuartz
} from 'ag-grid-community';
import { ListRowReorderChange, ListSortChange, TableColumn, TableRow, TableSortDirection } from '../models/app.types';
import { RecordTableRowActionsComponent, RecordRowActionsParams } from './record-table-row-actions.component';

// Registered here (module-scope, runs once on first import) rather than only in main.ts so it
// also covers the Karma test bundle, which doesn't go through main.ts — without it AG Grid
// renders blank with a console error ("No AG Grid modules are registered").
ModuleRegistry.registerModules([AllCommunityModule]);

const SELECT_COL_ID = '__select';
const HANDLE_COL_ID = '__handle';
const ACTIONS_COL_ID = '__actions';

// AG Grid v36's Theming API, not the old CSS-file + `theme: 'legacy'` compat shim: that shim
// doesn't keep re-reading --ag-* custom properties from the DOM after the grid's initial paint,
// so it never picked up the app's dark/light toggle (which flips --ozon-* at :root[data-theme]).
// Theme parameters *are* implemented as live CSS custom properties under the hood, so pointing
// them at --ozon-* here keeps that single source of truth and reacts to the toggle automatically
// - no JS-side light/dark theme switching needed.
const GRID_THEME = themeQuartz.withParams({
    // backgroundColor/foregroundColor/accentColor are the 3 foundational colors themeQuartz's
    // built-in colorSchemeVariable part derives every other color from (focus rings, checkboxes,
    // header tint, etc.) - setting only background/foreground without accentColor left those
    // derived states using AG Grid's own default blue instead of the app's own accent.
    backgroundColor: 'var(--ozon-surface)',
    foregroundColor: 'var(--ozon-text)',
    accentColor: 'rgb(111, 182, 255)',
    headerTextColor: 'var(--ozon-text)',
    borderColor: 'var(--ozon-border)',
    rowHoverColor: 'rgba(111, 182, 255, 0.08)',
    selectedRowBackgroundColor: 'rgba(111, 182, 255, 0.2)',
    oddRowBackgroundColor: 'var(--ozon-surface)',
    fontFamily: 'inherit',
    fontSize: '0.92rem',
    cellHorizontalPadding: '0.85rem',
    borderRadius: 0
});

/**
 * Pure rendering surface — pagination, filtering and sorting of the actual dataset all happen
 * server-side (RecordListComponent emits an event, the parent reloads `rows` from the backend).
 * AG Grid's own client-side pagination/filtering are never enabled, and column sort uses a no-op
 * comparator so a header click updates the arrow and fires `sortChange` without AG Grid silently
 * re-sorting just the current page in place.
 */
@Component({
    selector: 'app-record-table-ag-grid',
    standalone: true,
    imports: [CommonModule, AgGridAngular],
    templateUrl: './record-table-ag-grid.component.html',
    styleUrl: './record-table-ag-grid.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordTableAgGridComponent implements OnChanges {
    @Input() columns: readonly TableColumn[] = [];
    @Input() rows: readonly TableRow[] = [];
    @Input() selectedRows: readonly TableRow[] = [];
    @Input() selectedRecordName = '';
    @Input() sortField = 'rec_name';
    @Input() sortDirection: TableSortDirection = 'asc';
    @Input() showCopyAction = false;
    @Input() showRemoveAction = false;
    @Input() displayCell: (row: TableRow, field: string) => string = () => '';

    @Output() rowClick = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() rowDblClick = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() selectionChange = new EventEmitter<TableRow[]>();
    @Output() sortChange = new EventEmitter<ListSortChange>();
    @Output() rowReorder = new EventEmitter<ListRowReorderChange>();
    @Output() copyRow = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() removeRow = new EventEmitter<{ row: TableRow; event: Event }>();

    @ViewChild(AgGridAngular) grid?: AgGridAngular;

    readonly gridTheme = GRID_THEME;

    colDefs: ColDef<TableRow>[] = [];
    rowData: TableRow[] = [];
    getRowId = (params: { data: TableRow }) => String(params.data.__rowid);

    readonly defaultColDef: ColDef = {
        sortable: true,
        resizable: true,
        sortingOrder: ['asc', 'desc'] as const,
        comparator: () => 0
    };

    readonly rowSelection = 'multiple' as const;
    // Unmanaged: the reorder here is local-only (RecordTableManagerService splices `allRows` and
    // reassigns `rows`, no backend round-trip), which flows straight back into this component's
    // `rows` @Input and replaces `rowData` in ngOnChanges. With `rowDragManaged: true`, AG Grid
    // *also* live-reorders its own internal row model during the drag — that second, competing
    // reorder plus the rowData swap landing mid-animation made AG Grid misfire extra
    // `rowDragEnd` events, chaining into a reorder loop. Unmanaged mode only shows a drop-position
    // indicator during the drag and leaves the actual row order to the one place that should own
    // it: the `rowData` this component is given.
    readonly rowDragManaged = false;
    readonly suppressCellFocus = true;

    readonly rowClassRules = {
        'ozon-row-selected': (params: { data?: TableRow }) => params.data?.__rec_name === this.selectedRecordName
    };

    private gridApi?: GridApi<TableRow>;
    private syncingSelection = false;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['columns'] || changes['showCopyAction'] || changes['showRemoveAction']) {
            this.colDefs = this.buildColDefs();
        }
        if (changes['rows']) {
            this.rowData = [...this.rows];
        }
        if (changes['selectedRows'] && this.gridApi) {
            this.syncSelectionToGrid();
        }
        if (changes['selectedRecordName'] && this.gridApi) {
            this.gridApi.redrawRows();
        }
        if ((changes['sortField'] || changes['sortDirection']) && this.gridApi) {
            this.syncSortToGrid();
        }
    }

    onGridReady(event: GridReadyEvent<TableRow>): void {
        this.gridApi = event.api;
        this.syncSelectionToGrid();
        this.syncSortToGrid();
    }

    onSelectionChanged(_event: SelectionChangedEvent<TableRow>): void {
        if (this.syncingSelection || !this.gridApi) return;
        this.selectionChange.emit(this.gridApi.getSelectedRows());
    }

    onSortChanged(_event: SortChangedEvent<TableRow>): void {
        if (!this.gridApi) return;
        const sorted = this.gridApi.getColumnState().find(state => state.sort);
        if (!sorted?.colId) return;
        const field = this.normalizeSortField(sorted.colId);
        const direction: TableSortDirection = sorted.sort === 'desc' ? 'desc' : 'asc';
        // `applyColumnState` (syncSortToGrid, below) fires this same event just like a real header
        // click does — AG Grid doesn't distinguish the two. A timing-based re-entrancy flag doesn't
        // work here because that event fires asynchronously, after the flag's already been reset.
        // Comparing against the sort this component was already told to have is timing-independent:
        // if the grid's state already matches, this event is an echo of our own sync, not a new
        // user action, so skip it — otherwise sync → event → emit → parent reloads → sync loops.
        if (field === this.normalizeSortField(this.sortField) && direction === this.sortDirection) return;
        this.sortChange.emit({ field, direction });
    }

    onRowClicked(event: RowClickedEvent<TableRow>): void {
        if (!event.data || this.isNonNavigableCell(event.event)) return;
        this.rowClick.emit({ row: event.data, event: event.event as Event });
    }

    onRowDoubleClicked(event: RowDoubleClickedEvent<TableRow>): void {
        if (!event.data || this.isNonNavigableCell(event.event)) return;
        this.rowDblClick.emit({ row: event.data, event: event.event as Event });
    }

    onCellClicked(_event: CellClickedEvent<TableRow>): void {
        // Selection/drag/action cells stop propagation themselves (checkbox, handle, buttons);
        // this handler exists only so template wiring stays symmetric with the row events above.
    }

    onRowDragEnd(event: RowDragEndEvent<TableRow>): void {
        if (!event.node.data) return;
        const previousIndex = this.rows.findIndex(row => row.__rowid === event.node.data!.__rowid);
        const currentIndex = event.overIndex;
        if (previousIndex === -1 || currentIndex === -1 || previousIndex === currentIndex) return;
        this.rowReorder.emit({ previousIndex, currentIndex });
    }

    private isNonNavigableCell(nativeEvent: Event | null | undefined): boolean {
        const target = nativeEvent?.target as HTMLElement | null;
        if (!target) return false;
        const cell = target.closest('[col-id]');
        const colId = cell?.getAttribute('col-id');
        return colId === SELECT_COL_ID || colId === HANDLE_COL_ID || colId === ACTIONS_COL_ID;
    }

    private syncSelectionToGrid(): void {
        if (!this.gridApi) return;
        this.syncingSelection = true;
        const selectedIds = new Set(this.selectedRows.map(row => String(row.__rowid)));
        this.gridApi.forEachNode(node => {
            const id = node.data ? String(node.data.__rowid) : undefined;
            const shouldSelect = Boolean(id && selectedIds.has(id));
            if (node.isSelected() !== shouldSelect) node.setSelected(shouldSelect);
        });
        this.syncingSelection = false;
    }

    private syncSortToGrid(): void {
        if (!this.gridApi) return;
        const field = this.normalizeSortField(this.sortField);
        this.gridApi.applyColumnState({
            state: this.columns.map(column => ({
                colId: column.field,
                sort: column.field === field ? this.sortDirection : null
            }))
        });
    }

    private buildColDefs(): ColDef<TableRow>[] {
        const defs: ColDef<TableRow>[] = [
            {
                colId: SELECT_COL_ID,
                headerCheckboxSelection: true,
                checkboxSelection: true,
                sortable: false,
                resizable: false,
                width: 52,
                pinned: 'left',
                suppressMovable: true,
                headerName: ''
            },
            {
                colId: HANDLE_COL_ID,
                rowDrag: true,
                sortable: false,
                resizable: false,
                width: 44,
                pinned: 'left',
                suppressMovable: true,
                headerName: ''
            },
            ...this.columns.map((column): ColDef<TableRow> => ({
                colId: column.field,
                headerName: column.title,
                flex: 1,
                minWidth: 140,
                valueGetter: params => params.data ? this.displayCell(params.data, column.field) : ''
            }))
        ];

        if (this.showCopyAction || this.showRemoveAction) {
            defs.push({
                colId: ACTIONS_COL_ID,
                headerName: '',
                sortable: false,
                resizable: false,
                width: this.showCopyAction && this.showRemoveAction ? 96 : 56,
                pinned: 'right',
                suppressMovable: true,
                cellRenderer: RecordTableRowActionsComponent,
                cellRendererParams: {
                    showCopyAction: this.showCopyAction,
                    showRemoveAction: this.showRemoveAction,
                    onCopy: (row: TableRow, event: Event) => this.copyRow.emit({ row, event }),
                    onRemove: (row: TableRow, event: Event) => this.removeRow.emit({ row, event })
                } satisfies Partial<RecordRowActionsParams>
            });
        }

        return defs;
    }

    private normalizeSortField(field: string): string {
        const normalized = String(field ?? '').trim();
        return normalized === '__rec_name' ? 'rec_name' : normalized;
    }
}
