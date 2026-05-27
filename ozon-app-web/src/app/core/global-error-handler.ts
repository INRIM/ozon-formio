import { ApplicationRef, ErrorHandler, Injectable } from '@angular/core';
import { GlobalErrorStateService } from './global-error-state.service';

/**
 * Global error handler that catches uncaught exceptions (including those thrown
 * during Angular change detection) and attempts to recover the application by
 * forcing a change detection tick, leaving the DOM in a consistent state.
 *
 * ApplicationRef is wired in lazily via setAppRef() from APP_INITIALIZER to
 * avoid circular DI issues (ErrorHandler is created before the injector is full).
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
    private appRef: ApplicationRef | null = null;
    private recovering = false;
    private readonly fallbackId = 'ozon-global-error-fallback';

    constructor(private readonly errorState: GlobalErrorStateService) {}

    setAppRef(ref: ApplicationRef): void {
        this.appRef = ref;
    }

    handleError(error: unknown): void {
        console.error('[GlobalErrorHandler]', error);
        const message = this.describeErrorMessage(error);
        const details = this.describeErrorDetails(error);
        this.errorState.report(message, details);

        if (this.recovering) return;
        if (!this.appRef) {
            this.renderFallback(message, details);
            return;
        }
        this.recovering = true;
        try {
            this.appRef.tick();
        } catch (recoveryError) {
            console.warn('[GlobalErrorHandler] Recovery tick failed:', recoveryError);
            this.renderFallback(message, details);
        } finally {
            this.recovering = false;
        }
    }

    private describeErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) return error.message.trim();
        if (typeof error === 'string' && error.trim()) return error.trim();
        if (this.isRecord(error) && typeof error['message'] === 'string' && error['message'].trim()) {
            return error['message'].trim();
        }
        return 'Errore client non gestito';
    }

    private describeErrorDetails(error: unknown): string {
        if (error instanceof Error) return error.stack ?? error.message;
        if (typeof error === 'string') return error;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private renderFallback(message: string, details: string): void {
        if (typeof document === 'undefined') return;

        let root = document.getElementById(this.fallbackId);
        let messageEl: HTMLParagraphElement | null = null;
        let detailsEl: HTMLPreElement | null = null;

        if (!root) {
            root = document.createElement('div');
            root.id = this.fallbackId;
            root.setAttribute('role', 'alertdialog');
            root.setAttribute('aria-live', 'assertive');
            Object.assign(root.style, {
                position: 'fixed',
                inset: '0',
                zIndex: '2147483647',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                background: 'rgba(7, 18, 31, 0.7)'
            } satisfies Partial<CSSStyleDeclaration>);

            const panel = document.createElement('div');
            Object.assign(panel.style, {
                width: 'min(720px, 100%)',
                maxHeight: '80vh',
                overflow: 'auto',
                borderRadius: '16px',
                border: '1px solid #d9e3f2',
                background: '#ffffff',
                color: '#17324d',
                boxShadow: '0 18px 40px rgba(10, 34, 63, 0.28)',
                padding: '20px'
            } satisfies Partial<CSSStyleDeclaration>);

            const title = document.createElement('h2');
            title.textContent = 'Errore client';
            Object.assign(title.style, {
                margin: '0 0 8px',
                fontSize: '1.25rem'
            } satisfies Partial<CSSStyleDeclaration>);

            messageEl = document.createElement('p');
            messageEl.dataset['role'] = 'message';
            Object.assign(messageEl.style, {
                margin: '0 0 12px',
                fontWeight: '600'
            } satisfies Partial<CSSStyleDeclaration>);

            detailsEl = document.createElement('pre');
            detailsEl.dataset['role'] = 'details';
            Object.assign(detailsEl.style, {
                margin: '0 0 16px',
                padding: '12px',
                borderRadius: '10px',
                background: '#f4f7fb',
                color: '#17324d',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '0.85rem'
            } satisfies Partial<CSSStyleDeclaration>);

            const actions = document.createElement('div');
            Object.assign(actions.style, {
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap'
            } satisfies Partial<CSSStyleDeclaration>);

            const dashboardButton = document.createElement('button');
            dashboardButton.type = 'button';
            dashboardButton.textContent = 'Dashboard';
            Object.assign(dashboardButton.style, this.fallbackButtonStyles('#ffffff', '#0053a6', '#0053a6'));
            dashboardButton.addEventListener('click', () => {
                if (typeof window !== 'undefined') window.location.assign('/dashboard');
            });

            const reloadButton = document.createElement('button');
            reloadButton.type = 'button';
            reloadButton.textContent = 'Ricarica pagina';
            Object.assign(reloadButton.style, this.fallbackButtonStyles('#0053a6', '#ffffff', '#0053a6'));
            reloadButton.addEventListener('click', () => {
                if (typeof window !== 'undefined') window.location.reload();
            });

            actions.append(dashboardButton, reloadButton);
            panel.append(title, messageEl, detailsEl, actions);
            root.append(panel);
            document.body.append(root);
        } else {
            messageEl = root.querySelector('[data-role="message"]');
            detailsEl = root.querySelector('[data-role="details"]');
        }

        if (messageEl) messageEl.textContent = message;
        if (detailsEl) detailsEl.textContent = details;
    }

    private fallbackButtonStyles(background: string, color: string, borderColor: string): Partial<CSSStyleDeclaration> {
        return {
            appearance: 'none',
            border: `1px solid ${borderColor}`,
            borderRadius: '10px',
            background,
            color,
            padding: '0.65rem 1rem',
            fontWeight: '600',
            cursor: 'pointer'
        };
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }
}
