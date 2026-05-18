import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableColumn, TableRow } from '../models/app.types';

interface RecordCardFieldEntry {
    title: string;
    value: string;
}

@Component({
    selector: 'app-record-cards',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './record-cards.component.html',
    styleUrl: './record-cards.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordCardsComponent implements OnChanges {
    @Input() columns: readonly TableColumn[] = [];
    @Input() rows: readonly TableRow[] = [];
    @Input() selectedRows: readonly TableRow[] = [];
    @Input() selectedRecordName = '';
    @Input() showCopyAction = false;
    @Input() showRemoveAction = false;
    @Input() displayCell: (row: TableRow, field: string) => string = () => '';

    @Output() rowClick = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() selectionChange = new EventEmitter<TableRow[]>();
    @Output() copyRow = new EventEmitter<{ row: TableRow; event: Event }>();
    @Output() removeRow = new EventEmitter<{ row: TableRow; event: Event }>();

    private readonly fieldEntriesByRowId = new Map<number, RecordCardFieldEntry[]>();

    ngOnChanges(): void {
        this.rebuildFieldEntries();
    }

    trackRow(_index: number, row: TableRow): number {
        return row.__rowid;
    }

    isRowSelected(row: TableRow): boolean {
        return this.selectedRows.some(entry => entry.__rowid === row.__rowid);
    }

    primaryFields(row: TableRow): RecordCardFieldEntry[] {
        return this.fieldEntries(row).slice(0, 4);
    }

    extraFields(row: TableRow): RecordCardFieldEntry[] {
        return this.fieldEntries(row).slice(4);
    }

    hasExtraFields(row: TableRow): boolean {
        return this.fieldEntries(row).length > 4;
    }

    onToggleRow(row: TableRow, checked: boolean): void {
        const nextSelection = checked
            ? [...this.selectedRows.filter(entry => entry.__rowid !== row.__rowid), row]
            : this.selectedRows.filter(entry => entry.__rowid !== row.__rowid);
        this.selectionChange.emit(nextSelection);
    }

    onCardClick(row: TableRow, event: Event): void {
        if (this.isInteractiveTarget(event)) return;
        this.selectionChange.emit([row]);
        this.rowClick.emit({ row, event });
    }

    onCopyButton(row: TableRow, event: Event): void {
        event.stopPropagation();
        this.copyRow.emit({ row, event });
    }

    onRemoveButton(row: TableRow, event: Event): void {
        event.stopPropagation();
        this.removeRow.emit({ row, event });
    }

    private rebuildFieldEntries(): void {
        this.fieldEntriesByRowId.clear();
        const detailColumns = this.columns.filter(column => column.field !== '__rec_name');
        this.rows.forEach(row => {
            const entries = detailColumns
                .map(column => ({
                    title: column.title,
                    value: this.displayCell(row, column.field)
                }))
                .filter(entry => entry.value.trim().length > 0);
            this.fieldEntriesByRowId.set(row.__rowid, entries);
        });
    }

    private fieldEntries(row: TableRow): RecordCardFieldEntry[] {
        return this.fieldEntriesByRowId.get(row.__rowid) ?? [];
    }

    private isInteractiveTarget(event: Event): boolean {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest('button, input, label, select, textarea, a, summary, details, [data-row-action], [data-row-select]'));
    }
}
