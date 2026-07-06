import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { TableRow } from '../models/app.types';

export interface RecordRowActionsParams extends ICellRendererParams<TableRow> {
    showCopyAction: boolean;
    showRemoveAction: boolean;
    onCopy: (row: TableRow, event: Event) => void;
    onRemove: (row: TableRow, event: Event) => void;
}

@Component({
    selector: 'app-record-table-row-actions',
    standalone: true,
    imports: [CommonModule],
    template: `
        <button
            *ngIf="params.showCopyAction"
            type="button"
            class="btn btn-sm btn-link text-decoration-none"
            data-row-action
            (click)="onCopyClick($event)"
            [attr.aria-label]="'Copia ' + (params.data?.__rec_name ?? '')"
        ><span class="pi pi-copy"></span></button>
        <button
            *ngIf="params.showRemoveAction"
            type="button"
            class="btn btn-sm btn-link text-danger text-decoration-none"
            data-row-action
            (click)="onRemoveClick($event)"
            [attr.aria-label]="'Rimuovi ' + (params.data?.__rec_name ?? '')"
        ><span class="pi pi-trash"></span></button>
    `
})
export class RecordTableRowActionsComponent implements ICellRendererAngularComp {
    params!: RecordRowActionsParams;

    agInit(params: RecordRowActionsParams): void {
        this.params = params;
    }

    refresh(): boolean {
        return false;
    }

    onCopyClick(event: Event): void {
        event.stopPropagation();
        if (this.params.data) this.params.onCopy(this.params.data, event);
    }

    onRemoveClick(event: Event): void {
        event.stopPropagation();
        if (this.params.data) this.params.onRemove(this.params.data, event);
    }
}
