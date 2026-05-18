import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkTableModule } from '@angular/cdk/table';
import { ListRowReorderChange, ListSortChange, TableColumn, TableRow, TableSortDirection } from '../models/app.types';
import { RecordListDataSource } from './record-list.datasource';

@Component({
    selector: 'app-record-table-cdk',
    standalone: true,
    imports: [CommonModule, CdkTableModule, DragDropModule],
    templateUrl: './record-table-cdk.component.html',
    styleUrl: './record-table-cdk.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordTableCdkComponent implements OnChanges {
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

    readonly dataSource = new RecordListDataSource();
    displayedColumns: string[] = [];
    gridTemplateColumns = '';

    ngOnChanges(): void {
        this.dataSource.setRows(this.rows);
        this.displayedColumns = this.buildDisplayedColumns();
        this.gridTemplateColumns = this.buildGridTemplateColumns();
    }

    trackColumn(_index: number, column: TableColumn): string {
        return column.field;
    }

    isRowSelected(row: TableRow): boolean {
        return this.selectedRows.some(entry => entry.__rowid === row.__rowid);
    }

    isSortActive(field: string): boolean {
        return this.normalizeSortField(field) === this.normalizeSortField(this.sortField);
    }

    isSortAscending(field: string): boolean {
        return this.isSortActive(field) && this.sortDirection === 'asc';
    }

    get allVisibleSelected(): boolean {
        return this.rows.length > 0 && this.rows.every(row => this.isRowSelected(row));
    }

    get someVisibleSelected(): boolean {
        return this.rows.some(row => this.isRowSelected(row)) && !this.allVisibleSelected;
    }

    onToggleAll(checked: boolean): void {
        this.selectionChange.emit(checked ? [...this.rows] : []);
    }

    onToggleRow(row: TableRow, checked: boolean): void {
        const nextSelection = checked
            ? [...this.selectedRows.filter(entry => entry.__rowid !== row.__rowid), row]
            : this.selectedRows.filter(entry => entry.__rowid !== row.__rowid);
        this.selectionChange.emit(nextSelection);
    }

    onSort(field: string): void {
        const nextDirection: TableSortDirection = this.isSortActive(field) && this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.sortChange.emit({ field: this.normalizeSortField(field), direction: nextDirection });
    }

    onDrop(event: CdkDragDrop<readonly TableRow[]>): void {
        if (event.previousIndex === event.currentIndex) return;
        this.rowReorder.emit({
            previousIndex: event.previousIndex,
            currentIndex: event.currentIndex
        });
    }

    onCopyButton(row: TableRow, event: Event): void {
        event.stopPropagation();
        this.copyRow.emit({ row, event });
    }

    onRemoveButton(row: TableRow, event: Event): void {
        event.stopPropagation();
        this.removeRow.emit({ row, event });
    }

    private buildDisplayedColumns(): string[] {
        const columns = ['__select', '__handle', ...this.columns.map(column => column.field)];
        if (this.showCopyAction) columns.push('__copy');
        if (this.showRemoveAction) columns.push('__remove');
        return columns;
    }

    private buildGridTemplateColumns(): string {
        const dynamicColumns = this.columns.map(() => 'minmax(10rem, 1fr)');
        const template = ['3.25rem', '2.75rem', ...dynamicColumns];
        if (this.showCopyAction) template.push('4.5rem');
        if (this.showRemoveAction) template.push('5.5rem');
        return template.join(' ');
    }

    private normalizeSortField(field: string): string {
        const normalized = String(field ?? '').trim();
        return normalized === '__rec_name' ? 'rec_name' : normalized;
    }
}
