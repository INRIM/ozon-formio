import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GlobalErrorStateService {
    visible = false;
    message = '';
    details = '';

    report(message: string, details = ''): void {
        this.visible = true;
        this.message = message;
        this.details = details;
    }

    clear(): void {
        this.visible = false;
        this.message = '';
        this.details = '';
    }
}
