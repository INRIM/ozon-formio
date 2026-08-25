import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { FormioComponent } from '@formio/angular';
import jsonLogic from 'json-logic-js';
import { OzonApiService } from '../core/ozon-api.service';
import { MainManagerService } from '../core/main-manager.service';
import { AppManagerService } from './app-manager.service';
import { AppTableManagerService } from './app-table-manager.service';
import { AppFormioRendererService, OZON_INLINE_ACTION_EVENT } from './app-formio-renderer.service';
import { AppFormioBuilderService } from './app-formio-builder.service';
import { requireResponseObject, ResponseObject, ResponseObjectData } from '../models/ozon.types';
import {
    ButtonModalConfig, ContextAction, FormNotification, MenuActionDescriptor, MenuButton, MenuCard, MenuDrillDownGroup
} from '../models/app.types';
import { OzonFormBuilderHostComponent } from '../formio/ozon-form-builder-host.component';

// Backend-configured menu icons still arrive as Font Awesome / PrimeIcons class names
// (e.g. 'fa-plus', 'pi-pencil'), but neither icon font ships in this app anymore.
// Map the names we actually see onto the equivalent Bootstrap Italia SVG icon id.
const ICON_FONT_TO_BOOTSTRAP_ITALIA: Record<string, string> = {
    plus: 'plus',
    'plus-circle': 'plus-circle',
    pencil: 'pencil',
    edit: 'pencil',
    trash: 'delete',
    'trash-alt': 'delete',
    delete: 'delete',
    times: 'close',
    close: 'close',
    'times-circle': 'close-circle',
    check: 'check',
    'check-circle': 'check-circle',
    list: 'list',
    search: 'search',
    download: 'download',
    upload: 'upload',
    cog: 'settings',
    cogs: 'settings',
    settings: 'settings'
};

interface FastActionRowResult {
    rec_name: string;
    status: string;
    message?: string;
}

interface PendingFastAction {
    button: MenuButton;
    actionPath: string;
    payload: Record<string, unknown>;
    selectedRecNames: string[];
    component: Record<string, unknown>;
    properties: Record<string, unknown>;
}

@Injectable()
export class AppActionManagerService {
    currentActionName = '';
    isTransitionLoading = false;
    formResponseActionButtons: MenuButton[] = [];
    contextActions: ContextAction[] = [];
    hasContextActionsPayload = false;
    currentFormSubmitActionPath = '';
    currentFormPageTitle = '';
    private currentFormOriginPath = '';
    currentFormSubmitNextActionPath = '';
    currentFormAbandonActionPath = '';
    currentFormCancelButtonVisible = false;

    confirmModalVisible = false;
    confirmModalConfig: ButtonModalConfig | null = null;
    private pendingModalButton: MenuButton | null = null;
    private pendingFastAction: PendingFastAction | null = null;

    private currentListComponentType = '';
    private redirectingToLogin = false;
    private backendSessionReady = false;
    private transitionLoadingCount = 0;
    private isPopStateRegistered = false;
    private unauthorizedSub?: Subscription;
    private pageContextId = 0;
    private readonly onPopState = () => { void this.handleLocationRoute(false); };

    private readonly btnActionParser: Record<string, 'post' | false> = {
        save: 'post', post: 'post', copy: 'post', delete: 'post', window: false
    };
    private readonly uiReqId = `req_${Math.random().toString(36).slice(2)}`;

    constructor(
        private readonly api: OzonApiService,
        private readonly mainManager: MainManagerService,
        private readonly appManager: AppManagerService,
        private readonly tableManager: AppTableManagerService,
        private readonly renderer: AppFormioRendererService,
        private readonly builder: AppFormioBuilderService
    ) {}

    isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
    errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }

    readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) { if (typeof entry === 'string' && entry.trim()) return entry.trim(); }
        return '';
    }

    private resetContextActionState(): void {
        this.formResponseActionButtons = [];
        this.contextActions = [];
        this.hasContextActionsPayload = false;
        this.currentFormPageTitle = '';
        this.currentFormOriginPath = '';
        this.currentFormAbandonActionPath = '';
        this.currentFormCancelButtonVisible = false;
    }

    private beginPageContext(): number {
        this.pageContextId += 1;
        this.appManager.clearFormNotifications();
        this.renderer.clearActiveFormView();
        return this.pageContextId;
    }

    private isCurrentPageContext(pageContextId: number): boolean {
        return pageContextId === this.pageContextId;
    }

    toDisplayValue(v: unknown): string {
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }

    parseJsonMaybe(value: unknown): unknown {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        if (!(raw.startsWith('{') || raw.startsWith('['))) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }

    asRecord(value: unknown): Record<string, unknown> | null {
        if (this.isRecord(value)) return value;
        const parsed = this.parseJsonMaybe(value);
        return this.isRecord(parsed) ? parsed : null;
    }

    setStatus(m: string, e: boolean): void { this.appManager.setStatus(m, e); }

    get statusText(): string { return this.appManager.statusText; }
    get statusError(): boolean { return this.appManager.statusError; }

    initSubscriptions(): void {
        this.unauthorizedSub = this.api.unauthorized$.subscribe(() => {
            if (this.redirectingToLogin) return;
            this.redirectingToLogin = true;
            this.login();
        });
    }

    destroySubscriptions(): void {
        this.unauthorizedSub?.unsubscribe();
        if (typeof window !== 'undefined' && this.isPopStateRegistered) {
            window.removeEventListener('popstate', this.onPopState);
            this.isPopStateRegistered = false;
        }
    }

    async initializeApplication(): Promise<void> {
        this.setStatus('Sincronizzazione sessione Keycloak...', false);
        try {
            const authResult = await this.appManager.bootstrap();
            this.appManager.applyRuntime(this.api.getRuntimeConfig());
            if (authResult.serverError) {
                this.backendSessionReady = false;
                this.appManager.backendSessionReady = false;
                this.appManager.serverErrorRetryVisible = true;
                this.setStatus('Backend non disponibile (errore server). Verifica i log e riprova.', true);
                return;
            }
            if (!authResult.authenticated) {
                if (this.redirectingToLogin) return;
                const loginUrl = this.appManager.getLoginUrl();
                if (loginUrl) {
                    this.redirectingToLogin = true;
                    const reloadResult = this.mainManager.hardReloadToUrl(loginUrl);
                    if (reloadResult.reloaded) return;
                    if (reloadResult.blocked) { this.setStatus(`Login bloccato verso origine non consentita: ${reloadResult.targetUrl}`, true); return; }
                    return;
                }
                this.backendSessionReady = false;
                this.appManager.backendSessionReady = false;
                this.setStatus('Sessione non attiva. Configura AUTH_LOGIN_PATH.', true);
                return;
            }
            await this.bootstrapSessionAndRoute(this.appManager.consumeSessionPayload());
        } catch (error) {
            this.backendSessionReady = false;
            this.appManager.backendSessionReady = false;
            this.appManager.applyRuntime(this.api.getRuntimeConfig());
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async retryServerError(): Promise<void> {
        this.appManager.serverErrorRetryVisible = false;
        await this.initializeApplication();
    }

    private async bootstrapSessionAndRoute(preloadedSession?: unknown): Promise<void> {
        await this.appManager.loadSession(preloadedSession);
        this.builder.setBuilderEnabled(this.appManager.builderEnabled, false);
        await this.bootstrapAppData();
        await this.handleLocationRoute(true);
        this.backendSessionReady = true;
        this.appManager.backendSessionReady = true;
        this.redirectingToLogin = false;
        if (typeof window !== 'undefined' && !this.isPopStateRegistered) {
            window.addEventListener('popstate', this.onPopState);
            this.isPopStateRegistered = true;
        }
    }

    private async bootstrapAppData(): Promise<void> {
        const initialPath = typeof window !== 'undefined' ? this.normalizeActionUrl(window.location.pathname || '/') : '/';
        const shouldPreloadDashboard = !initialPath.startsWith('/action/');
        console.log('[bootstrap] isAdminUser=%s actionMenuIntegrated=%s', this.appManager.isAdminUser, this.appManager.actionMenuIntegrated);
        try {
            await this.loadActionLayout();
            console.log('[bootstrap] after layout: isAdminUser=%s actionMenuIntegrated=%s', this.appManager.isAdminUser, this.appManager.actionMenuIntegrated);
            if (this.appManager.isAdminUser && !this.appManager.actionMenuIntegrated) {
                await this.loadActionMenu();
            }
            if (shouldPreloadDashboard) await this.loadActionDashboard();
        } catch (err) {
            console.warn('[bootstrap] error, fallback to loadModels:', err);
            await this.loadModels();
        }
    }

    async loadActionLayout(name = ''): Promise<void> {
        this.setStatus('Caricamento layout...', false);
        try {
            const response = await this.api.getActionLayout(name);
            const obj = requireResponseObject(response);
            if (obj.fail) throw new Error(obj.message || 'Errore dal server');
            this.appManager.applyLayoutResponse(
                obj.content,
                d => this.normalizeActionMenuCards(d),
                s => this.cloneSchema(s),
                this.topMenuCards
            );
            if (this.appManager.isAdminUser && !this.appManager.actionMenuIntegrated) {
                await this.loadActionMenu();
            }
            this.setStatus(`Layout caricato: ${this.appManager.layoutName || 'default'}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    async loadActionMenu(parent = ''): Promise<void> {
        this.setStatus('Caricamento menu...', false);
        try {
            const response = await this.api.getActionMenu(parent);
            const obj = requireResponseObject(response);
            if (obj.fail) throw new Error(obj.message || 'Errore dal server');
            this.appManager.applyMenuResponse(
                obj.content,
                d => this.normalizeActionMenuCards(d),
                this.topMenuCards
            );
            this.setStatus(`Menu caricato: ${this.appManager.dashboardMenu.length} gruppi`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    async loadActionDashboard(parent = ''): Promise<void> {
        this.setStatus('Caricamento dashboard...', false);
        try {
            const response = await this.api.getActionDashboard(parent);
            const obj = requireResponseObject(response);
            if (obj.fail) throw new Error(obj.message || 'Errore dal server');
            this.appManager.applyDashboardResponse(
                obj.content,
                d => this.normalizeActionCards(d)
            );
            this.currentActionName = '';
            this.appManager.viewMode = 'dashboard';
            this.setStatus(`Dashboard caricata: ${this.appManager.dashboardCards.length} card`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    async loadModels(): Promise<void> {
        if (!this.appManager.backendSessionReady && this.appManager.authMode !== 'keycloak') {
            this.setStatus('Sessione Keycloak non attiva: usa Login prima di chiamare il server.', true);
            return;
        }
        this.setStatus('Caricamento modelli...', false);
        try {
            this.appManager.models = await this.api.getModels();
            if (!this.appManager.models.includes(this.appManager.selectedModel)) this.appManager.selectedModel = '';
            this.tableManager.resetSelectionAndTable();
            this.rebuildMenus();
            this.setStatus(`Modelli caricati: ${this.appManager.models.length}`, false);
        } catch (error) { this.setStatus(this.errorMessage(error), true); }
    }

    /** Populates the `data_model` select's model list without loadModels()'s side effects (selection/table reset). */
    private async ensureModelsListLoadedForFormEditor(): Promise<void> {
        try {
            this.appManager.models = await this.api.getModels();
        } catch { /* non-critical: data_model select just shows fewer options */ }
    }

    async loadSchema(): Promise<void> {
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) { this.setStatus('Seleziona un model', true); return; }
        this.renderer.selectedModel = selectedModel;
        this.tableManager.selectedModel = selectedModel;
        this.setStatus('Caricamento schema...', false);
        try {
            const payload = await this.api.getRecordSchema(selectedModel);
            const obj = requireResponseObject(payload);
            const schema = this.renderer.extractFormSchema(obj.content.schema);
            if (!schema) throw new Error(`Schema Formio non trovato per model "${selectedModel}"`);
            this.renderer.rawFormSchema = this.cloneSchema(schema);
            this.renderer.rawFormSchemaModel = selectedModel;
            this.tableManager.rawFormSchema = this.renderer.rawFormSchema;
            this.tableManager.rawFormSchemaModel = selectedModel;
            this.renderer.formSchema = null;
            this.renderer.formSubmission = null;
            this.resetContextActionState();
            this.currentFormSubmitActionPath = '';
            this.currentFormSubmitNextActionPath = '';
            this.renderer.beginFormViewerLoad();
            this.renderer.formSchema = this.renderer.prepareSchemaForRender(schema, null);
            await this.tableManager.refreshTableCellRenderers(this.tableManager.allRows);
            this.rebuildMenus();
            this.setStatus(`Schema caricato: ${selectedModel}`, false);
            this.renderer.scheduleRemoteSelectHydrationAfterRender(null);
        } catch (error) {
            this.renderer.cancelFormViewerLoad();
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async loadRecords(preservePaginatorState = false): Promise<void> {
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) return;
        if (this.tableManager.isLoadingRecords) {
            this.tableManager.requestReloadAfterCurrentLoad(preservePaginatorState);
            return;
        }
        this.tableManager.resetTableRowActionsConfig();
        this.setStatus('Caricamento record (stream)...', false);
        const onItem = (item: unknown) => { this.tableManager.streamCount += 1; this.tableManager.appendRecordRow(item); };
        const onMeta = (meta: { columnsRaw?: unknown; columns?: unknown }) => {
            this.tableManager.setLastColumnsRaw(String(meta.columnsRaw ?? ''));
            this.tableManager.applyTableColumnsFromHeader(meta.columns);
        };

        if (this.tableManager.fastSearchActive) {
            const fsPayload = this.tableManager.buildFastSearchPayload();
            const querySignature = this.tableManager.stableStringify({ fastSearch: this.tableManager.fastSearchActionName, ...fsPayload });
            this.tableManager.prepareLoadRecords(preservePaginatorState, querySignature, { preserveColumns: true });
            try {
                const result = await this.api.filterFastSearch(this.tableManager.fastSearchActionName, fsPayload, onItem, onMeta);
                this.tableManager.finishLoadRecords(querySignature, result);
                await this.tableManager.refreshTableCellRenderers(this.tableManager.allRows);
                this.rebuildMenus();
                this.setStatus(`Record caricati: ${result.count} / Totale: ${result.totalCount} (limit ${this.tableManager.limit})`, false);
            } catch (error) {
                this.setStatus(this.errorMessage(error), true);
            } finally {
                this.tableManager.isLoadingRecords = false;
                if (this.tableManager.hasPendingReloadRequest()) void this.loadRecords(this.tableManager.consumePendingReloadRequest());
            }
            return;
        }

        if (await this.reloadCurrentActionList(preservePaginatorState)) return;

        const query = this.tableManager.parseQueryInput((m, e) => this.setStatus(m, e));
        if (!query) return;
        const payload = this.tableManager.buildListPayload();
        payload.query = query;
        const querySignature = this.tableManager.stableStringify({ model: selectedModel, query, order: this.tableManager.order, limit: this.tableManager.limit });
        this.tableManager.prepareLoadRecords(preservePaginatorState, querySignature);
        try {
            const streamed = await this.api.streamList(selectedModel, payload, onItem, onMeta);
            this.tableManager.finishLoadRecords(querySignature, streamed.result);
            await this.tableManager.refreshTableCellRenderers(this.tableManager.allRows);
            this.rebuildMenus();
            this.setStatus(`Record caricati: ${streamed.result.count} / Totale: ${streamed.result.totalCount} (limit ${this.tableManager.limit})`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        } finally {
            this.tableManager.isLoadingRecords = false;
            if (this.tableManager.hasPendingReloadRequest()) void this.loadRecords(this.tableManager.consumePendingReloadRequest());
        }
    }

    beginExternalTransition(): void {
        this.transitionLoadingCount += 1;
        this.isTransitionLoading = true;
    }

    endExternalTransition(): void {
        this.transitionLoadingCount = Math.max(0, this.transitionLoadingCount - 1);
        this.isTransitionLoading = this.transitionLoadingCount > 0;
    }

    private async reloadCurrentActionList(preservePaginatorState: boolean): Promise<boolean> {
        const actionName = this.readFirstString(this.currentActionName);
        if (!actionName || this.appManager.viewMode !== 'list') return false;
        const pageContextId = this.pageContextId;
        const query = this.tableManager.parseQueryInput((m, e) => this.setStatus(m, e));
        if (!query) return true;
        const querySignature = this.tableManager.stableStringify({ action: actionName, query, order: this.tableManager.order, limit: this.tableManager.limit });
        this.tableManager.prepareLoadRecords(preservePaginatorState, querySignature, { preserveColumns: true });
        try {
            const payload = await this.api.getAction(actionName, {
                query,
                order: this.tableManager.order,
                skip: this.tableManager.skip,
                limit: this.tableManager.limit
            });
            if (!this.isCurrentPageContext(pageContextId)) return true;
            const obj = requireResponseObject(payload);
            if (obj.fail) throw new Error(obj.message || 'Errore dal server');
            const mode = obj.content.mode.trim().toLowerCase();
            if (mode !== 'list') {
                await this.applyActionResponse(payload, pageContextId);
                return true;
            }
            await this.applyActionListResponse(obj.content, pageContextId, { preserveTableStructure: true });
            if (!this.isCurrentPageContext(pageContextId)) return true;
            this.tableManager.finishLoadRecords(querySignature, {
                count: this.tableManager.tableRows.length,
                totalCount: this.tableManager.tableTotalRecords,
                skip: String(this.tableManager.skip),
                limit: String(this.tableManager.limit)
            });
            this.rebuildMenus();
            this.setStatus(`Record caricati: ${this.tableManager.tableRows.length} / Totale: ${this.tableManager.tableTotalRecords} (limit ${this.tableManager.limit})`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        } finally {
            this.tableManager.isLoadingRecords = false;
            if (this.tableManager.hasPendingReloadRequest()) void this.loadRecords(this.tableManager.consumePendingReloadRequest());
        }
        return true;
    }

    async openSelectedRecord(): Promise<void> {
        const pageContextId = this.pageContextId;
        const selectedModel = this.appManager.selectedModel;
        const selectedRecordName = this.tableManager.selectedRecordName;
        if (!selectedModel || !selectedRecordName) return;
        this.renderer.selectedModel = selectedModel;
        this.tableManager.selectedModel = selectedModel;
        this.setStatus(`Caricamento record "${selectedRecordName}"...`, false);
        try {
            const payload = await this.api.getRecord(selectedModel, selectedRecordName);
            if (!this.isCurrentPageContext(pageContextId)) return;
            const recordObj = requireResponseObject(payload);
            const canReuseCachedSchema = Boolean(this.renderer.rawFormSchema) && (!this.renderer.rawFormSchemaModel || this.renderer.rawFormSchemaModel === selectedModel);
            let schema = this.renderer.extractFormSchema(recordObj.content.schema) || (canReuseCachedSchema && this.renderer.rawFormSchema ? this.cloneSchema(this.renderer.rawFormSchema) : null);
            if (!schema) {
                const schemaPayload = await this.api.getRecordSchema(selectedModel);
                if (!this.isCurrentPageContext(pageContextId)) return;
                const schemaObj = requireResponseObject(schemaPayload);
                schema = this.renderer.extractFormSchema(schemaObj.content.schema);
                if (schema) { this.renderer.rawFormSchema = this.cloneSchema(schema); this.renderer.rawFormSchemaModel = selectedModel; }
            }
            if (!schema) throw new Error('Schema non trovato');
            this.renderer.rawFormSchema = this.cloneSchema(schema as Record<string, unknown>);
            this.renderer.rawFormSchemaModel = selectedModel;
            const submission = this.renderer.extractSubmission(payload);
            if (!submission) throw new Error(`Record "${selectedRecordName}" non valido`);
            this.renderer.formSchema = null;
            this.renderer.formSubmission = null;
            this.resetContextActionState();
            this.currentFormSubmitActionPath = '';
            this.currentFormSubmitNextActionPath = '';
            const submissionData = this.isRecord(submission.data) ? submission.data : null;
            this.renderer.beginFormViewerLoad();
            this.renderer.formSchema = this.renderer.prepareSchemaForRender(schema as Record<string, unknown>, submissionData);
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.renderer.seedSubmissionDefaultsIntoSchema(this.renderer.formSchema, submission.data);
            this.renderer.formSubmission = submission;
            this.appManager.viewMode = 'form';
            this.builder.syncDirectRecordBuilderMode(selectedModel, submissionData, this.renderer.formSchema);
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.rebuildMenus();
            this.setStatus(`Record caricato: ${selectedRecordName}`, false);
            this.renderer.scheduleRemoteSelectHydrationAfterRender(submissionData);
            this.builder.warmFormBuilderConfig();
        } catch (error) {
            this.renderer.cancelFormViewerLoad();
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async openRecordFromListSelection(): Promise<void> {
        const recName = String(this.tableManager.selectedRecordName ?? '').trim();
        if (!recName) return;
        await this.withClickTransition(async () => {
            const currentAction = this.resolveCurrentActionName();
            if (!currentAction) { await this.openSelectedRecord(); return; }
            await this.runNextActionRoute([currentAction, recName]);
        });
    }

    /** Explicit-args variant for tables that aren't backed by this service's own `tableManager`
     * (e.g. ozon_data_table's embedded list, which has its own component-scoped table manager) -
     * takes the action and record name directly instead of reading shared selection state, so it
     * can't accidentally open whatever the main list last had selected. */
    async openRecordByAction(actionName: string, recName: string): Promise<void> {
        const action = String(actionName ?? '').trim();
        const rec = String(recName ?? '').trim();
        if (!action || !rec) return;
        await this.withClickTransition(async () => { await this.runNextActionRoute([action, rec]); });
    }

    /** Read-only counterpart to applyActionFormResponse (line ~2256) for callers that need a
     * record's schema/submission/submit-action without taking over the app's shared viewMode,
     * selectedModel, breadcrumbs, etc. - used by ozon_data_table's modal-open mode, which renders
     * a record form on top of the current page rather than navigating away from it.
     *
     * getNextAction's response is usually mode:"redirect" (e.g. {next_page:
     * "/action/form_form_group_users/<rec_name>"}), same as row-click navigation elsewhere in this
     * app (runNextActionRoute/runActionRoute both follow that redirect via handleRedirectResponseTarget
     * -> a full page navigation). Here there's no page navigation to piggyback on, so the redirect
     * target is fetched directly as a second /action/{name}/{recName} call instead. */
    async loadRecordForModal(actionName: string, recName: string): Promise<{
        schema: Record<string, unknown>; submission: { data: Record<string, unknown> }; submitActionPath: string; model: string; title: string;
    } | null> {
        const action = String(actionName ?? '').trim();
        const rec = String(recName ?? '').trim();
        if (!action || !rec) return null;
        let response = await this.api.getNextAction(action, rec);
        let { content, fail, message } = requireResponseObject(response);
        if (fail) throw new Error(message || 'Errore dal server');
        if (content.mode.trim().toLowerCase() === 'redirect') {
            const redirectUrl = this.resolveRedirectUrl(content);
            const route = redirectUrl ? this.parseActionRoute(redirectUrl) : null;
            if (!route) throw new Error(`Redirect non risolvibile: ${redirectUrl || '(vuoto)'}`);
            response = await this.api.getAction(route.name, { recName: route.recName, query: {}, order: '', skip: 0, limit: 1 });
            ({ content, fail, message } = requireResponseObject(response));
            if (fail) throw new Error(message || 'Errore dal server');
        }
        const data = this.isRecord(content.data) ? content.data : {};
        const model = this.resolveModelName(content, action);
        if (!model) throw new Error('Model non trovato nella risposta');
        let schema = this.renderer.extractFormSchema(content.schema);
        if (!schema) {
            const schemaPayload = await this.api.getRecordSchema(model);
            const schemaObj = requireResponseObject(schemaPayload);
            schema = this.renderer.extractFormSchema(schemaObj.content.schema);
        }
        if (!schema) throw new Error(`Schema non trovato per "${model}"`);
        const normalizedData = this.renderer.normalizeFormSubmissionData(data, schema);
        const renderSchema = this.renderer.prepareSchemaForRender(this.cloneSchema(schema), normalizedData);
        this.renderer.seedSubmissionDefaultsIntoSchema(renderSchema, normalizedData);
        const submitActionPath = this.resolveSubmitActionFromFields(content.fields);
        const title = this.readFirstString(content.title, model);
        return { schema: renderSchema, submission: { data: normalizedData }, submitActionPath, model, title };
    }

    /** Read-only-state counterpart to saveCurrentRecord (line ~756): posts to the resolved
     * submit action (or falls back to a plain record update), reporting success/failure without
     * touching shared viewMode/selectedModel/tableManager state. */
    async saveRecordForModal(
        model: string, recName: string, submitActionPath: string, payload: Record<string, unknown>
    ): Promise<{ success: boolean; message: string }> {
        try {
            if (submitActionPath && submitActionPath.startsWith('/action/')) {
                const response = await this.api.postActionPath(submitActionPath, payload);
                const obj = requireResponseObject(response);
                if (obj.fail) return { success: false, message: obj.message || 'Errore dal server' };
                return { success: true, message: obj.message || 'Record salvato' };
            }
            const rec = String(recName ?? '').trim() || String(payload['rec_name'] ?? '').trim();
            if (!rec) return { success: false, message: 'rec_name mancante: impossibile salvare' };
            await this.api.updateRecord(model, rec, payload);
            return { success: true, message: `Record salvato: ${rec}` };
        } catch (error) {
            return { success: false, message: this.errorMessage(error) };
        }
    }

    async openNewRecord(): Promise<void> {
        const currentAction = this.resolveCurrentActionName();
        if (!currentAction) { this.setStatus('Azione corrente non disponibile per Nuovo record', true); return; }
        await this.withClickTransition(async () => { await this.runNextActionRoute([currentAction]); });
    }

    onModelChanged(): void {
        this.beginPageContext();
        this.tableManager.onModelChanged();
        this.renderer.resetFormState();
        this.builder.resetBuilderState();
        this.resetContextActionState();
        this.currentFormSubmitActionPath = '';
        this.currentFormSubmitNextActionPath = '';
    }

    async saveConnectionSettings(backendUrl: string): Promise<void> {
        const updated = this.api.updateRuntimeConfig({ backendUrl, useProxy: true });
        this.appManager.applyRuntime(updated);
        this.setStatus('Configurazione aggiornata', false);
        await this.loadModels();
    }

    login(): void {
        this.appManager.userMenuOpen = false;
        this.setStatus('Reindirizzamento al login Keycloak...', false);
        const result = this.mainManager.hardReloadToUrl(this.appManager.getLoginUrl());
        if (result.reloaded) return;
        if (result.blocked) { this.setStatus(`Login bloccato verso origine non consentita: ${result.targetUrl}`, true); return; }
        this.setStatus('Endpoint login non valido', true);
    }

    logout(): void {
        this.appManager.userMenuOpen = false;
        const logoutResult = this.appManager.logout();
        this.appManager.applyRuntime(this.api.getRuntimeConfig());
        this.resetClientState('Sessione chiusa, reindirizzamento logout...');
        const navigation = this.mainManager.hardReloadToUrl(logoutResult.redirectUrl);
        if (navigation.reloaded) return;
        if (navigation.blocked) { this.setStatus(`Logout bloccato verso origine non consentita: ${navigation.targetUrl}`, true); return; }
        this.setStatus('Sessione chiusa', false);
    }

    resetClientState(statusMessage: string): void {
        this.beginPageContext();
        this.appManager.resetClientState(statusMessage);
        this.tableManager.resetSelectionAndTable();
        this.tableManager.resetTableRowActionsConfig();
        this.renderer.resetFormState();
        this.builder.resetBuilderState(true);
        this.tableManager.selectedModel = '';
        this.tableManager.selectedRecordName = '';
        this.tableManager.rawFormSchema = null;
        this.tableManager.rawFormSchemaModel = '';
        this.renderer.selectedModel = '';
        this.renderer.selectedRecordName = '';
        this.resetContextActionState();
        this.currentFormSubmitActionPath = '';
        this.currentFormSubmitNextActionPath = '';
        this.currentActionName = '';
        this.backendSessionReady = false;
        if (typeof window !== 'undefined') window.history.replaceState({}, '', '/dashboard');
    }

    async navigateToFormEditor(): Promise<void> {
        const model = this.renderer.rawFormSchemaModel || this.appManager.selectedModel || this.currentActionName;
        if (!model) { this.setStatus('Nome form non determinabile per apertura editor', true); return; }
        await this.withClickTransition(async () => {
            await this.navigateToPath(`/action/form_form/${encodeURIComponent(model)}`, true);
        });
    }

    async runTopMenuAction(button: MenuButton): Promise<void> {
        await this.withClickTransition(async () => {
            await this.runMenuAction(button);
            this.appManager.closeTopMenu();
        });
    }

    async downloadAttachment(fileUrl: string, filename = ''): Promise<void> {
        if (!fileUrl) return;
        this.setStatus(`Download "${filename || 'file'}"...`, false);
        try {
            await this.api.downloadAttachment(fileUrl, filename);
            this.setStatus(`Scaricato: ${filename || 'file'}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async onFormCustomEvent(event: unknown): Promise<void> {
        const button = this.toInlineActionButton(event);
        if (!button) return;
        if (button.modal) {
            this.pendingModalButton = button;
            this.confirmModalConfig = button.modal;
            this.confirmModalVisible = true;
            return;
        }
        await this.runTopMenuAction(button);
    }

    async onFastActionCustomEvent(event: unknown): Promise<void> {
        const request = this.toFastActionRequest(event);
        if (!request) return;
        const { button, component, properties } = request;
        if (button.modal) {
            const selectedRecNames = this.tableManager.selectedRows
                .map(row => String(row.__rec_name ?? '').trim())
                .filter(Boolean);
            if (!selectedRecNames.length) {
                this.setStatus('Seleziona almeno una riga', true);
                return;
            }
            this.pendingFastAction = {
                button,
                actionPath: button.url_action,
                payload: this.buildFastActionPayload(component, properties, selectedRecNames),
                selectedRecNames,
                component,
                properties
            };
            this.confirmModalConfig = button.modal;
            this.confirmModalVisible = true;
            return;
        }
        await this.runFastAction(request);
    }

    async confirmPendingModalAction(): Promise<void> {
        if (this.pendingFastAction) {
            const pending = this.pendingFastAction;
            this.confirmModalVisible = false;
            this.confirmModalConfig = null;
            this.pendingFastAction = null;
            await this.executeFastAction(pending);
            return;
        }
        const button = this.pendingModalButton;
        this.confirmModalVisible = false;
        this.confirmModalConfig = null;
        this.pendingModalButton = null;
        if (!button) return;
        await this.runTopMenuAction(button);
    }

    cancelPendingModalAction(): void {
        this.confirmModalVisible = false;
        this.confirmModalConfig = null;
        this.pendingModalButton = null;
        this.pendingFastAction = null;
    }

    async resetNavigation(): Promise<void> {
        await this.withClickTransition(async () => {
            this.appManager.closeTopMenu();
            this.appManager.userMenuOpen = false;
            await this.navigateToPath('/dashboard', true);
        });
    }

    menuActionHref(button: MenuButton): string {
        if (!button || !this.canRunMenuAction(button)) return '#';
        const actionPath = this.getButtonActionPath(button);
        if (actionPath.startsWith('/action/')) return actionPath;
        if (actionPath === '/dashboard') return '/dashboard';
        return '#';
    }

    async onMenuActionAnchorClick(button: MenuButton, event: MouseEvent): Promise<void> {
        if (this.shouldLetBrowserHandle(event)) return;
        event.preventDefault();
        if (!this.canRunMenuAction(button)) return;
        await this.withClickTransition(async () => {
            this.clearFastSearchCacheForMenuAction(button);
            await this.runMenuAction(button);
        });
    }

    canRunMenuAction(button: MenuButton): boolean {
        if (!button) return false;
        if (this.isMenuContainerButton(button)) return false;
        if (button.is_admin && !this.builder.builderEnabled) return false;
        if (this.isBuilderAction(button) && !this.builder.builderEnabled) return false;
        const actionPath = this.getButtonActionPath(button);
        if (this.isPostActionButton(button)) return Boolean(this.renderer.formDataReady && this.renderer.formSubmission?.data);
        if (actionPath.startsWith('/action/')) return true;
        if (button.action_type === 'save') return Boolean(this.renderer.formDataReady && this.appManager.selectedModel && this.renderer.formSubmission?.data);
        if (button.action_type === 'copy' || button.action_type === 'delete') return Boolean(this.getActiveRecName());
        if (button.action_type === 'window' && String(button.mode || '') === 'form') return Boolean(this.appManager.selectedModel);
        return true;
    }

    async runMenuAction(button: MenuButton): Promise<void> {
        if (!button) return;
        if (this.isMenuContainerButton(button)) return;
        if (!this.canRunMenuAction(button)) { this.setStatus(`Azione non disponibile: ${button.label}`, true); return; }
        this.builder.syncBuilderSchemaFromLiveInstance(this._activeBuilderHost);
        if (this.builder.builderSchemaDraft) this.builder.applyBuilderDraftToSubmission();
        const actionPath = this.getButtonActionPath(button);
        if (this.isAbandonFormButton(button)) { await this.runAbandonAction(); return; }
        if (button.action_type === 'window') { await this.runWindowAction(button); return; }
        if (button.action_type === 'cancel_button') { await this.navigateToPath(actionPath || '/dashboard'); return; }
        if (this.isPostActionButton(button)) { await this.runPostActionButton(button); return; }
        if (button.action_type === 'save') { await this.saveCurrentRecord(this._activeBuilderHost, this._formioViewerGetter?.()); return; }
        if (button.action_type === 'copy') { await this.copyCurrentRecordName(); return; }
        if (button.action_type === 'delete') { this.tableManager.removeCurrentRecordFromView(() => this.rebuildMenus(), (m, e) => this.setStatus(m, e)); return; }
        if (actionPath.startsWith('/action/')) { await this.navigateToPath(actionPath); return; }
        this.setStatus(`Azione non supportata: ${button.action_type}`, true);
    }

    private async runAbandonAction(): Promise<void> {
        const targetPath = this.resolveCurrentFormAbandonTargetPath();
        if (targetPath) {
            await this.navigateToPath(targetPath, true);
            return;
        }
        if (typeof window !== 'undefined' && window.history.length > 1) {
            window.history.back();
            return;
        }
        await this.navigateToPath('/dashboard', true);
    }

    async saveCurrentRecord(activeBuilderHost?: OzonFormBuilderHostComponent, formioViewer?: FormioComponent): Promise<void> {
        const pageContextId = this.pageContextId;
        this.builder.syncBuilderSchemaFromLiveInstance(activeBuilderHost ?? this._activeBuilderHost);
        if (this.builder.builderSchemaDraft) this.builder.applyBuilderDraftToSubmission();
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) { this.setStatus('Seleziona un model prima di salvare', true); return; }
        const payload = this.renderer.normalizeCurrentSubmissionData();
        if (!payload || !this.isRecord(payload)) { this.setStatus('Nessun dato form disponibile da salvare', true); return; }
        if (!this.validateFormioSubmissionForSave(formioViewer, payload)) return;
        const recName = this.getActiveRecName() || String(payload['rec_name'] ?? '').trim();
        if (!recName) { this.setStatus('rec_name mancante: impossibile salvare', true); return; }
        this.setStatus(`Salvataggio record "${recName}"...`, false);
        try {
            if (this.currentFormSubmitActionPath.startsWith('/action/')) {
                const response = await this.api.postActionPath(this.currentFormSubmitActionPath, payload);
                await this.applyInvokedActionResponse(response, this.currentFormSubmitNextActionPath, pageContextId);
                return;
            }
            const response = await this.api.updateRecord(selectedModel, recName, payload);
            await this.applyRecordWriteTail(response, recName, `Record salvato: ${recName}`);
        } catch (error) { this.setStatus(this.errorMessage(error), true); }
    }

    /**
     * Coda condivisa di una scrittura andata a buon fine sul record corrente:
     * rinfresca la submission dalla risposta, riallinea i menu, poi risolve la
     * destinazione successiva — `currentFormSubmitNextActionPath` se il form ne
     * dichiara una, altrimenti la next_action dell'action corrente.
     *
     * La usano sia il salvataggio normale sia il completamento di uno step
     * supervisionato (`POST /step/{model}/{name}`): lo step scrive il record
     * passando da `Service.upsert` esattamente come il salvataggio, quindi deve
     * finire dove finisce il salvataggio. Prima lo step cadeva in
     * `applyInvokedActionResponse` -> `applyActionResponse` (mode="form") e si
     * limitava a ri-renderizzare il form.
     */
    private async applyRecordWriteTail(response: unknown, recName: string, statusMessage: string): Promise<void> {
        try {
            const submission = this.renderer.extractSubmission(response);
            if (submission) this.renderer.formSubmission = submission;
        } catch { /* schema may not be in update response, keep existing submission */ }
        this.tableManager.selectedRecordName = recName;
        this.rebuildMenus();
        this.appManager.clearFormNotifications();
        this.setStatus(statusMessage, false);
        if (this.builder.formEditorDesignContext && this.currentFormOriginPath) {
            await this.navigateToPath(this.currentFormOriginPath, true);
            return;
        }
        if (this.currentFormSubmitNextActionPath) { await this.navigateToPath(this.currentFormSubmitNextActionPath, true); return; }
        if (!this.builder.formEditorDesignContext) {
            const actionName = this.resolveCurrentActionName();
            if (actionName) await this.runNextActionRoute([actionName, recName]);
        }
    }

    async onCopyRow(row: { __rec_name: unknown; __rowid: unknown }, event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.tableManager.showTableRowCopyAction) { this.setStatus('Azione copia non disponibile per questa tabella', true); return; }
        const recName = String(row.__rec_name ?? '').trim();
        if (!recName) { this.setStatus('Record non valido: impossibile copiare', true); return; }
        if (await this.executeTableRowServerAction(this.tableManager.tableCopyActionPath, row as Record<string, unknown>, 'copia')) return;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(recName); this.setStatus(`Record copiato: ${recName}`, false); }
            catch { this.setStatus(`Errore clipboard. Record: ${recName}`, true); }
        } else { this.setStatus(`Clipboard non disponibile. Record: ${recName}`, false); }
    }

    async onRemoveRow(row: { __rec_name: unknown; __rowid: unknown }, event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.tableManager.showTableRowRemoveAction) { this.setStatus('Azione rimuovi non disponibile per questa tabella', true); return; }
        if (await this.executeTableRowServerAction(this.tableManager.tableRemoveActionPath, row as Record<string, unknown>, 'rimozione')) return;
        const rowId = Number(row.__rowid);
        if (!Number.isFinite(rowId)) return;
        this.tableManager.removeRowFromView(rowId, String(row.__rec_name ?? ''), () => this.rebuildMenus(), (m, e) => this.setStatus(m, e));
    }

    private async executeTableRowServerAction(rawActionPath: string, row: Record<string, unknown>, actionLabel: string): Promise<boolean> {
        const recName = String(row['__rec_name'] ?? '').trim();
        if (!recName) return false;
        const actionPath = this.tableManager.resolveTableRowActionPath(rawActionPath, recName, u => this.normalizeActionUrl(u), c => this.normalizeNextActionRedirectCandidate(c));
        if (!actionPath) return false;
        this.setStatus(`Eseguo ${actionLabel} record "${recName}"...`, false);
        try { await this.runPathAction(actionPath); return true; }
        catch (error) { this.setStatus(this.errorMessage(error), true); return true; }
    }

    private async runPathAction(path: string): Promise<void> {
        const normalized = this.normalizeNextActionRedirectCandidate(path);
        if (!normalized) throw new Error(`Azione non valida: ${path}`);
        if (normalized === '/dashboard' || normalized.startsWith('/action/')) { await this.navigateToPath(normalized); return; }
        await this.runWindowPath(normalized);
    }

    private validateFormioSubmissionForSave(formioViewer: FormioComponent | undefined, payload: Record<string, unknown>): boolean {
        if (!formioViewer?.formio || this.builder.formEditorDesignContext) return true;
        const formio = formioViewer.formio;
        const validationErrors = typeof formio.validate === 'function'
            ? formio.validate(payload, { dirty: true, silentCheck: false, process: 'submit' })
            : null;
        const isValid = Array.isArray(validationErrors)
            ? validationErrors.length === 0
            : formio.checkValidity(payload, true, null);
        if (!isValid) {
            const notification = this.buildFormValidationNotification(
                Array.isArray(validationErrors) ? validationErrors : null,
                formio
            );
            this.appManager.setFormNotifications([notification]);
            this.setStatus('Compila i campi obbligatori prima di salvare', true);
            this.navigateToFirstInvalidTab(formio);
            return false;
        }
        return true;
    }

    private buildFormValidationNotification(rawErrors: unknown[] | null, formio: any): FormNotification {
        const messages: string[] = [];
        const seen = new Set<string>();

        const addError = (err: unknown) => {
            if (!err || typeof err !== 'object') return;
            const e = err as Record<string, unknown>;
            const ctx = e['context'] as Record<string, unknown> | undefined;
            const comp = e['component'] as Record<string, unknown> | undefined;
            const label = String(ctx?.['label'] ?? comp?.['label'] ?? e['label'] ?? '').trim();
            const msg = String(e['message'] ?? '').trim();
            if (!msg) return;
            const line = label ? `${label}: ${msg}` : msg;
            if (!seen.has(line)) { seen.add(line); messages.push(line); }
        };

        const errors: unknown[] = rawErrors ?? (formio?.errors ?? []);
        errors.forEach(addError);

        if (!messages.length) messages.push('Alcuni campi obbligatori non sono compilati correttamente');

        return { type: 'error', title: 'Compila i campi obbligatori prima di salvare', messages };
    }

    private navigateToFirstInvalidTab(formio: any): void {
        if (!formio) return;
        // wizard: navigate to first page with errors
        if (formio.display === 'wizard' && typeof formio.setPage === 'function') {
            const pages: any[] = formio.components ?? [];
            for (let i = 0; i < pages.length; i++) {
                if (this.componentHasInvalidDescendant(pages[i])) { try { formio.setPage(i); } catch { /* ignore */ } return; }
            }
            return;
        }
        this.navigateTabsToFirstError(formio.components ?? []);
    }

    private navigateTabsToFirstError(components: any[]): boolean {
        for (const comp of components ?? []) {
            if (comp.type === 'tabs') {
                const panels: any[] = comp.components ?? [];
                for (let i = 0; i < panels.length; i++) {
                    if (this.componentHasInvalidDescendant(panels[i])) { try { comp.setTab(i); } catch { /* ignore */ } return true; }
                }
            } else if (comp.components?.length && this.navigateTabsToFirstError(comp.components)) { return true; }
        }
        return false;
    }

    private componentHasInvalidDescendant(comp: any): boolean {
        if (!comp) return false;
        if (comp.error) return true;
        for (const child of comp.components ?? []) { if (this.componentHasInvalidDescendant(child)) return true; }
        return false;
    }

    get topMenuCards(): MenuCard[] {
        return this.appManager.dashboardMenu
            .filter(card => this.builder.builderEnabled || !this.isAdminMenuCard(card))
            .filter(card => this.menuDrilldownGroups(card).length > 0);
    }

    get showTopMenu(): boolean { return this.builder.builderEnabled; }
    get showHomeButton(): boolean { return this.appManager.backendSessionReady; }
    get showLoginButton(): boolean { return !this.appManager.backendSessionReady; }
    get showLogoutButton(): boolean { return this.appManager.backendSessionReady; }

    get nonAdminDashboardCards(): MenuCard[] {
        return this.appManager.dashboardCards.filter(card => !this.isAdminMenuCard(card));
    }

    get selectedTopMenuCard(): MenuCard | null {
        if (!this.topMenuCards.length) return null;
        const selected = this.topMenuCards.find(card => card.group_id === this.appManager.activeDashboardGroup);
        return selected ?? this.topMenuCards[0];
    }

    get dashboardTitle(): string {
        if (this.currentFormPageTitle) return this.currentFormPageTitle;
        const selected = this.selectedTopMenuCard;
        return selected ? selected.title : (this.appManager.layoutName || 'Dashboard');
    }

    get selectedInfo(): string {
        return this.tableManager.selectedRecordName ? `Record selezionato: ${this.tableManager.selectedRecordName}` : 'Nessun record selezionato';
    }

    get canOpenRecord(): boolean { return Boolean(this.appManager.selectedModel && this.tableManager.selectedRecordName); }
    get canOpenNewRecord(): boolean { return Boolean(this.resolveCurrentActionName()); }
    get showListActionButtonsFallback(): boolean { return !this.hasContextActionsPayload; }

    get showFormViewerActionButtons(): boolean {
        return this.appManager.viewMode === 'form' && !this.builder.isFormEditorPage && !this.builder.formEditorDesignContext;
    }

    get canEditCurrentForm(): boolean { return this.builder.canEditCurrentForm && this.appManager.viewMode === 'form'; }

    get viewerFormSubmission(): { data: Record<string, unknown> } | null {
        return this.builder.formPreviewSubmission ?? this.renderer.formSubmission;
    }

    get currentFormActionButtons(): MenuButton[] {
        // Prefer payload context buttons for form mode when present.
        const formCtx = this.formContextActions;
        if (formCtx.length) {
            return this.finalizeFormContextActionButtons(formCtx);
        }
        const responseButtons = this.ensureCopyFormActionButton(this.formResponseActionButtons);
        return this.finalizeCurrentFormActionButtons(this.mergeFormResponseButtonsWithFallback(responseButtons));
    }

    get listContextActions(): ContextAction[] {
        return this.contextActions.filter(a => {
            const modes = a.context_button_mode;
            return modes.includes('list');
        });
    }

    get formContextActions(): ContextAction[] {
        return this.contextActions.filter(a => {
            const modes = a.context_button_mode;
            return modes.includes('form');
        });
    }

    get formEditorActionButtons(): MenuButton[] { return this.sanitizeFormEditorActionButtons(this.currentFormActionButtons); }

    get formEditorSaveLabel(): string { return this.tableManager.selectedRecordName ? 'Aggiorna' : 'Salva'; }

    menuDrilldownGroups(card: MenuCard): MenuDrillDownGroup[] {
        if (!card || !Array.isArray(card.buttons) || !card.buttons.length) return [];
        const groups = new Map<string, MenuDrillDownGroup>();
        card.buttons.forEach((button, index) => {
            if (!this.isVisibleMenuButton(button)) return;
            const groupId = this.readFirstString(button.menu_group, card.group_id, `group_${index}`);
            if (!groupId) return;
            const existing = groups.get(groupId);
            if (!existing) {
                groups.set(groupId, {
                    group_id: groupId,
                    title: this.readFirstString(groupId === card.group_id ? card.title : '', button.menu_group, this.humanizeModelLabel(groupId), groupId),
                    buttons: [button]
                });
                return;
            }
            existing.buttons.push(button);
        });
        return [...groups.values()];
    }

    resolveButtonIconClass(button: MenuButton): string {
        const icon = this.readFirstString(button?.leftIcon);
        if (!icon) return 'pi pi-circle';
        if (icon.includes(' ')) return icon;
        if (icon.startsWith('pi-')) return `pi ${icon}`;
        return icon;
    }

    resolveBootstrapItaliaIconSrc(button: MenuButton): string {
        const rawIcon = this.readFirstString(button?.leftIcon);
        if (!rawIcon) return '';
        const iconId = this.extractBootstrapItaliaIconId(rawIcon);
        return iconId ? `bootstrap-italia/src/svg/${iconId}.svg` : '';
    }

    resolveBootstrapItaliaIconHref(button: MenuButton): string {
        const rawIcon = this.readFirstString(button?.leftIcon);
        if (!rawIcon) return '';
        const explicitSpriteRef = rawIcon.match(/^(.*?\.svg)#(it-[a-z0-9-]+)$/i);
        if (explicitSpriteRef) return `${explicitSpriteRef[1]}#${explicitSpriteRef[2].toLowerCase()}`;
        const iconId = this.extractBootstrapItaliaIconId(rawIcon);
        return iconId ? `bootstrap-italia/dist/svg/sprites.svg#${iconId}` : '';
    }

    private extractBootstrapItaliaIconId(rawIcon: string): string {
        const normalized = String(rawIcon || '').trim();
        if (!normalized) return '';
        if (normalized.startsWith('#it-')) return normalized.slice(1).toLowerCase();
        if (normalized.startsWith('it-')) return normalized.toLowerCase();
        const tokens = normalized.split(/\s+/).map(t => t.trim()).filter(Boolean);
        const tokenMatch = tokens.find(t => t.startsWith('it-'));
        if (tokenMatch) return tokenMatch.toLowerCase();
        const plain = normalized.replace(/^#/, '').trim().toLowerCase().replace(/_/g, '-');
        const likelyClassPrefix = /^(pi|fa|fas|far|fab|bi|mdi|ph|ti|ri)-/;
        const prefixMatch = plain.match(likelyClassPrefix);
        if (prefixMatch) {
            // Icon-font classes (Font Awesome / PrimeIcons / ...) have no font loaded in this
            // app anymore; map the handful of names we actually use onto Bootstrap Italia's SVG set.
            const name = plain.slice(prefixMatch[0].length);
            const mapped = ICON_FONT_TO_BOOTSTRAP_ITALIA[name];
            return mapped ? `it-${mapped}` : '';
        }
        if (!plain.includes(' ') && /^[a-z0-9-]+$/.test(plain)) {
            return plain.startsWith('it-') ? plain : `it-${plain}`;
        }
        return '';
    }

    private _activeBuilderHost?: OzonFormBuilderHostComponent;
    private _formioViewerGetter?: () => FormioComponent | undefined;

    setActiveBuilderHost(host?: OzonFormBuilderHostComponent): void {
        this._activeBuilderHost = host;
    }

    setFormioViewerGetter(fn: () => FormioComponent | undefined): void {
        this._formioViewerGetter = fn;
    }

    rebuildMenus(): void {
        if (this.appManager.actionRouterActive) {
            this.appManager.contextualActions = [];
            this.appManager.syncActiveDashboardGroup(this.topMenuCards);
            return;
        }
        this.appManager.dashboardMenu = this.makeMainMenu();
        this.appManager.dashboardCards = this.makeMainMenu();
        this.appManager.contextualActions = this.makeActionButtons(this.makeContextualActions(), this.getActiveRecName());
        this.appManager.syncActiveDashboardGroup(this.topMenuCards);
    }

    private makeMainMenu(): MenuCard[] { return this.makeDashboardMenu(); }

    private getBasicMenuList(): Array<{ model: string; menu_group: string; label: string }> {
        return this.appManager.models.map(model => ({ model, menu_group: model, label: this.humanizeModelLabel(model) }));
    }

    private makeDashboardMenu(): MenuCard[] {
        return this.getBasicMenuList().map(card => this.makeMenuItem(card));
    }

    private makeMenuItem(card: { model: string; menu_group: string; label: string }): MenuCard {
        const actions: MenuActionDescriptor[] = [
            { model: card.model, rec_name: card.model, title: 'Schema', action_type: 'window', action_root_path: '/record', button_icon: 'pi pi-file', builder_enabled: false, mode: 'form', content: `/record/${encodeURIComponent(card.model)}` },
            { model: card.model, rec_name: card.model, title: 'Lista', action_type: 'window', action_root_path: '/list', button_icon: 'pi pi-list', builder_enabled: false, mode: 'list', content: `/list/${encodeURIComponent(card.model)}`, number: card.model === this.appManager.selectedModel ? this.tableManager.tableRows.length : 0 }
        ];
        const activeRec = this.getActiveRecName();
        if (card.model === this.appManager.selectedModel && activeRec) {
            actions.push({ model: card.model, rec_name: activeRec, title: 'Apri record', action_type: 'window', action_root_path: `/record/${encodeURIComponent(card.model)}`, button_icon: 'pi pi-external-link', builder_enabled: false, mode: 'form', content: `/record/${encodeURIComponent(card.model)}/${encodeURIComponent(activeRec)}` });
        }
        return { model: card.model, group_id: card.menu_group, title: card.label, buttons: this.makeButtons(actions) };
    }

    private makeContextualActions(): MenuActionDescriptor[] {
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) return [];
        const activeRec = this.getActiveRecName();
        const actionRoot = `/record/${encodeURIComponent(selectedModel)}`;
        const actions: MenuActionDescriptor[] = [
            { model: selectedModel, rec_name: activeRec || 'save', title: 'Salva', action_type: 'save', action_root_path: actionRoot, button_icon: 'pi pi-save', builder_enabled: false, mode: 'form' },
            { model: selectedModel, rec_name: activeRec || 'copy', title: 'Copia rec_name', action_type: 'copy', action_root_path: actionRoot, button_icon: 'pi pi-copy', builder_enabled: false, mode: 'form' },
            { model: selectedModel, rec_name: activeRec || 'delete', title: 'Rimuovi da vista', action_type: 'delete', action_root_path: actionRoot, button_icon: 'pi pi-trash', builder_enabled: false, mode: 'list' }
        ];
        if (activeRec) {
            actions.unshift({ model: selectedModel, rec_name: activeRec, title: 'Apri record', action_type: 'window', action_root_path: actionRoot, button_icon: 'pi pi-external-link', builder_enabled: false, mode: 'form', content: `/record/${encodeURIComponent(selectedModel)}/${encodeURIComponent(activeRec)}` });
        }
        return actions;
    }

    private makeButtons(listActions: MenuActionDescriptor[]): MenuButton[] { return this.makeActionButtons(listActions, ''); }

    makeActionButtons(listActions: MenuActionDescriptor[], recName = ''): MenuButton[] {
        const buttons: MenuButton[] = [];
        for (const item of listActions) {
            let recNameAction = item.rec_name;
            if (recName) recNameAction = recName;
            let urlAction: string;
            if (Object.prototype.hasOwnProperty.call(this.btnActionParser, item.action_type)) {
                urlAction = `${item.action_root_path}/${item.rec_name}/${recNameAction}`;
            } else {
                urlAction = `${item.action_root_path}/${recNameAction}/${item.rec_name}`;
            }
            if (item.rec_name === recNameAction || !Object.prototype.hasOwnProperty.call(this.btnActionParser, item.action_type)) {
                urlAction = `${item.action_root_path}/${recNameAction}`;
            }
            buttons.push({
                model: item.model, key: item.rec_name, type: 'button', label: item.title, leftIcon: item.button_icon,
                req_id: this.uiReqId,
                btn_action_type: this.btnActionParser[item.action_type],
                action_type: item.action_type, url_action: this.normalizeActionUrl(urlAction),
                builder: item.builder_enabled, mode: item.mode, content: item.content, number: item.number,
                menu_group: '', menu_type: '', is_admin: false
            });
        }
        return buttons;
    }

    private normalizeActionMenuCards(payload: unknown): MenuCard[] {
        const sourceList = Array.isArray(payload) ? payload : (this.isRecord(payload) ? [payload] : []);
        if (!sourceList.length) return [];
        const cards: MenuCard[] = [];
        sourceList.forEach((entry, index) => {
            if (!this.isRecord(entry)) return;
            const direct = this.toMenuCard(entry, index);
            if (direct) { cards.push(direct); return; }
            const dynamicCards = this.toDynamicMenuCards(entry, index);
            if (dynamicCards.length) { cards.push(...dynamicCards); return; }
            const flatCard = this.toFlatMenuCard(entry, index);
            if (flatCard) cards.push(flatCard);
        });
        return this.groupMenuCardsByMenuGroup(cards);
    }

    private groupMenuCardsByMenuGroup(cards: MenuCard[]): MenuCard[] {
        const grouped = new Map<string, MenuCard>();
        cards.forEach((card, cardIndex) => {
            const parentId = this.readFirstString(card.parent, card.group_id, `group_${cardIndex}`);
            if (!parentId) return;
            const parentTitle = card.parent && card.parent !== card.group_id ? this.humanizeModelLabel(parentId) : this.readFirstString(card.title, this.humanizeModelLabel(parentId), parentId);
            let parentCard = grouped.get(parentId);
            if (!parentCard) {
                parentCard = { model: this.readFirstString(card.model), group_id: parentId, title: parentTitle, buttons: [], menu_type: this.normalizeMenuType(card.menu_type), is_admin: Boolean(card.is_admin), parent: parentId };
                grouped.set(parentId, parentCard);
            }
            card.buttons.forEach((button, buttonIndex) => {
                const menuGroup = this.readFirstString(button.menu_group, card.group_id, parentId, `group_${cardIndex}_${buttonIndex}`);
                if (!menuGroup) return;
                const normalizedButton = menuGroup === button.menu_group ? button : { ...button, menu_group: menuGroup };
                parentCard?.buttons.push(normalizedButton);
                if (!parentCard?.model) parentCard.model = this.readFirstString(card.model, normalizedButton.model);
                if (!parentCard?.menu_type) parentCard.menu_type = this.normalizeMenuType(normalizedButton.menu_type ?? card.menu_type);
                if (!parentCard?.is_admin) parentCard.is_admin = Boolean(normalizedButton.is_admin ?? card.is_admin);
            });
        });
        return [...grouped.values()];
    }

    private normalizeActionCards(payload: unknown): MenuCard[] {
        if (!Array.isArray(payload)) return [];
        return payload.map((entry, index) => this.toMenuCard(entry, index)).filter((e): e is MenuCard => Boolean(e));
    }

    private toDynamicMenuCards(entry: Record<string, unknown>, index: number): MenuCard[] {
        const out: MenuCard[] = [];
        const menuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? entry['type']);
        const reserved = new Set(['group_id', 'menu_group', 'title', 'buttons', 'model', 'menu_type', 'menuType', 'type', 'is_admin']);
        Object.entries(entry).forEach(([groupTitle, rawButtons], groupIndex) => {
            if (reserved.has(groupTitle)) return;
            if (!Array.isArray(rawButtons)) return;
            const groupId = this.readFirstString(groupTitle, `group_${index}_${groupIndex}`);
            if (!groupId) return;
            const buttons = rawButtons.map((button, buttonIndex) => this.toMenuButton(button, buttonIndex, groupId, menuType)).filter((b): b is MenuButton => Boolean(b));
            if (!buttons.length) return;
            const title = this.readFirstString(groupTitle, `Gruppo ${index + 1}`);
            const isAdmin = this.isAdminMenuType(menuType) || this.guessAdminMenuByText(groupId, title);
            out.push({ model: this.readFirstString(entry['model'], buttons[0]?.model), group_id: groupId, title, buttons, menu_type: menuType, is_admin: isAdmin, parent: this.readFirstString(entry['parent'], groupId) });
        });
        return out;
    }

    private toFlatMenuCard(entry: Record<string, unknown>, index: number): MenuCard | null {
        const groupId = this.readFirstString(entry['menu_group'], entry['group_id'], `group_${index}`);
        const menuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? entry['type']);
        const button = this.toMenuButton(entry, index, groupId, menuType);
        if (!button) return null;
        return { model: button.model, group_id: groupId, title: this.readFirstString(entry['menu_group_label'], entry['group_label'], this.humanizeModelLabel(groupId), groupId), buttons: [button], menu_type: menuType, is_admin: Boolean(button.is_admin), parent: this.readFirstString(entry['parent'], groupId) };
    }

    private toMenuCard(entry: unknown, index: number): MenuCard | null {
        if (!this.isRecord(entry)) return null;
        const groupId = this.readFirstString(entry['group_id'], entry['menu_group'], `group_${index}`);
        const menuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? entry['type']);
        const title = this.readFirstString(entry['title'], groupId || `Gruppo ${index + 1}`) || `Gruppo ${index + 1}`;
        const buttonsRaw = Array.isArray(entry['buttons']) ? entry['buttons'] : [];
        const buttons = buttonsRaw.map((button, buttonIndex) => this.toMenuButton(button, buttonIndex, groupId, menuType)).filter((b): b is MenuButton => Boolean(b));
        if (!buttons.length) return null;
        const isAdmin = this.isAdminMenuType(menuType) || this.guessAdminMenuByText(groupId, title);
        return { model: this.readFirstString(entry['model']), group_id: groupId, title, buttons, menu_type: menuType, is_admin: isAdmin, parent: this.readFirstString(entry['parent'], groupId) };
    }

    private toMenuButton(entry: unknown, index: number, groupId = '', menuType = ''): MenuButton | null {
        if (!this.isRecord(entry)) return null;
        const rawActionType = this.readFirstString(entry['action_type'], entry['type'], 'window') || 'window';
        const urlAction = this.readFirstString(entry['url_action'], entry['content'], '');
        const route = this.resolveMenuButtonRoute(rawActionType, urlAction);
        const actionType = route.actionType;
        const content = this.readFirstString(entry['content'], urlAction, '');
        const icon = this.readFirstString(entry['leftIcon'], entry['icon'], entry['button_icon'], 'pi pi-play') || 'pi pi-play';
        const numberRaw = Number(entry['number']); const number = Number.isFinite(numberRaw) ? numberRaw : undefined;
        const key = this.readFirstString(entry['key'], entry['rec_name'], entry['label'], `action_${index}`);
        const buttonGroup = this.readFirstString(entry['menu_group'], groupId);
        const buttonMenuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? menuType);
        const isAdmin = this.toBooleanFlag(entry['is_admin']) || this.isAdminMenuType(buttonMenuType) || this.guessAdminMenuByText(buttonGroup, this.readFirstString(entry['label'], entry['title']));
        return {
            model: this.readFirstString(entry['model'], this.appManager.selectedModel), key: key || `action_${index}`, type: 'button',
            label: this.readFirstString(entry['label'], entry['title'], key || `Action ${index + 1}`) || `Action ${index + 1}`,
            leftIcon: icon, req_id: this.uiReqId,
            btn_action_type: this.btnActionParser[actionType] ?? false, action_type: actionType,
            url_action: route.urlAction, builder: this.toBooleanFlag(entry['builder'] ?? entry['builder_enabled']),
            mode: this.readFirstString(entry['mode']), content, number, menu_group: buttonGroup, menu_type: buttonMenuType, is_admin: isAdmin
        };
    }

    private toInlineActionButton(event: unknown): MenuButton | null {
        if (!this.isRecord(event) || event['type'] !== OZON_INLINE_ACTION_EVENT) return null;
        const component = this.asRecord(event['component']);
        if (!component) return null;
        const properties = this.renderer.readComponentProperties(component);
        const actionType = this.normalizeMenuType(this.readFirstString(
            component['btn_action_type'],
            properties['btn_action_type'],
            component['action_type'],
            properties['action_type']
        ));
        if (actionType !== 'post') {
            this.setStatus(`Azione inline non supportata: ${actionType || 'mancante'}`, true);
            return null;
        }
        const eventData = this.asRecord(event['data']);
        if (eventData) this.renderer.mergeSubmissionData(eventData);
        const submissionData = this.renderer.formSubmission?.data && this.isRecord(this.renderer.formSubmission.data)
            ? this.renderer.formSubmission.data
            : (eventData ?? {});
        const key = this.readFirstString(component['key'], 'inline_action');
        const liveButtonValue = this.readLiveFormioComponentValue(key);
        const actionPath = this.resolveInlineActionPostPath(component, submissionData, liveButtonValue);
        if (!actionPath) {
            this.setStatus(`url_action mancante per il pulsante "${this.readFirstString(component['label'], component['key']) || 'inline'}"`, true);
            return null;
        }
        const label = this.readFirstString(component['label'], key);
        return {
            model: this.appManager.selectedModel,
            key,
            type: 'button',
            label,
            leftIcon: this.readFirstString(component['leftIcon'], component['rightIcon'], 'pi pi-play') || 'pi pi-play',
            req_id: this.uiReqId,
            btn_action_type: 'post',
            action_type: 'post',
            url_action: actionPath,
            builder: false,
            mode: 'form',
            content: actionPath,
            menu_group: 'form',
            menu_type: '',
            is_admin: false,
            skip_validation: component['showValidations'] === false,
            next_action_path: this.normalizeNextActionRedirectCandidate(this.readFirstString(component['next_action_path'], properties['next_action_path'])),
            modal: this.extractButtonModalConfig(component, properties)
        };
    }

    private toFastActionRequest(event: unknown): { button: MenuButton; component: Record<string, unknown>; properties: Record<string, unknown> } | null {
        if (!this.isRecord(event) || event['type'] !== OZON_INLINE_ACTION_EVENT) return null;
        const component = this.asRecord(event['component']);
        if (!component) return null;
        const properties = this.renderer.readComponentProperties(component);
        const actionType = this.normalizeMenuType(this.readFirstString(
            component['btn_action_type'],
            properties['btn_action_type'],
            component['action_type'],
            properties['action_type']
        ));
        if (actionType !== 'post') {
            this.setStatus(`Azione fast non supportata: ${actionType || 'mancante'}`, true);
            return null;
        }
        const key = this.readFirstString(component['key'], 'fast_action');
        const actionPath = this.resolveInlineActionPostPath(component, this.buildFastActionContext(), undefined);
        if (!actionPath) {
            this.setStatus(`url_action mancante per il pulsante "${this.readFirstString(component['label'], component['key']) || 'fast'}"`, true);
            return null;
        }
        const label = this.readFirstString(component['label'], key);
        return {
            component,
            properties,
            button: {
                model: this.appManager.selectedModel,
                key,
                type: 'button',
                label,
                leftIcon: this.readFirstString(component['leftIcon'], component['rightIcon'], 'pi pi-play') || 'pi pi-play',
                req_id: this.uiReqId,
                btn_action_type: 'post',
                action_type: 'post',
                url_action: actionPath,
                builder: false,
                mode: 'list',
                content: actionPath,
                menu_group: 'list',
                menu_type: '',
                is_admin: false,
                skip_validation: true,
                modal: this.extractButtonModalConfig(component, properties)
            }
        };
    }

    private buildFastActionContext(): Record<string, unknown> {
        const evalContext = this.asRecord(this.appManager.formioRenderOptions['evalContext']) ?? {};
        return {
            ...evalContext,
            user: this.asRecord(evalContext['user']) ?? this.appManager.sessionUser,
            session: this.asRecord(evalContext['session']) ?? this.appManager.sessionRecord,
            is_admin: evalContext['is_admin'] ?? this.appManager.isAdminUser,
            app: {
                curr_model: this.appManager.selectedModel,
                selected_model: this.appManager.selectedModel,
                current_action: this.currentActionName,
                selection_count: this.tableManager.selectedRows.length
            }
        };
    }

    private buildFastActionPayload(component: Record<string, unknown>, properties: Record<string, unknown>, selectedRecNames: string[]): Record<string, unknown> {
        const payload: Record<string, unknown> = {
            model: this.tableManager.fastActionsDataModel || this.appManager.selectedModel,
            rec_names: [...selectedRecNames]
        };
        const extraProps = this.extractFastActionProperties(properties);
        return { ...payload, ...extraProps };
    }

    private extractFastActionProperties(properties: Record<string, unknown>): Record<string, unknown> {
        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(properties ?? {})) {
            const normalizedKey = String(key ?? '').trim();
            if (!normalizedKey) continue;
            if (['btn_action_type', 'url_action', 'modal_title', 'modal_message', 'btn_modal_label', 'action_type', 'tooltip'].includes(normalizedKey)) continue;
            if (value === undefined) continue;
            payload[normalizedKey] = value;
        }
        return payload;
    }

    private async runFastAction(request: { button: MenuButton; component: Record<string, unknown>; properties: Record<string, unknown> }): Promise<void> {
        const selectedRecNames = this.tableManager.selectedRows
            .map(row => String(row.__rec_name ?? '').trim())
            .filter(Boolean);
        if (!selectedRecNames.length) {
            this.setStatus('Seleziona almeno una riga', true);
            return;
        }
        const payload = this.buildFastActionPayload(request.component, request.properties, selectedRecNames);
        await this.executeFastAction({
            button: request.button,
            actionPath: request.button.url_action,
            payload,
            selectedRecNames,
            component: request.component,
            properties: request.properties
        });
    }

    private async executeFastAction(pending: PendingFastAction): Promise<void> {
        await this.withClickTransition(async () => {
            this.setStatus(`Eseguo azione "${pending.button.label}" su ${pending.selectedRecNames.length} righe...`, false);
            // Bulk camunda actions against a local/fast backend can resolve in a handful of ms —
            // the overlay has no fade transition, so it can render and unmount within the same
            // paint, effectively invisible even though it technically "worked". Floor the visible
            // time so it always reads as an actual loading state.
            const minVisible = new Promise<void>(resolve => setTimeout(resolve, 350));
            try {
                const response = await this.api.postActionPath(pending.actionPath, pending.payload);
                const summary = this.buildFastActionSummary(response, pending);
                this.confirmModalConfig = {
                    title: `${pending.button.label} - esito`,
                    message: summary,
                    confirmLabel: 'Chiudi'
                };
                this.confirmModalVisible = true;
                this.setStatus(`Azione "${pending.button.label}" eseguita`, false);
                await this.loadRecords(false);
            } catch (error) {
                this.setStatus(this.errorMessage(error), true);
            } finally {
                await minVisible;
            }
        });
    }

    private buildFastActionSummary(response: unknown, pending: PendingFastAction): string {
        const obj = this.tryResponseObject(response);
        const rows = this.extractFastActionRowResults(obj?.content?.data);
        const okCount = rows.filter(row => this.isFastActionOk(row.status)).length;
        const failCount = rows.length - okCount;
        const processStatus = this.readFirstString((obj?.content as Record<string, unknown> | undefined)?.['process_status']);
        const header = [
            `Azione: ${pending.button.label}`,
            `Righe selezionate: ${pending.selectedRecNames.length}`,
            rows.length ? `Esito: ${okCount} ok, ${failCount} errori${processStatus ? ` (${processStatus})` : ''}` : `Esito: completata${processStatus ? ` (${processStatus})` : ''}`
        ];
        const detailLines = rows.map(row => {
            const suffix = row.message ? ` - ${row.message}` : '';
            return `${row.rec_name || 'n/d'}: ${row.status}${suffix}`;
        });
        return [...header, ...detailLines].join('\n');
    }

    private extractFastActionRowResults(value: unknown): FastActionRowResult[] {
        if (!Array.isArray(value)) return [];
        return value.map(entry => {
            const row = this.asRecord(entry) ?? {};
            return {
                rec_name: this.readFirstString(row['rec_name']),
                status: this.readFirstString(row['status'], row['result'], 'ok'),
                message: this.readFirstString(row['message'])
            };
        }).filter(entry => Boolean(entry.rec_name || entry.status));
    }

    private isFastActionOk(status: string): boolean {
        const normalized = String(status ?? '').trim().toLowerCase();
        return !normalized || normalized === 'ok' || normalized === 'success' || normalized === 'done';
    }

    private resolveInlineActionPostPath(component: Record<string, unknown>, data: Record<string, unknown>, liveValue: unknown = undefined): string {
        const properties = this.renderer.readComponentProperties(component);
        const key = this.readFirstString(component['key']);
        const buttonValue = key ? this.readFirstString(data[key]) : '';
        const configured = this.readFirstString(component['url_action'], properties['url_action'], component['url'], properties['url']);
        const candidates = [
            this.resolveInlineActionPathCandidate(this.readFirstString(liveValue), data),
            this.resolveInlineActionPathCandidate(buttonValue, data),
            this.resolveInlineLogicPath(component, data),
            this.resolveInlineActionConfiguredPath(configured, data),
            this.normalizeInlinePostPath(configured)
        ];
        return this.readFirstString(...candidates);
    }

    private readLiveFormioComponentValue(key: string): unknown {
        const normalizedKey = this.readFirstString(key);
        const formio = this._formioViewerGetter?.()?.formio as any;
        if (!normalizedKey || !formio) return undefined;
        const readValue = (component: any): unknown => {
            if (!component) return undefined;
            try {
                if (typeof component.getValue === 'function') return component.getValue();
            } catch { /* ignore live component read errors */ }
            return component.dataValue;
        };
        try {
            const direct = typeof formio.getComponent === 'function' ? formio.getComponent(normalizedKey) : null;
            const value = readValue(direct);
            if (value !== undefined && value !== null && value !== false) return value;
        } catch { /* ignore live component lookup errors */ }
        try {
            let found: unknown = undefined;
            if (typeof formio.everyComponent === 'function') {
                formio.everyComponent((component: any) => {
                    const componentKey = this.readFirstString(component?.component?.key, component?.key);
                    if (componentKey !== normalizedKey) return;
                    found = readValue(component);
                    return false;
                });
            }
            return found;
        } catch { return undefined; }
    }

    private resolveInlineLogicPath(component: Record<string, unknown>, data: Record<string, unknown>): string {
        const logicItems = Array.isArray(component['logic']) ? component['logic'] as unknown[] : [];
        const context = this.buildInlineLogicContext(data);
        for (const logic of logicItems) {
            if (!this.isRecord(logic)) continue;
            const trigger = this.asRecord(logic['trigger']);
            if (!trigger || String(trigger['type'] ?? '').trim().toLowerCase() !== 'json') continue;
            const json = trigger['json'];
            let triggerResult: unknown;
            try { triggerResult = jsonLogic.apply(json as any, context); } catch { continue; }
            const actions = Array.isArray(logic['actions']) ? logic['actions'] as unknown[] : [];
            for (const action of actions) {
                if (!this.isRecord(action)) continue;
                if (String(action['type'] ?? '').trim().toLowerCase() !== 'value') continue;
                const actionPath = this.resolveInlineLogicActionPath(this.readFirstString(action['value']), triggerResult, context);
                if (actionPath) return actionPath;
            }
        }
        return '';
    }

    /**
     * Supports two logic value-action formats for computing a button's POST url:
     *   legacy: `value = result;` / `url_action`  -> use the trigger json result
     *   modern: `url_action = {<json-logic>};`     -> evaluate the assigned json-logic here
     */
    private resolveInlineLogicActionPath(rawValue: string, triggerResult: unknown, context: Record<string, unknown>): string {
        const value = this.readFirstString(rawValue);
        if (!value) return '';
        const assignment = value.match(/^url_action\s*=\s*([\s\S]+?);?\s*$/);
        if (assignment) {
            const rule = this.parseJsonMaybe(assignment[1]);
            if (rule == null) return this.normalizeInlinePostPath(assignment[1].trim());
            let computed: unknown;
            try { computed = jsonLogic.apply(rule as any, context); } catch { return ''; }
            return this.normalizeInlinePostPath(this.readFirstString(computed));
        }
        const normalized = value.replace(/\s+/g, ' ');
        if (normalized === 'url_action' || normalized === 'value = result;' || normalized === 'value=result;') {
            return this.normalizeInlinePostPath(this.readFirstString(triggerResult));
        }
        return '';
    }

    private extractButtonModalConfig(component: Record<string, unknown>, properties: Record<string, unknown>): ButtonModalConfig | undefined {
        const title = this.readFirstString(properties['modal_title'], component['modal_title']);
        const message = this.readFirstString(properties['modal_message'], component['modal_message']);
        const confirmLabel = this.readFirstString(properties['btn_modal_label'], component['btn_modal_label']);
        if (!title && !message) return undefined;
        return {
            title: title || 'Conferma',
            message: message || 'Confermi l\'operazione?',
            confirmLabel: confirmLabel || 'Conferma'
        };
    }

    private buildInlineLogicContext(data: Record<string, unknown>): Record<string, unknown> {
        const evalContext = this.asRecord(this.appManager.formioRenderOptions['evalContext']) ?? {};
        const context = {
            ...evalContext,
            data,
            form: data,
            user: this.asRecord(evalContext['user']) ?? this.appManager.sessionUser,
            session: this.asRecord(evalContext['session']) ?? this.appManager.sessionRecord,
            is_admin: evalContext['is_admin'] ?? this.appManager.isAdminUser,
            app: {
                curr_model: this.appManager.selectedModel,
                selected_model: this.appManager.selectedModel,
                current_action: this.currentActionName,
                selection_count: this.tableManager.selectedRows.length
            }
        };
        // DEBUG (opt-in via localStorage['ozon_debug_jsonlogic']): the context includes the
        // session record which may carry sensitive fields — never log unconditionally.
        if (typeof localStorage !== 'undefined' && localStorage.getItem('ozon_debug_jsonlogic')) {
            console.log('[json-logic] variabili disponibili (top-level keys):', Object.keys(context));
            console.log('[json-logic] data/form:', context.data);
            console.log('[json-logic] user:', context.user);
            console.log('[json-logic] app:', context.app, 'is_admin:', context.is_admin);
        }
        return context;
    }

    private resolveInlineActionConfiguredPath(configured: string, data: Record<string, unknown>): string {
        if (!configured) return '';
        const fromData = this.renderer.resolvePath(data, configured);
        return this.normalizeInlinePostPath(this.readFirstString(fromData));
    }

    private resolveInlineActionPathCandidate(candidate: string, data: Record<string, unknown>): string {
        if (!candidate) return '';
        const direct = this.normalizeInlinePostPath(candidate);
        if (direct) return direct;
        const fromData = this.renderer.resolvePath(data, candidate);
        return this.normalizeInlinePostPath(this.readFirstString(fromData));
    }

    private normalizeInlinePostPath(candidate: string): string {
        let raw = this.readFirstString(candidate);
        if (!raw || /^https?:\/\//i.test(raw) || raw === 'url_action') return '';
        raw = raw.replace(/^\/+/, '');
        if (!raw) return '';
        if (raw.startsWith('api/')) raw = raw.slice('api/'.length);
        if (raw.startsWith('action/') || raw.startsWith('client/') || raw.startsWith('list/') || raw.startsWith('record/')) {
            return this.normalizeActionUrl(`/${raw}`);
        }
        if (raw.includes('/')) return this.normalizeActionUrl(`/${raw}`);
        return this.normalizeActionUrl(`/action/${raw}`);
    }

    private resolveMenuButtonRoute(actionType: string, rawActionPath: string): { actionType: string; urlAction: string } {
        const normalizedType = this.normalizeMenuType(actionType);
        const normalizedPath = this.normalizeActionUrl(rawActionPath || '/');
        if (normalizedType !== 'menu') return { actionType, urlAction: normalizedPath };
        if (!this.hasRunnableMenuPath(normalizedPath)) return { actionType: 'menu', urlAction: normalizedPath };
        return { actionType: 'window', urlAction: this.normalizeRunnableMenuPath(normalizedPath) };
    }

    private hasRunnableMenuPath(actionPath: string): boolean {
        const p = this.normalizeActionUrl(actionPath || '/');
        return p !== '/' && p !== '/menu';
    }

    private normalizeRunnableMenuPath(actionPath: string): string {
        let p = this.normalizeActionUrl(actionPath || '/');
        if (p.startsWith('/actoin/')) p = this.normalizeActionUrl(`/action/${p.slice('/actoin/'.length)}`);
        if (p === '/dashboard' || p.startsWith('/action/') || p.startsWith('/list/') || p.startsWith('/record/')) return p;
        const actionName = p.replace(/^\/+/, '');
        if (!actionName) return '/';
        return this.normalizeActionUrl(`/action/${actionName}`);
    }

    private isMenuContainerButton(button: MenuButton): boolean { return this.normalizeMenuType(button?.action_type) === 'menu'; }
    private isVisibleMenuButton(button: MenuButton): boolean {
        if (!button || this.isMenuContainerButton(button)) return false;
        const label = this.readFirstString(button.label);
        if (!label) return false;
        const actionPath = this.getButtonActionPath(button);
        return actionPath !== '/' && actionPath !== '/menu';
    }
    private isBuilderAction(button: MenuButton): boolean {
        if (!button) return false;
        if (button.builder) return true;
        const label = this.readFirstString(button.label).toLowerCase();
        const path = this.getButtonActionPath(button).toLowerCase();
        return label.includes('design') || label.includes('resource') || path.includes('/design') || path.includes('/resource');
    }

    private isAdminMenuCard(card: MenuCard): boolean {
        if (!card) return false;
        if (card.is_admin) return true;
        if (this.isAdminMenuType(card.menu_type)) return true;
        return this.guessAdminMenuByText(card.group_id, card.title);
    }

    private normalizeMenuType(value: unknown): string { return String(value ?? '').trim().toLowerCase(); }
    private isAdminMenuType(value: unknown): boolean { return this.normalizeMenuType(value) === 'admin'; }
    private guessAdminMenuByText(...values: unknown[]): boolean {
        const text = values.map(v => String(v ?? '').trim().toLowerCase()).join(' ');
        if (!text) return false;
        return /\badmin\b/.test(text) || /\bdesign\b/.test(text);
    }

    private humanizeModelLabel(model: string): string {
        return String(model).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, s => s.toUpperCase());
    }

    private normalizeActionUrl(url: string): string {
        let normalized = `/${String(url || '').trim().replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
        if (normalized === '/api') normalized = '/';
        else if (normalized.startsWith('/api/')) normalized = `/${normalized.slice('/api/'.length)}`.replace(/\/{2,}/g, '/');
        return normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
    }

    normalizeNextActionRedirectCandidate(candidate: unknown): string {
        if (typeof candidate !== 'string') return '';
        let raw = candidate.trim();
        if (!raw) return '';
        raw = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
        if (!raw) return '';
        if (raw.startsWith('api/')) raw = raw.slice('api/'.length);
        if (raw.startsWith('actoin/')) raw = `action/${raw.slice('actoin/'.length)}`;
        if (raw === 'next_action' || raw.startsWith('next_action/')) return '';
        if (raw === 'action/next_action' || raw.startsWith('action/next_action/')) return '';
        if (raw.startsWith('dashboard')) return '/dashboard';
        if (raw.startsWith('action/')) return this.normalizeActionUrl(`/${raw}`);
        if (raw.startsWith('list/') || raw.startsWith('record/')) return this.normalizeActionUrl(`/${raw}`);
        return this.normalizeActionUrl(`/action/${raw}`);
    }

    getButtonActionPath(button: MenuButton): string {
        const raw = this.readFirstString(button.url_action, button.content, '');
        return this.normalizeActionUrl(raw || '/');
    }

    private isPostActionButton(button: MenuButton): boolean {
        if (!button) return false;
        const actionType = this.normalizeMenuType(button.action_type);
        if (actionType === 'post') return true;
        if (actionType !== 'save') return false;
        return this.getButtonActionPath(button).startsWith('/action/');
    }

    private async runPostActionButton(button: MenuButton): Promise<void> {
        const pageContextId = this.pageContextId;
        const payload = this.renderer.normalizeCurrentSubmissionData();
        if (!payload || !this.isRecord(payload)) { this.setStatus('Nessun dato form disponibile per invocare l\'azione', true); return; }
        if (!button.skip_validation && !this.validateFormioSubmissionForSave(this._formioViewerGetter?.(), payload)) return;
        const actionPath = this.getButtonActionPath(button);
        if (!actionPath || actionPath === '/') { this.setStatus(`POST action non valida: ${actionPath || 'mancante'}`, true); return; }
        // The Camunda gateway only needs process variables, not file binaries. base64 file blobs
        // bloat the submission and trigger 413 Request Entity Too Large — strip them here.
        const outboundPayload = actionPath.includes('/gateway/camunda/')
            ? this.stripFileBlobs(payload) as Record<string, unknown>
            : payload;
        this.setStatus(`Eseguo azione "${button.label}"...`, false);
        try {
            const response = await this.api.postActionPath(actionPath, outboundPayload);
            if (!this.tryResponseObject(response)) {
                this.appManager.clearFormNotifications();
                this.setStatus(`Azione "${button.label}" eseguita`, false);
                return;
            }
            // Uno step supervisionato scrive il record come il salvataggio
            // normale e deve finire dove finisce il salvataggio, non
            // ri-renderizzare il form: stessa coda, stessa next_action.
            if (this.isStepActionPath(actionPath)) {
                if (!this.isCurrentPageContext(pageContextId)) return;
                const obj = requireResponseObject(response);
                if (obj.fail) { this.setStatus(obj.message || 'Errore', true); return; }
                const stepRecName = this.getActiveRecName()
                    || this.readFirstString(obj.content.rec_name, payload['rec_name']);
                await this.applyRecordWriteTail(response, stepRecName, `Azione "${button.label}" eseguita`);
                return;
            }
            await this.applyInvokedActionResponse(response, button.next_action_path, pageContextId);
        } catch (error) { this.setStatus(this.errorMessage(error), true); }
    }

    private isStepActionPath(actionPath: string): boolean {
        return this.normalizeActionUrl(actionPath).startsWith('/step/');
    }

    private tryResponseObject(payload: unknown): ResponseObject | null {
        try { return requireResponseObject(payload); } catch { return null; }
    }

    /**
     * Remove heavy inline file contents (base64 / data: URLs) from a payload while keeping file
     * metadata (name, size, type, storage). Used for Camunda gateway posts so attached files do
     * not bloat the request body into a 413.
     */
    private stripFileBlobs(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(entry => this.stripFileBlobs(entry));
        if (!this.isRecord(value)) return value;
        const isFileEntry = typeof value['base64'] === 'string'
            || (typeof value['url'] === 'string' && value['url'].startsWith('data:'));
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (isFileEntry && key === 'base64') continue;
            if (isFileEntry && key === 'url' && typeof entry === 'string' && entry.startsWith('data:')) continue;
            out[key] = this.stripFileBlobs(entry);
        }
        return out;
    }

    private async applyInvokedActionResponse(response: unknown, fallbackNextActionPath = '', pageContextId = this.pageContextId): Promise<void> {
        if (!this.isCurrentPageContext(pageContextId)) return;
        const obj = requireResponseObject(response);
        if (obj.fail) { this.setStatus(obj.message || 'Errore', true); return; }
        const nextUrl = this.resolveRedirectUrl(obj.content);
        if (nextUrl && await this.handleRedirectResponseTarget(nextUrl)) return;
        const mode = obj.content.mode.trim().toLowerCase();
        if (mode !== 'action') {
            await this.applyActionResponse(response, pageContextId); return;
        }
        if (fallbackNextActionPath) {
            await this.navigateToPath(fallbackNextActionPath, true); return;
        }
        this.appManager.clearFormNotifications();
        this.setStatus('Azione completata', false);
    }

    private async runWindowAction(button: MenuButton): Promise<void> { await this.runWindowPath(this.getButtonActionPath(button)); }

    private clearFastSearchCacheForMenuAction(button: MenuButton): void {
        const actionName = this.resolveFastSearchActionNameFromPath(this.getButtonActionPath(button));
        if (!actionName) return;
        this.tableManager.clearFastSearchStateFromStorage(actionName);
    }

    private readCurrentBrowserPath(): string {
        if (typeof window === 'undefined') return '/dashboard';
        return this.normalizeActionUrl(`${window.location.pathname || '/'}${window.location.search || ''}`);
    }

    private readHistoryActionOriginPath(): string {
        if (typeof window === 'undefined') return '';
        const state = this.asRecord(window.history.state);
        const originPath = this.readFirstString(state?.['ozon_action_origin_path']);
        return originPath ? this.normalizeActionUrl(originPath) : '';
    }

    private buildHistoryStateForNavigation(targetPath: string, replace: boolean): Record<string, unknown> {
        if (typeof window === 'undefined') return {};
        const currentState = this.asRecord(window.history.state) ?? {};
        const nextState: Record<string, unknown> = { ...currentState };
        if (!targetPath.startsWith('/action/')) {
            delete nextState['ozon_action_origin_path'];
            return nextState;
        }
        const existingOriginPath = this.readFirstString(currentState['ozon_action_origin_path']);
        const originPath = replace ? this.readFirstString(existingOriginPath, this.readCurrentBrowserPath()) : this.readCurrentBrowserPath();
        const normalizedOriginPath = originPath ? this.normalizeActionUrl(originPath) : '';
        if (normalizedOriginPath && normalizedOriginPath !== targetPath) nextState['ozon_action_origin_path'] = normalizedOriginPath;
        else delete nextState['ozon_action_origin_path'];
        return nextState;
    }

    private resolveFastSearchActionNameFromPath(path: string): string {
        const normalizedPath = this.normalizeActionUrl(path);
        if (!normalizedPath.startsWith('/action/')) return '';
        const route = this.parseActionRoute(normalizedPath);
        if (!route) return '';
        if (route.name === 'next_action') return this.readFirstString(route.args[0]);
        return route.name;
    }

    private async runWindowPath(rawPath: string): Promise<void> {
        const segments = rawPath.split('/').map(e => e.trim()).filter(Boolean).map(e => decodeURIComponent(e));
        if (!segments.length) return;
        if (segments[0] === 'dashboard') { await this.navigateToPath('/dashboard'); return; }
        if (segments[0] === 'action') { await this.navigateToPath(rawPath); return; }
        if (segments[0] === 'list' && segments[1]) {
            const pageContextId = this.beginPageContext();
            const model = segments[1];
            if (model !== this.appManager.selectedModel) { this.appManager.selectedModel = model; this.tableManager.selectedModel = model; this.renderer.selectedModel = model; this.onModelChanged(); }
            await this.loadSchema(); await this.loadRecords();
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.appManager.viewMode = 'list'; return;
        }
        if (segments[0] === 'record' && segments[1]) {
            const pageContextId = this.beginPageContext();
            const model = segments[1]; const recName = segments[2] ?? '';
            if (model !== this.appManager.selectedModel) { this.appManager.selectedModel = model; this.tableManager.selectedModel = model; this.renderer.selectedModel = model; this.onModelChanged(); }
            if (recName) {
                this.tableManager.selectedRecordName = recName; this.renderer.selectedRecordName = recName;
                this.rebuildMenus(); await this.openSelectedRecord();
                if (!this.isCurrentPageContext(pageContextId)) return;
                this.appManager.viewMode = 'form';
            } else {
                await this.loadSchema();
                if (!this.isCurrentPageContext(pageContextId)) return;
                this.appManager.viewMode = 'form';
            }
            return;
        }
        this.setStatus(`Azione window non riconosciuta: ${rawPath}`, true);
    }

    private async handleLocationRoute(replaceRoot: boolean): Promise<void> {
        if (typeof window === 'undefined') return;
        const path = this.normalizeActionUrl(window.location.pathname || '/');
        if (path === '/') { await this.navigateToPath('/dashboard', true); return; }
        if (path === '/dashboard') { this.beginPageContext(); this.builder.resetBuilderState(); this.currentActionName = ''; this.appManager.viewMode = 'dashboard'; return; }
        if (path.startsWith('/action/')) { this.beginPageContext(); await this.runActionRoute(path); return; }
        if (replaceRoot) await this.navigateToPath('/dashboard', true);
    }

    private async navigateToPath(path: string, replace = false): Promise<void> {
        const pageContextId = this.beginPageContext();
        const normalized = this.normalizeActionUrl(path || '/dashboard');
        if (typeof window !== 'undefined') {
            const current = this.normalizeActionUrl(window.location.pathname || '/');
            if (replace || current !== normalized) {
                const state = this.buildHistoryStateForNavigation(normalized, replace);
                if (replace) window.history.replaceState(state, '', normalized);
                else window.history.pushState(state, '', normalized);
            }
        }
        if (normalized === '/dashboard' || normalized === '/') {
            this.currentActionName = '';
            this.appManager.viewMode = 'dashboard';
            this.builder.resetBuilderState();
            try { await this.loadActionDashboard(); } catch { }
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.appManager.closeTopMenu();
            return;
        }
        if (normalized.startsWith('/action/')) { await this.runActionRoute(normalized); this.appManager.closeTopMenu(); return; }
        this.appManager.viewMode = 'dashboard';
    }

    private async runActionRoute(path: string): Promise<void> {
        const pageContextId = this.pageContextId;
        const route = this.parseActionRoute(path);
        if (!route) { this.setStatus(`Azione non valida: ${path}`, true); return; }
        if (route.name === 'next_action') { await this.runNextActionRoute(route.args); return; }
        this.currentActionName = route.name;
        this.setStatus(`Caricamento azione: ${route.name}`, false);
        try {
            const routeRequest = this.buildActionRouteRequest(route);
            const response = await this.api.getAction(route.name, routeRequest);
            if (!this.isCurrentPageContext(pageContextId)) return;
            const obj = requireResponseObject(response);
            if (obj.fail) { this.setStatus(obj.message || 'Errore dal server', true); return; }
            const nextUrl = this.resolveRedirectUrl(obj.content);
            if (nextUrl && obj.content.mode === 'redirect') {
                if (await this.handleRedirectResponseTarget(nextUrl)) return;
            }
            await this.applyActionResponse(response, pageContextId, { forceBootstrapListLoad: routeRequest.limit === 1 });
        } catch (error) { this.setStatus(this.errorMessage(error), true); }
    }

    private async runNextActionRoute(args: string[]): Promise<void> {
        const pageContextId = this.pageContextId;
        const currentAction = this.readFirstString(args[0], this.resolveCurrentActionName());
        const recName = this.readFirstString(args[1]);
        const formOriginPath = this.readCurrentBrowserPath();
        if (!currentAction) { this.setStatus('next_action richiede current_action', true); return; }
        this.setStatus(`Caricamento next_action: ${currentAction}${recName ? `/${recName}` : ''}`, false);
        try {
            const response = await this.api.getNextAction(currentAction, recName);
            if (!this.isCurrentPageContext(pageContextId)) return;
            const obj = requireResponseObject(response);
            if (obj.fail) { this.setStatus(obj.message || 'Errore', true); return; }
            const nextUrl = this.resolveRedirectUrl(obj.content);
            const normalizedNextUrl = nextUrl ? this.normalizeActionUrl(nextUrl) : '';
            if (nextUrl === '#' || (normalizedNextUrl && !normalizedNextUrl.startsWith('/action/next_action'))) {
                if (await this.handleRedirectResponseTarget(nextUrl)) return;
            }
            await this.applyActionResponse(response, pageContextId, { formOriginPath });
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.resolveNextActionBrowserUrl();
        } catch (error) { this.setStatus(this.errorMessage(error), true); }
    }

    private resolveNextActionBrowserUrl(): void {
        if (typeof window === 'undefined') return;
        const current = this.normalizeActionUrl(window.location.pathname);
        const resolvedAction = this.currentActionName;
        if (!resolvedAction) return;
        const resolvedRec = this.tableManager.selectedRecordName;
        const newPath = this.normalizeActionUrl(resolvedRec ? `/action/${resolvedAction}/${resolvedRec}` : `/action/${resolvedAction}`);
        if (newPath === current) return;
        if (current.includes('/next_action')) {
            window.history.replaceState(window.history.state, '', newPath);
        }
    }

    private resolveRedirectUrl(content: ResponseObjectData): string {
        const contentRecord = content as unknown as Record<string, unknown>;
        const data = this.asRecord(content.data);
        return this.readFirstString(
            content.next_action_url,
            contentRecord['next_page'],
            contentRecord['nextPage'],
            contentRecord['next_path'],
            contentRecord['nextPath'],
            data?.['next_action_url'],
            data?.['nextActionUrl'],
            data?.['next_page'],
            data?.['nextPage'],
            data?.['next_path'],
            data?.['nextPath'],
            data?.['path'],
            data?.['url'],
            data?.['location']
        );
    }

    private async handleRedirectResponseTarget(rawTarget: string): Promise<boolean> {
        const target = this.readFirstString(rawTarget);
        if (!target) return false;
        if (target === '#') {
            const currentPath = this.readCurrentBrowserPath();
            const reload = this.mainManager.hardReloadToUrl(currentPath);
            if (reload.blocked) this.setStatus(`Redirect bloccato: origin non abilitata (${currentPath})`, true);
            return true;
        }
        const reload = this.mainManager.hardReloadToUrl(target);
        if (reload.reloaded) return true;
        if (reload.blocked) {
            this.setStatus(`Redirect bloccato: origin non abilitata (${target})`, true);
            return true;
        }
        await this.navigateToPath(this.normalizeRedirectNavigationPath(target), true);
        return true;
    }

    private normalizeRedirectNavigationPath(target: string): string {
        const raw = this.readFirstString(target);
        if (/^https?:\/\//i.test(raw)) {
            try {
                const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
                return this.normalizeActionUrl(`${parsed.pathname}${parsed.search || ''}`);
            } catch {
                return '/dashboard';
            }
        }
        return this.normalizeActionUrl(raw);
    }

    private parseActionRoute(path: string): { name: string; recName: string; args: string[] } | null {
        const normalizedPath = this.normalizeActionUrl(path).split('?')[0];
        const segments = normalizedPath.split('/').map(s => s.trim()).filter(Boolean).map(s => decodeURIComponent(s));
        if (segments[0] !== 'action' || !segments[1]) return null;
        const args = segments.slice(2);
        return { name: segments[1], recName: args[0] ?? '', args };
    }

    private buildActionRouteRequest(route: { name: string; recName: string }): {
        recName: string;
        query: Record<string, unknown>;
        order: string;
        skip: number;
        limit: number;
    } {
        const shouldPrimeListRoute = !this.readFirstString(route.recName);
        if (shouldPrimeListRoute) {
            return {
                recName: '',
                query: {},
                order: this.tableManager.order,
                skip: 0,
                limit: 1
            };
        }
        return {
            recName: route.recName,
            query: this.tableManager.parseQueryInput((m, e) => this.setStatus(m, e)) ?? {},
            order: this.tableManager.order,
            skip: this.tableManager.skip,
            limit: this.tableManager.limit
        };
    }

    private async applyActionResponse(
        payload: unknown,
        pageContextId = this.pageContextId,
        opt: { forceBootstrapListLoad?: boolean; formOriginPath?: string } = {}
    ): Promise<void> {
        if (!this.isCurrentPageContext(pageContextId)) return;
        const { content, fail, message } = requireResponseObject(payload);
        if (fail) throw new Error(message || 'Errore dal server');
        const mode = content.mode.trim().toLowerCase();
        const actionName = this.readFirstString(
            (content.fields['action_name'] as string),
            (content.fields['current_action'] as string)
        );
        if (mode !== 'list') { this.tableManager.resetTableRowActionsConfig(); this.tableManager.listQuerySeed = null; }
        if (mode === 'layout') {
            this.appManager.applyLayoutResponse(content, d => this.normalizeActionMenuCards(d), s => this.cloneSchema(s), this.topMenuCards);
            this.setStatus(`Layout caricato: ${this.appManager.layoutName || 'default'}`, false); return;
        }
        if (mode === 'menu') {
            this.appManager.applyMenuResponse(content, d => this.normalizeActionMenuCards(d), this.topMenuCards);
            this.setStatus(`Menu caricato: ${this.appManager.dashboardMenu.length} gruppi`, false); return;
        }
        if (mode === 'card') {
            this.appManager.applyDashboardResponse(content, d => this.normalizeActionCards(d));
            this.currentActionName = ''; this.appManager.viewMode = 'dashboard';
            this.setStatus(`Dashboard caricata: ${this.appManager.dashboardCards.length} card`, false); return;
        }
        if (mode === 'list') {
            if (actionName) this.currentActionName = actionName;
            await this.applyActionListResponse(content, pageContextId);
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.appManager.viewMode = 'list';
            if (opt.forceBootstrapListLoad || !Array.isArray(content.data)) void this.loadRecords(true);
            this.setStatus(`Lista caricata: ${this.tableManager.tableRows.length} record`, false); return;
        }
        if (mode === 'form') {
            if (actionName) this.currentActionName = actionName;
            try {
                await this.applyActionFormResponse(content, pageContextId, opt.formOriginPath);
            } catch (error) {
                this.renderer.cancelFormViewerLoad();
                throw error;
            }
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.appManager.viewMode = 'form';
            this.setStatus(`Record caricato: ${this.tableManager.selectedRecordName || 'N/A'}`, false); return;
        }
        if (mode === 'redirect') {
            const url = this.resolveRedirectUrl(content);
            if (url) {
                if (await this.handleRedirectResponseTarget(url)) return;
            }
        }
        if (mode === 'action') {
            const data = this.isRecord(content.data) ? content.data : {};
            const msg = this.readFirstString(data['message'] as string, data['status'] as string, 'Azione completata');
            this.setStatus(msg, false); return;
        }
        this.setStatus(`Modalita azione non supportata: ${mode || 'unknown'}`, true);
    }

    private resolveModelName(content: ResponseObjectData, actionName: string): string {
        if (typeof content.model === 'string' && content.model.trim()) {
            return content.model.trim();
        }
        if (this.isRecord(content.fields) && typeof content.fields['model'] === 'string' && content.fields['model'].trim()) {
            return content.fields['model'].trim();
        }
        const act = String(actionName || '').trim();
        if (act.startsWith('list_')) {
            return act.slice('list_'.length);
        }
        if (act.startsWith('form_')) {
            return act.slice('form_'.length);
        }
        return '';
    }

    private async applyActionListResponse(content: ResponseObjectData, pageContextId = this.pageContextId, opt: { preserveTableStructure?: boolean } = {}): Promise<void> {
        if (!this.isCurrentPageContext(pageContextId)) return;
        this.tableManager.syncTableRowActionsConfig(content.fields);
        const rows = Array.isArray(content.data) ? content.data : [];
        this.tableManager.resetSelectionAndTable({
            preserveFilterText: true,
            preserveColumns: opt.preserveTableStructure
        });
        this.tableManager.strictHeaderColumns = Object.keys(content.columns).length > 0;
        this.tableManager.tableTotalRecords = content.total_count || rows.length;
        this.tableManager.applyTableColumnsFromHeader(content.columns);
        rows.forEach(row => this.tableManager.appendRecordRow(row));
        this.tableManager.flushRows();
        const modelName = this.resolveModelName(content, this.currentActionName);
        if (modelName) {
            this.appManager.selectedModel = modelName;
            this.tableManager.selectedModel = modelName;
            this.renderer.selectedModel = modelName;
        }
        this.tableManager.menuBaseQuery = content.query || null;
        this.tableManager.menuBaseSort = content.sort || '';
        if (content.sort) {
            this.tableManager.order = content.sort;
        }
        this.renderer.formSubmission = null;
        this.resetContextActionState();
        this.currentFormSubmitActionPath = '';
        this.currentFormSubmitNextActionPath = '';
        this.currentFormPageTitle = content.title;
        this.currentListComponentType = this.resolveComponentTypeFromFields(content.fields);
        const listSchema = this.renderer.extractFormSchema(content.schema);
        this.tableManager.syncListQuerySeed(content.fields, listSchema);
        if (listSchema) {
            this.renderer.rawFormSchema = this.cloneSchema(listSchema);
            this.renderer.rawFormSchemaModel = this.appManager.selectedModel;
            this.tableManager.rawFormSchema = this.renderer.rawFormSchema;
            this.tableManager.rawFormSchemaModel = this.appManager.selectedModel;
        }
        this.tableManager.syncListTransferConfig(content.fields, listSchema, this.currentActionName);
        this.contextActions = this.normalizeContextActions(content.context_actions);
        this.hasContextActionsPayload = this.contextActions.length > 0;
        const rendererRevision = this.tableManager.prepareTableCellRenderers(rows);
        if (!this.isCurrentPageContext(pageContextId)) return;
        this.builder.syncBuilderMode(content as unknown as Record<string, unknown>, null, null);
        this.rebuildMenus();
        this.warmActionListView(content.fields, rows as Array<Record<string, unknown>>, rendererRevision, listSchema, pageContextId);
    }

    private async applyFastSearchConfig(fields: Record<string, unknown>): Promise<void> {
        const rawConfig = fields['fast_search'];
        if (!this.isRecord(rawConfig)) {
            this.tableManager.beginFastSearchWarmup(false);
            return;
        }
        const fastSearchRevision = this.tableManager.beginFastSearchWarmup(true);
        const rawSchema = rawConfig['schema'];
        let schema: Record<string, unknown> | null = this.renderer.extractFormSchema(rawSchema);
        if (!schema) {
            const modelName = this.readFirstString(rawConfig['fast_serch_model'], rawConfig['fast_search_model']);
            if (modelName) {
                try {
                    const payload = await this.api.getAction('form_form_fast_search_config', { recName: modelName });
                    const cfgObj = requireResponseObject(payload);
                    schema = this.renderer.extractFormSchema(cfgObj.content.schema);
                } catch { /* leave schema null */ }
            }
        }
        const formModel = this.readFirstString(rawConfig['fast_serch_model'], rawConfig['fast_search_model']);
        const restored = await this.tableManager.setFastSearchConfig(this.currentActionName, schema, formModel, fastSearchRevision);
        // If saved fast-search state was restored, reload records with the restored query.
        if (restored) void this.loadRecords(false);
    }

    private async applyFastActionsConfig(fields: Record<string, unknown>): Promise<void> {
        const rawConfig = fields['fast_actions'];
        if (!this.isRecord(rawConfig)) {
            this.tableManager.beginFastActionsWarmup(false);
            return;
        }
        const fastActionsRevision = this.tableManager.beginFastActionsWarmup(true);
        const rawSchema = rawConfig['schema'];
        let schema: Record<string, unknown> | null = this.renderer.extractFormSchema(rawSchema);
        if (!schema) {
            const modelName = this.readFirstString(
                rawConfig['fast_actions_model'],
                rawConfig['fast_actions_form_model'],
                rawConfig['fast_actions_data_model']
            );
            if (modelName) {
                try {
                    const payload = await this.api.getAction('form_form_fast_actions_config', { recName: modelName });
                    const cfgObj = requireResponseObject(payload);
                    schema = this.renderer.extractFormSchema(cfgObj.content.schema);
                } catch { /* leave schema null */ }
            }
        }
        const formModel = this.readFirstString(
            rawConfig['model'],
            rawConfig['fast_actions_model'],
            rawConfig['fast_actions_form_model'],
            rawConfig['fast_actions_data_model']
        );
        const normalizedSchema = schema ? this.renderer.prepareFastActionsSchema(schema) : null;
        await this.tableManager.setFastActionsConfig(this.currentActionName, normalizedSchema, formModel, fastActionsRevision);
    }

    private warmActionListView(
        fields: Record<string, unknown>,
        rows: Array<Record<string, unknown>>,
        rendererRevision: number,
        listSchema: Record<string, unknown> | null,
        pageContextId: number
    ): void {
        const tableWarmup = listSchema
            ? this.tableManager.warmTableCellRenderers(rows, rendererRevision)
            : this.warmActionListFallbackSchema(rows, pageContextId);
        void Promise.allSettled([
            this.applyFastSearchConfig(fields),
            this.applyFastActionsConfig(fields),
            tableWarmup
        ]).then(() => {
            if (!this.isCurrentPageContext(pageContextId)) return;
            this.rebuildMenus();
        });
    }

    private async warmActionListFallbackSchema(
        rows: Array<Record<string, unknown>>,
        pageContextId: number
    ): Promise<void> {
        const schemaModel = this.readFirstString(this.appManager.selectedModel, this.tableManager.selectedModel);
        if (!schemaModel) return;
        this.tableManager.tableRenderLoading = true;
        try {
            const schema = await this.loadModelSchemaForActionForm(schemaModel);
            if (!schema || !this.isCurrentPageContext(pageContextId)) return;
            this.renderer.rawFormSchema = this.cloneSchema(schema);
            this.renderer.rawFormSchemaModel = schemaModel;
            this.tableManager.rawFormSchema = this.renderer.rawFormSchema;
            this.tableManager.rawFormSchemaModel = schemaModel;
            const rendererRevision = this.tableManager.prepareTableCellRenderers(rows);
            await this.tableManager.warmTableCellRenderers(rows, rendererRevision);
        } finally {
            if (this.isCurrentPageContext(pageContextId)) {
                this.tableManager.tableRenderLoading = false;
            }
        }
    }

    private async applyActionFormResponse(
        content: ResponseObjectData,
        pageContextId = this.pageContextId,
        formOriginPath = ''
    ): Promise<void> {
        this.renderer.beginFormViewerLoad();
        if (!this.isCurrentPageContext(pageContextId)) { this.renderer.cancelFormViewerLoad(); return; }
        const data = this.isRecord(content.data) ? content.data : {};
        const model = this.resolveModelName(content, this.currentActionName) || this.tableManager.selectedModel || this.appManager.selectedModel;
        if (!model) { this.renderer.cancelFormViewerLoad(); throw new Error('Model non trovato nella risposta'); }
        this.appManager.selectedModel = model;
        this.tableManager.selectedModel = model;
        this.renderer.selectedModel = model;
        const isComponentRecord = String(model).trim().toLowerCase() === 'component';
        if (isComponentRecord && !this.appManager.models.length) {
            void this.ensureModelsListLoadedForFormEditor();
        }
        let schema = this.renderer.extractFormSchema(content.schema);
        // A component record IS a formio form definition: its schema lives in content.data,
        // not in a queryable model schema (/record/component is a meta-model, returns fail).
        if (!schema && isComponentRecord) {
            schema = this.extractComponentRecordSchema(data);
        }
        if (!schema && !isComponentRecord) {
            await this.loadModelSchemaIfNeeded(model);
            if (!this.isCurrentPageContext(pageContextId)) { this.renderer.cancelFormViewerLoad(); return; }
            schema = this.renderer.rawFormSchema;
        }
        if (!schema) {
            this.renderer.cancelFormViewerLoad();
            throw new Error(`Schema non trovato per action form "${model}"`);
        }
        if (this.renderer.extractFormSchema(content.schema) || isComponentRecord) {
            this.renderer.rawFormSchema = this.cloneSchema(schema);
            this.renderer.rawFormSchemaModel = model;
            this.tableManager.rawFormSchema = this.renderer.rawFormSchema;
            this.tableManager.rawFormSchemaModel = model;
        }
        this.renderer.formSchema = null; this.renderer.formSubmission = null;
        const normalizedData = this.renderer.normalizeFormSubmissionData(data, schema);
        if (isComponentRecord && !String(content.rec_name ?? '').trim()) {
            normalizedData['title'] = '';
            normalizedData['rec_name'] = '';
        }
        const renderSchema = this.renderer.prepareSchemaForRender(this.cloneSchema(schema), normalizedData);
        this.renderer.formSchema = renderSchema;
        if (!this.isCurrentPageContext(pageContextId)) { this.renderer.cancelFormViewerLoad(); return; }
        this.renderer.seedSubmissionDefaultsIntoSchema(renderSchema, normalizedData);
        this.renderer.formSubmission = { data: normalizedData };
        const recName = content.rec_name;
        this.tableManager.selectedRecordName = recName;
        this.renderer.selectedRecordName = recName;
        const openedFromList = this.appManager.viewMode === 'list';
        this.appManager.viewMode = 'form';
        const inheritedComponentType = openedFromList && this.readFirstString(formOriginPath, this.readHistoryActionOriginPath())
            ? this.currentListComponentType
            : '';
        this.builder.syncBuilderMode(this.withCurrentActionContext(content, inheritedComponentType), normalizedData, renderSchema);
        if (!this.isCurrentPageContext(pageContextId)) return;
        this.currentFormSubmitActionPath = this.resolveSubmitActionFromFields(content.fields);
        this.currentFormSubmitNextActionPath = this.resolveSubmitNextActionFromFields(content.fields);
        this.currentFormPageTitle = content.title;
        this.tableManager.saveFastSearchStateToStorage();
        const resolvedOriginPath = this.readFirstString(formOriginPath, this.readHistoryActionOriginPath());
        this.currentFormOriginPath = resolvedOriginPath ? this.normalizeActionUrl(resolvedOriginPath) : '';
        this.currentFormAbandonActionPath = this.resolveAbandonActionFromFields(content.fields);
        this.currentFormCancelButtonVisible = this.resolveCancelButtonVisibilityFromFields(content.fields);
        this.formResponseActionButtons = this.resolveFormResponseActionButtonsFromContent(content);
        this.contextActions = this.normalizeContextActions(content.context_actions);
        this.hasContextActionsPayload = this.contextActions.length > 0;
        this.rebuildMenus();
        if (this.builder.formEditorDesignContext) {
            // Builder/editor mode renders no <formio> viewer, so onFormViewerReady never fires.
            // Mark data ready directly so context action buttons (save/update/...) are enabled.
            this.renderer.markFormDataReadyForBuilder();
        } else {
            this.renderer.scheduleRemoteSelectHydrationAfterRender(normalizedData);
        }
        this.builder.warmFormBuilderConfig();
    }

    private async loadModelSchemaIfNeeded(model: string): Promise<void> {
        if (this.renderer.rawFormSchema && this.renderer.rawFormSchemaModel === model) return;
        const schema = await this.loadModelSchemaForActionForm(model);
        if (schema) {
            this.renderer.rawFormSchema = this.cloneSchema(schema);
            this.renderer.rawFormSchemaModel = model;
            this.tableManager.rawFormSchema = this.renderer.rawFormSchema;
            this.tableManager.rawFormSchemaModel = model;
        }
    }

    private withCurrentActionContext(content: ResponseObjectData, inheritedComponentType = ''): Record<string, unknown> {
        const componentType = this.readFirstString(
            this.resolveComponentTypeFromFields(content.fields),
            inheritedComponentType
        );
        if (!componentType) return content as unknown as Record<string, unknown>;
        return {
            ...(content as unknown as Record<string, unknown>),
            fields: {
                ...content.fields,
                component_type: componentType
            }
        };
    }

    private resolveComponentTypeFromFields(fields: Record<string, unknown>): string {
        return this.readFirstString(fields['component_type'], fields['componentType']).toLowerCase();
    }

    private async loadModelSchemaForActionForm(model: string): Promise<Record<string, unknown> | null> {
        try {
            const payload = await this.api.getRecordSchema(model);
            const obj = requireResponseObject(payload);
            return this.renderer.extractFormSchema(obj.content.schema);
        } catch { return null; }
    }

    /**
     * Build the formio form schema for a `component` record (a form definition).
     * The definition lives in the record data itself (nested schema/formio object or
     * directly as components/display), so it must not depend on a model-schema lookup.
     */
    private extractComponentRecordSchema(data: Record<string, unknown>): Record<string, unknown> | null {
        const nested = this.isRecord(data['schema']) ? data['schema']
            : (this.isRecord(data['formio']) ? data['formio'] : null);
        if (nested && Array.isArray(nested['components'])) return this.cloneSchema(nested);
        const components = Array.isArray(data['components']) ? data['components'] : [];
        const display = this.readFirstString(data['display']) || 'form';
        return { display, components: [...components] };
    }

    private resolveSubmitActionFromFields(fields: Record<string, unknown>): string {
        const seq = this.asRecord(fields['action_sequence']);
        const candidates = [
            fields['submit_action'], fields['submit_action_name'],
            seq?.['submit_action'], seq?.['submit_action_name'],
            fields['next_action'], fields['next_action_name']
        ];
        for (const c of candidates) {
            const s = typeof c === 'string' && c.trim() ? c.trim() : '';
            if (s) return this.normalizeActionUrl(s.startsWith('/') ? s : `/action/${s}`);
        }
        return '';
    }

    private resolveSubmitNextActionFromFields(fields: Record<string, unknown>): string {
        const seq = this.asRecord(fields['action_sequence']);
        const candidates = [
            fields['submit_next_action'], fields['submit_next_action_name'],
            seq?.['submit_next_action'], seq?.['submit_next_action_name'],
            fields['next_page'], fields['next_path']
        ];
        for (const c of candidates) {
            const s = typeof c === 'string' && c.trim() ? c.trim() : '';
            if (s) return this.normalizeActionUrl(s.startsWith('/') ? s : `/action/${s}`);
        }
        return '';
    }

    private resolveAbandonActionFromFields(fields: Record<string, unknown>): string {
        const seq = this.asRecord(fields['action_sequence']);
        const candidates = [
            fields['abandon_action'], fields['abandon_action_name'],
            seq?.['abandon_action'], seq?.['abandon_action_name']
        ];
        for (const c of candidates) {
            const s = typeof c === 'string' && c.trim() ? c.trim() : '';
            if (s) return this.normalizeActionUrl(s.startsWith('/') ? s : `/action/${s}`);
        }
        return '';
    }

    private resolveCancelButtonVisibilityFromFields(fields: Record<string, unknown>): boolean {
        const seq = this.asRecord(fields['action_sequence']);
        const candidates: Array<Record<string, unknown> | null> = [fields, seq];
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (Object.prototype.hasOwnProperty.call(candidate, 'cancel_button')) {
                return this.toBooleanFlag(candidate['cancel_button']);
            }
            if (Object.prototype.hasOwnProperty.call(candidate, 'cancelButton')) {
                return this.toBooleanFlag(candidate['cancelButton']);
            }
        }
        return false;
    }

    private resolveFormResponseActionButtonsFromContent(content: ResponseObjectData): MenuButton[] {
        const buttons: MenuButton[] = [];
        const fields = content.fields;
        const candidates: unknown[] = [fields['buttons'], fields['actions'], fields['toolbar'], fields['toolbar_buttons'], fields['form_actions'], fields['action_buttons']];
        for (const candidate of candidates) buttons.push(...this.normalizeFormResponseButtonsCandidate(candidate));
        const deduped = this.dedupeMenuButtons(buttons).filter(button => !this.isMenuContainerButton(button));
        if (deduped.length) return deduped;
        const submitPath = this.resolveSubmitActionFromFields(fields);
        if (!submitPath) return [];
        const submitNextActionPath = this.resolveSubmitNextActionFromFields(fields);
        const submitButton = this.buildFormSubmitActionButton(submitPath, submitNextActionPath);
        return submitButton ? this.ensureCopyFormActionButton([submitButton]) : [];
    }

    private inferModelFromActionName(actionName: string): string {
        const raw = String(actionName || '').trim().toLowerCase();
        if (!raw) return '';
        const candidates = [{ prefix: 'form_form_', value: raw.slice('form_form_'.length) }, { prefix: 'form_', value: raw.slice('form_'.length) }];
        for (const candidate of candidates) {
            if (!raw.startsWith(candidate.prefix)) continue;
            const model = candidate.value.replace(/^_+|_+$/g, '').trim();
            if (model) return model;
        }
        return '';
    }

    private resolveCurrentActionName(): string {
        if (this.currentActionName) return this.currentActionName;
        if (typeof window === 'undefined') return '';
        const route = this.parseActionRoute(window.location.pathname || '/');
        if (!route) return '';
        if (route.name === 'next_action') return this.readFirstString(route.args[0]);
        return route.name;
    }

    getActiveRecName(): string {
        const fromSelection = String(this.tableManager.selectedRecordName ?? '').trim();
        if (fromSelection) return fromSelection;
        const fromForm = this.renderer.formSubmission?.data?.['rec_name'];
        return String(fromForm ?? '').trim();
    }

    private async copyCurrentRecordName(): Promise<void> {
        const recName = this.getActiveRecName();
        if (!recName) { this.setStatus('Nessun record selezionato da copiare', true); return; }
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) { this.setStatus(`Clipboard non disponibile. Record: ${recName}`, false); return; }
        try { await navigator.clipboard.writeText(recName); this.setStatus(`Record copiato: ${recName}`, false); }
        catch { this.setStatus(`Errore clipboard. Record: ${recName}`, true); }
    }

    private beginClickTransition(): void { this.beginExternalTransition(); }
    private endClickTransition(): void { this.endExternalTransition(); }

    async withClickTransition<T>(task: () => Promise<T>): Promise<T> {
        this.beginClickTransition();
        try { return await task(); } finally { this.endClickTransition(); }
    }

    private shouldLetBrowserHandle(event: MouseEvent): boolean {
        return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
    }

    private toBooleanFlag(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        }
        return Boolean(value);
    }

    private cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
    }

    private resolveActionSequenceButtons(nodes: Record<string, unknown>[]): MenuButton[] {
        if (this.tableManager.selectedRecordName) return [];
        for (const node of nodes) {
            const actionSequence = this.resolveActionSequenceMetadata(node);
            if (!actionSequence.submitActionPath) continue;
            const result: MenuButton[] = [];
            if (actionSequence.submitActionPath) { const btn = this.buildFormSubmitActionButton(actionSequence.submitActionPath, actionSequence.submitNextActionPath); if (btn) result.push(btn); }
            if (result.length) return result;
        }
        return [];
    }

    private resolveActionSequenceMetadata(node: Record<string, unknown>): { submitActionPath: string; submitNextActionPath: string } {
        const submitActionPath = this.resolveSubmitActionPath([node]);
        const submitNextActionPath = this.resolveSubmitNextActionPath([node]);
        return { submitActionPath, submitNextActionPath };
    }

    private normalizeFormResponseButtonsCandidate(candidate: unknown): MenuButton[] {
        if (Array.isArray(candidate)) return candidate.map((e, i) => this.toMenuButton(e, i, 'form', '')).filter((b): b is MenuButton => Boolean(b));
        if (!this.isRecord(candidate)) return [];
        if (Array.isArray(candidate['buttons'])) return this.normalizeFormResponseButtonsCandidate(candidate['buttons']);
        if (Array.isArray(candidate['actions'])) return this.normalizeFormResponseButtonsCandidate(candidate['actions']);
        const buttonLike = Object.prototype.hasOwnProperty.call(candidate, 'url_action') || Object.prototype.hasOwnProperty.call(candidate, 'content') || Object.prototype.hasOwnProperty.call(candidate, 'label') || Object.prototype.hasOwnProperty.call(candidate, 'action_type');
        if (!buttonLike) return [];
        const button = this.toMenuButton(candidate, 0, 'form', '');
        return button ? [button] : [];
    }

    private dedupeMenuButtons(buttons: MenuButton[]): MenuButton[] {
        const seen = new Set<string>();
        return buttons.filter(button => {
            const signature = [this.normalizeMenuType(button.action_type), this.getButtonActionPath(button), this.readFirstString(button.label, button.key)].join('|');
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
        });
    }

    private resolveSubmitActionPath(nodes: Record<string, unknown>[]): string {
        for (const node of nodes) {
            const seq = this.asRecord(node['action_sequence']);
            const candidates: unknown[] = [node['submit_action'], node['submitAction'], node['submit_action_name'], node['submitActionName'], node['next_action'], node['nextAction'], node['next_action_name'], node['nextActionName'], seq?.['submit_action'], seq?.['submitAction'], seq?.['submit_action_name'], seq?.['submitActionName'], seq?.['next_action'], seq?.['nextAction'], seq?.['next_action_name'], seq?.['nextActionName']];
            for (const candidate of candidates) { const normalized = this.normalizeFormSubmitActionCandidate(candidate); if (normalized) return normalized; }
        }
        return '';
    }

    private resolveSubmitNextActionPath(nodes: Record<string, unknown>[]): string {
        for (const node of nodes) {
            const seq = this.asRecord(node['action_sequence']);
            const candidates: unknown[] = [node['submit_next_action'], node['submitNextAction'], node['submit_next_action_name'], node['submitNextActionName'], node['next_page'], node['nextPage'], node['next_path'], node['nextPath'], seq?.['submit_next_action'], seq?.['submitNextAction'], seq?.['submit_next_action_name'], seq?.['submitNextActionName'], seq?.['next_page'], seq?.['nextPage'], seq?.['next_path'], seq?.['nextPath']];
            for (const candidate of candidates) { const normalized = this.normalizeFormSubmitActionCandidate(candidate); if (normalized) return normalized; }
        }
        return '';
    }

    private extractFormSubmitActionPath(nodes: Record<string, unknown>[]): string {
        const submitActionPath = this.resolveSubmitActionPath(nodes);
        if (submitActionPath) return submitActionPath;
        const keys = ['submit_action', 'submitAction', 'submit_action_name', 'submitActionName', 'submit_url', 'submitUrl', 'url_action_submit', 'urlActionSubmit', 'action_submit', 'actionSubmit', 'next_action', 'nextAction', 'next_action_name', 'nextActionName'];
        for (const node of nodes) { for (const key of keys) { const normalized = this.normalizeFormSubmitActionCandidate(node[key]); if (normalized) return normalized; } }
        return '';
    }

    private extractFormSubmitNextActionPath(nodes: Record<string, unknown>[]): string {
        const submitNextActionPath = this.resolveSubmitNextActionPath(nodes);
        if (submitNextActionPath) return submitNextActionPath;
        const keys = ['submit_next_action', 'submitNextAction', 'submit_next_action_name', 'submitNextActionName', 'next_page', 'nextPage', 'next_path', 'nextPath'];
        for (const node of nodes) { for (const key of keys) { const normalized = this.normalizeFormSubmitActionCandidate(node[key]); if (normalized) return normalized; } }
        return '';
    }

    private normalizeFormSubmitActionCandidate(candidate: unknown): string {
        if (this.isRecord(candidate)) {
            const directPath = this.readFirstString(candidate['url_action'], candidate['next_page'], candidate['path'], candidate['content'], candidate['url'], candidate['location']);
            if (directPath) return this.normalizeFormSubmitActionCandidate(directPath);
            const actionName = this.readFirstString(candidate['action_name'], candidate['name'], candidate['action']);
            const recName = this.readFirstString(candidate['rec_name']);
            if (actionName) return this.normalizeFormSubmitActionCandidate(recName ? `/action/${actionName}/${recName}` : `/action/${actionName}`);
            return '';
        }
        if (typeof candidate !== 'string') return '';
        let raw = candidate.trim();
        if (!raw) return '';
        raw = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
        if (!raw) return '';
        if (raw.startsWith('api/')) raw = raw.slice('api/'.length);
        if (raw.startsWith('actoin/')) raw = `action/${raw.slice('actoin/'.length)}`;
        if (raw.startsWith('dashboard')) return '/dashboard';
        if (raw.startsWith('action/')) return this.normalizeActionUrl(`/${raw}`);
        if (raw.startsWith('next_action/')) return this.normalizeActionUrl(`/action/${raw}`);
        if (raw.startsWith('action/next_action/')) return this.normalizeActionUrl(`/${raw}`);
        if (raw.startsWith('list/') || raw.startsWith('record/')) return this.normalizeActionUrl(`/${raw}`);
        return this.normalizeActionUrl(`/action/${raw}`);
    }

    private buildFormSubmitActionButton(path: string, nextActionPath = ''): MenuButton | null {
        const normalizedPath = this.normalizeFormSubmitActionCandidate(path);
        if (!normalizedPath) return null;
        const normalizedNextActionPath = this.normalizeFormSubmitActionCandidate(nextActionPath);
        return { model: this.appManager.selectedModel, key: this.tableManager.selectedRecordName || 'save', type: 'button', label: this.formEditorSaveLabel, leftIcon: 'pi pi-save', req_id: this.uiReqId, btn_action_type: 'post', action_type: 'save', url_action: normalizedPath, builder: false, mode: 'form', content: normalizedPath, menu_group: 'form', menu_type: '', is_admin: false, next_action_path: normalizedNextActionPath || undefined };
    }

    private buildFallbackFormActionButtons(): MenuButton[] {
        const actionName = this.resolveCurrentActionName();
        if (actionName && !this.tableManager.selectedRecordName) {
            const nextActionPath = `/action/next_action/${actionName}`;
            const btn = this.buildFormSubmitActionButton(nextActionPath);
            return btn ? [btn] : [];
        }
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) return [];
        const actionRoot = `/record/${encodeURIComponent(selectedModel)}`;
        const actions: MenuActionDescriptor[] = [{ model: selectedModel, rec_name: this.tableManager.selectedRecordName || 'save', title: this.formEditorSaveLabel, action_type: 'save', action_root_path: actionRoot, button_icon: 'pi pi-save', builder_enabled: false, mode: 'form' }];
        if (this.tableManager.selectedRecordName) {
            actions.push({ model: selectedModel, rec_name: this.tableManager.selectedRecordName, title: 'Copia', action_type: 'copy', action_root_path: actionRoot, button_icon: 'pi pi-copy', builder_enabled: false, mode: 'form' });
        }
        return this.makeActionButtons(actions, this.getActiveRecName());
    }

    private mergeFormResponseButtonsWithFallback(buttons: MenuButton[]): MenuButton[] {
        const fallbackButtons = this.buildFallbackFormActionButtons();
        if (!buttons.length) return fallbackButtons;
        if (!fallbackButtons.length) return buttons;
        if (this.tableManager.selectedRecordName) return buttons;
        const hasPrimarySubmit = buttons.some(button => this.isPrimaryFormSubmitButton(button));
        if (hasPrimarySubmit) return buttons;
        return this.dedupeMenuButtons([fallbackButtons[0], ...buttons]);
    }

    private finalizeFormContextActionButtons(actions: ContextAction[]): MenuButton[] {
        const filteredActions = this.currentFormCancelButtonVisible
            ? actions
            : actions.filter(action => !this.isAbandonContextAction(action));
        let result = filteredActions.map(action => this.contextActionToMenuButton(action));
        if (this.currentFormCancelButtonVisible && !result.some(button => this.isAbandonFormButton(button))) {
            const abandonButton = this.buildCurrentFormAbandonButton();
            if (abandonButton) result = [...result, abandonButton];
        }
        return this.dedupeMenuButtons(result);
    }

    private finalizeCurrentFormActionButtons(buttons: MenuButton[]): MenuButton[] {
        const showSubmit = this.readCurrentFormConfigBoolean(['no_submit', 'noSubmit']) !== true;
        let result = buttons.map(button => this.normalizeCurrentFormActionButton(button));

        if (this.currentFormCancelButtonVisible) {
            if (!result.some(button => this.isAbandonFormButton(button))) {
                const abandonButton = this.buildCurrentFormAbandonButton();
                if (abandonButton) result = [...result, abandonButton];
            }
        } else {
            result = result.filter(button => !this.isAbandonFormButton(button));
        }

        if (!showSubmit) {
            result = result.filter(button => !this.isPrimaryFormSubmitButton(button));
        } else if (!result.some(button => this.isPrimaryFormSubmitButton(button))) {
            const submitButton = this.buildCurrentFormSubmitFallbackButton();
            if (submitButton) result = [submitButton, ...result];
        }

        return this.dedupeMenuButtons(result);
    }

    private normalizeCurrentFormActionButton(button: MenuButton): MenuButton {
        if (!this.isPrimaryFormSubmitButton(button)) return button;
        // Payload context actions (Copy/Delete/Update/Salva) carry their own labels/icons: keep them.
        if (this.readFirstString(button.menu_group) === 'context') return button;
        return {
            ...button,
            label: this.formEditorSaveLabel,
            leftIcon: this.readFirstString(button.leftIcon, 'pi pi-save') || 'pi pi-save'
        };
    }

    private buildCurrentFormSubmitFallbackButton(): MenuButton | null {
        if (this.currentFormSubmitActionPath) {
            return this.buildFormSubmitActionButton(this.currentFormSubmitActionPath, this.currentFormSubmitNextActionPath);
        }
        const fallbackButtons = this.buildFallbackFormActionButtons();
        return fallbackButtons.find(button => this.isPrimaryFormSubmitButton(button)) ?? null;
    }

    private resolveCurrentFormAbandonTargetPath(fallback = ''): string {
        return this.readFirstString(
            this.currentFormOriginPath,
            this.readHistoryActionOriginPath(),
            this.currentFormAbandonActionPath,
            fallback
        );
    }

    private buildCurrentFormAbandonButton(): MenuButton | null {
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) return null;
        const actionPath = this.resolveCurrentFormAbandonTargetPath('/dashboard');
        return {
            model: selectedModel,
            key: 'abandon',
            type: 'button',
            label: 'Abbandona',
            leftIcon: 'pi pi-times',
            req_id: this.uiReqId,
            btn_action_type: false,
            action_type: 'abandon',
            url_action: actionPath,
            builder: false,
            mode: 'form',
            content: actionPath,
            menu_group: 'form',
            menu_type: '',
            is_admin: false
        };
    }

    private readCurrentFormConfigBoolean(keys: string[]): boolean | null {
        for (const source of this.collectCurrentFormConfigSources()) {
            for (const key of keys) {
                if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
                return this.toBooleanFlag(source[key]);
            }
        }
        return null;
    }

    private collectCurrentFormConfigSources(): Record<string, unknown>[] {
        const sources: Record<string, unknown>[] = [];
        if (this.isRecord(this.renderer.formSchema)) sources.push(this.renderer.formSchema);
        if (this.isRecord(this.renderer.rawFormSchema)) sources.push(this.renderer.rawFormSchema);
        return sources;
    }

    private sanitizeFormEditorActionButtons(buttons: MenuButton[]): MenuButton[] {
        const result: MenuButton[] = [];
        let submitSource: MenuButton | undefined;

        for (const button of buttons.map(entry => this.normalizeCurrentFormActionButton(entry))) {
            if (this.isFormEditorPreviewButton(button) || this.isFormEditorSelfNavigationButton(button)) continue;
            if (this.isPrimaryFormSubmitButton(button)) {
                submitSource = this.preferFormEditorSubmitSource(submitSource, button);
                continue;
            }
            result.push(button);
        }

        const saveButton = this.buildFormEditorSaveButton(submitSource);
        if (saveButton) result.unshift(saveButton);

        return this.dedupeMenuButtons(result);
    }

    private preferFormEditorSubmitSource(current: MenuButton | undefined, candidate: MenuButton): MenuButton {
        if (!current) return candidate;
        if (this.isGenericSaveLabel(current) && !this.isGenericSaveLabel(candidate)) return candidate;
        return current;
    }

    private isGenericSaveLabel(button: MenuButton): boolean {
        const label = this.readFirstString(button.label, button.key).toLowerCase();
        return ['salva', 'save'].includes(label);
    }

    private buildFormEditorSaveButton(source?: MenuButton): MenuButton | null {
        const selectedModel = this.appManager.selectedModel;
        if (!selectedModel) return null;
        return {
            model: selectedModel,
            key: this.tableManager.selectedRecordName || 'save',
            type: 'button',
            label: this.formEditorSaveLabel,
            leftIcon: this.readFirstString(source?.leftIcon, 'pi pi-save') || 'pi pi-save',
            req_id: this.uiReqId,
            btn_action_type: false,
            action_type: 'save',
            url_action: '',
            builder: false,
            mode: 'form',
            content: '',
            menu_group: 'form',
            menu_type: '',
            is_admin: false
        };
    }

    private isFormEditorPreviewButton(button: MenuButton): boolean {
        return this.matchesFormEditorAction(button, /(preview|anteprima)/);
    }

    private isFormEditorSelfNavigationButton(button: MenuButton): boolean {
        return this.matchesFormEditorAction(button, /(edit\s*form|editform)/);
    }

    private matchesFormEditorAction(button: MenuButton, pattern: RegExp): boolean {
        if (!button) return false;
        const text = [
            this.readFirstString(button.key),
            this.readFirstString(button.label),
            this.getButtonActionPath(button)
        ].join(' ').toLowerCase();
        return pattern.test(text);
    }

    private isPrimaryFormSubmitButton(button: MenuButton): boolean {
        if (!button) return false;
        const actionType = this.normalizeMenuType(button.action_type);
        if (actionType === 'save' || actionType === 'post') return true;
        const actionPath = this.getButtonActionPath(button);
        return Boolean(actionPath) && actionPath.startsWith('/action/') && this.isPostActionButton(button);
    }

    private isAbandonFormButton(button: MenuButton): boolean {
        if (!button) return false;
        const key = this.readFirstString(button.key).toLowerCase();
        if (key === 'abandon' || key === 'cancel') return true;
        const label = this.readFirstString(button.label).toLowerCase();
        if (label.includes('abbandona') || label.includes('annulla') || label.includes('cancel')) return true;
        const actionType = this.normalizeMenuType(button.action_type);
        return actionType === 'abandon' || actionType === 'cancel_button';
    }

    private normalizeContextActions(raw: unknown[]): ContextAction[] {
        if (!Array.isArray(raw)) return [];
        const actions: ContextAction[] = [];
        for (const item of raw) {
            if (!this.isRecord(item)) continue;
            const rawModes = item['context_button_mode'];
            const modes = Array.isArray(rawModes)
                ? (rawModes as unknown[]).map(m => String(m ?? '').toLowerCase().trim()).filter(Boolean)
                : typeof rawModes === 'string' && rawModes.trim()
                    ? [rawModes.trim().toLowerCase()]
                    : [];
            actions.push({
                rec_name: this.readFirstString(item['rec_name'] as string),
                action_type: this.readFirstString(item['action_type'] as string),
                label: this.readFirstString(item['label'] as string),
                button_icon: this.readFirstString(item['button_icon'] as string),
                modal: Boolean(item['modal']),
                context_button_mode: modes,
                url_action: this.readFirstString(item['url_action'] as string)
            });
        }
        return actions;
    }

    contextActionToMenuButtonPublic(action: ContextAction): MenuButton { return this.contextActionToMenuButton(action); }

    private contextActionToMenuButton(action: ContextAction): MenuButton {
        const isAbandon = this.isAbandonContextAction(action);
        const urlAction = isAbandon ? this.resolveCurrentFormAbandonTargetPath() : action.url_action;
        // abandon / window / cancel_button actions: navigate without POST.
        const isNavigate = isAbandon || action.action_type === 'abandon' || action.action_type === 'window' || action.action_type === 'cancel_button';
        // Backend ships context actions as action_type "menu" with a runnable /action/<name> path.
        // Those are clickable actions (not menu containers): POST the current submission to the endpoint.
        const normalizedUrl = this.normalizeActionUrl(this.readFirstString(urlAction) || '/');
        const isRunnablePost = !isNavigate && normalizedUrl.startsWith('/action/');
        const resolvedActionType = isRunnablePost ? 'post' : action.action_type;
        return {
            model: this.appManager.selectedModel,
            key: action.rec_name,
            type: 'button',
            label: action.label,
            leftIcon: action.button_icon,
            req_id: this.uiReqId,
            btn_action_type: isNavigate ? false : 'post',
            action_type: resolvedActionType,
            url_action: urlAction,
            builder: false,
            mode: action.context_button_mode.includes('list') && !action.context_button_mode.includes('form') ? 'list' : 'form',
            content: urlAction,
            menu_group: 'context',
            menu_type: '',
            is_admin: false
        };
    }

    private isAbandonContextAction(action: ContextAction): boolean {
        return this.isAbandonFormButton({
            model: '',
            key: action.rec_name,
            type: 'button',
            label: action.label,
            leftIcon: action.button_icon,
            req_id: '',
            btn_action_type: false,
            action_type: action.action_type,
            url_action: action.url_action,
            builder: false
        });
    }

    private ensureCopyFormActionButton(buttons: MenuButton[]): MenuButton[] {
        if (!this.tableManager.selectedRecordName || !buttons.length) return buttons;
        const hasCopyButton = buttons.some(button => {
            const actionType = this.normalizeMenuType(button.action_type);
            if (actionType === 'copy') return true;
            const label = this.readFirstString(button.label).toLowerCase();
            return label.includes('copia') || label.includes('copy');
        });
        if (hasCopyButton) return buttons;
        const copyButton = this.makeActionButtons([{ model: this.appManager.selectedModel, rec_name: this.tableManager.selectedRecordName, title: 'Copia', action_type: 'copy', action_root_path: `/record/${encodeURIComponent(this.appManager.selectedModel)}`, button_icon: 'pi pi-copy', builder_enabled: false, mode: 'form' }], this.getActiveRecName())[0];
        return copyButton ? [...buttons, copyButton] : buttons;
    }
}
