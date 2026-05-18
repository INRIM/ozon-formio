import { DataSource } from '@angular/cdk/collections';
import { BehaviorSubject, Observable } from 'rxjs';
import { TableRow } from '../models/app.types';

export class RecordListDataSource extends DataSource<TableRow> {
    private readonly rows$ = new BehaviorSubject<readonly TableRow[]>([]);

    connect(): Observable<readonly TableRow[]> {
        return this.rows$.asObservable();
    }

    disconnect(): void {
        this.rows$.complete();
    }

    setRows(rows: readonly TableRow[]): void {
        this.rows$.next([...rows]);
    }
}
