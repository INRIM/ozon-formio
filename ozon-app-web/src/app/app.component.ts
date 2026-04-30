import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NgxAngularQueryBuilderModule, QueryBuilderConfig, Rule, RuleSet } from 'ngx-angular-query-builder';
import { FormioForm, FormioModule } from '@formio/angular';
import { ButtonModule } from 'primeng/button';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TableLazyLoadEvent, TableModule, TableRowReorderEvent } from 'primeng/table';
import { ActionRouterResponse, ListRequestPayload, RemoteSelectRequestPayload, RuntimeAuthMode, RuntimeConfig } from './models/ozon.types';
import { OzonApiService } from './core/ozon-api.service';
import { MainManagerService } from './core/main-manager.service';
import { BackendAuthService } from './core/backend-auth.service';

interface TableColumn {
    field: string;
    title: string;
}

interface TableRow extends Record<string, unknown> {
    __rowid: number;
    __rec_name: string;
}

interface SelectValueOption {
    label: string;
    value: unknown;
}

type QueryMode = 'builder' | 'json';

interface MenuActionDescriptor {
    model: string;
    rec_name: string;
    title: string;
    action_type: 'save' | 'copy' | 'delete' | 'window';
    action_root_path: string;
    button_icon: string;
    builder_enabled: boolean;
    mode?: 'form' | 'list';
    content?: string;
    number?: number;
}

interface MenuButton {
    model: string;
    key: string;
    type: 'button';
    label: string;
    leftIcon: string;
    authtoken: string;
    req_id: string;
    btn_action_type: 'post' | false | undefined;
    action_type: string;
    url_action: string;
    builder: boolean;
    mode?: string;
    content?: string;
    number?: number;
    menu_group?: string;
    menu_type?: string;
    is_admin?: boolean;
}

interface MenuCard {
    model: string;
    group_id: string;
    title: string;
    buttons: MenuButton[];
    menu_type?: string;
    is_admin?: boolean;
    parent?: string;
}

interface MenuDrillDownGroup {
    group_id: string;
    title: string;
    buttons: MenuButton[];
}

type ThemeMode = 'light' | 'dark';
type AppViewMode = 'dashboard' | 'list' | 'form';

const THEME_STORAGE_KEY = 'ozon-app-web.theme';
const BUILDER_STORAGE_KEY = 'ozon-app-web.builder';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, FormsModule, FormioModule, TableModule, ButtonModule, InputSwitchModule, NgxAngularQueryBuilderModule],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
    backendUrl = '';
    baseToken = '';
    authMode: RuntimeAuthMode = 'keycloak';
    private unauthorizedSub?: Subscription;
    private redirectingToLogin = false;

    models: string[] = [];
    selectedModel = '';

    queryText = '{}';
    queryMode: QueryMode = 'builder';
    queryBuilderRules: RuleSet = { condition: 'and', rules: [] };
    queryBuilderConfig: QueryBuilderConfig = {
        fields: {
            rec_name: { name: 'Record', type: 'string' }
        }
    };
    skip = 0;
    limit = 20;
    order = 'rec_name asc';

    selectedRecordName = '';
    statusText = '';
    statusError = false;
    streamCount = 0;

    rawFormSchema: Record<string, unknown> | null = null;
    formSchema: Record<string, unknown> | null = null;
    formSubmission: { data: Record<string, unknown> } | null = null;
    themeMode: ThemeMode = 'light';

    tableColumns: TableColumn[] = [{ field: '__rec_name', title: 'Record' }];
    tableRows: TableRow[] = [];
    selectedRows: TableRow[] = [];
    tableCalledInsideForm = false;
    tableCopyEnabled = false;
    tableRemoveEnabled = false;
    tableCopyActionPath = '';
    tableRemoveActionPath = '';
    filterText = '';
    primeSortField = 'rec_name';
    primeSortOrder = 1;
    currentPageIndex = 0;
    tableTotalRecords = 0;
    dashboardMenu: MenuCard[] = [];
    dashboardCards: MenuCard[] = [];
    contextualActions: MenuButton[] = [];
    layoutName = '';
    layoutSchema: Record<string, unknown> | null = null;
    appModuleName = 'Mci Service';
    appVersion = '';
    appLogoUrl = '';
    currentUserName = 'Utente';
    userAvatarUrl = '';
    isAdminUser = false;
    builderFeatureEnabled = false;
    viewMode: AppViewMode = 'dashboard';
    builderEnabled = false;
    builderMode = false;
    openedNavMenuGroup = '';
    userMenuOpen = false;
    activeDashboardGroup = '';
    builderSchemaDraft: Record<string, unknown> | null = null;
    builderEligibleCurrentForm = false;
    currentActionName = '';
    isTransitionLoading = false;
    readonly formBuilderConfig: Record<string, unknown> = {
        noDefaultSubmitButton: true
    };

    private tableColumnsInitialized = false;
    private rawFormSchemaModel = '';
    private serverColumns: TableColumn[] | null = null;
    private strictHeaderColumns = true;
    private rowCounter = 0;
    private allRows: TableRow[] = [];
    private rowBuffer: TableRow[] = [];
    private flushTimer: any = null;
    private lastColumnsRaw = '';
    private isLoadingRecords = false;
    private transitionLoadingCount = 0;
    private readonly defaultPageSizeOptions = [10, 20, 30, 50];
    private readonly btnActionParser: Record<string, 'post' | false> = {
        save: 'post',
        copy: 'post',
        delete: 'post',
        window: false
    };
    private readonly responseWrappers: Array<'content' | 'payload' | 'response' | 'result' | 'action'> = [
        'content',
        'payload',
        'response',
        'result',
        'action'
    ];
    private readonly uiReqId = `req_${Math.random().toString(36).slice(2)}`;
    private remoteSelectCache = new Map<string, SelectValueOption[]>();
    private remoteSelectInflight = new Map<string, Promise<SelectValueOption[]>>();
    private tableRenderSchema: Record<string, unknown> | null = null;
    private tableCellRenderers = new Map<string, (value: unknown) => string>();
    private tableFieldRendererCache = new Map<string, ((value: unknown) => string) | null>();
    private lastQuerySignature = '';
    private actionMenuIntegrated = false;
    private actionRouterActive = false;
    private listQuerySeed: Record<string, unknown> | null = null;
    private isRefreshingDependentSelects = false;
    private sessionAppSettings: Record<string, unknown> = {};
    private sessionLocale = 'it';
    private sessionTimezone = '';
    private initialBuilderPreference = false;
    private userNameSource: 'default' | 'session' | 'layout' = 'default';
    private readonly onPopState = () => { void this.handleLocationRoute(false); };
    private isPopStateRegistered = false;
    private backendSessionReady = false;

    constructor(
        private readonly api: OzonApiService,
        private readonly mainManager: MainManagerService,
        private readonly backendAuth: BackendAuthService
    ) {}

    ngOnInit(): void {
        this.initializeTheme();
        this.initializeBuilderPreference();
        const config = this.api.getRuntimeConfig();
        this.applyRuntime(config);
        this.onQueryBuilderChanged();
        this.unauthorizedSub = this.api.unauthorized$.subscribe(() => {
            if (this.redirectingToLogin) return;
            this.redirectingToLogin = true;
            this.login();
        });
        void this.initializeApplication();
    }

    ngOnDestroy(): void {
        this.unauthorizedSub?.unsubscribe();
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (typeof window !== 'undefined' && this.isPopStateRegistered) {
            window.removeEventListener('popstate', this.onPopState);
            this.isPopStateRegistered = false;
        }
    }

    private async bootstrapSessionAndRoute(preloadedSession?: unknown): Promise<void> {
        await this.loadSession(preloadedSession);
        await this.bootstrapAppData();
        await this.handleLocationRoute(true);
        this.backendSessionReady = true;
        this.redirectingToLogin = false;
        if (typeof window !== 'undefined' && !this.isPopStateRegistered) {
            window.addEventListener('popstate', this.onPopState);
            this.isPopStateRegistered = true;
        }
    }

    private async bootstrapAppData(): Promise<void> {
        const initialPath = typeof window !== 'undefined'
            ? this.normalizeActionUrl(window.location.pathname || '/')
            : '/';
        const shouldPreloadDashboard = !initialPath.startsWith('/action/');
        try {
            await this.loadActionLayout();
            if (!this.actionMenuIntegrated) {
                await this.loadActionMenu();
            }
            if (shouldPreloadDashboard) {
                await this.loadActionDashboard();
            }
        } catch {
            await this.loadModels();
        }
    }

    get selectedInfo(): string {
        return this.selectedRecordName ? `Record selezionato: ${this.selectedRecordName}` : 'Nessun record selezionato';
    }

    get canOpenRecord(): boolean {
        return Boolean(this.selectedModel && this.selectedRecordName);
    }

    get canOpenNewRecord(): boolean {
        return Boolean(this.resolveCurrentActionName());
    }

    get currentThemeLabel(): string {
        return this.themeMode === 'dark' ? 'Scuro' : 'Chiaro';
    }

    get topMenuCards(): MenuCard[] {
        return this.dashboardMenu.filter(card => this.builderEnabled || !this.isAdminMenuCard(card));
    }

    get showTopMenu(): boolean {
        return this.builderEnabled;
    }

    get showHomeButton(): boolean {
        return this.backendSessionReady;
    }

    get showLoginButton(): boolean {
        return !this.backendSessionReady;
    }

    get showLogoutButton(): boolean {
        return this.backendSessionReady;
    }

    get nonAdminDashboardCards(): MenuCard[] {
        return this.dashboardCards.filter(card => !this.isAdminMenuCard(card));
    }

    get selectedTopMenuCard(): MenuCard | null {
        if (!this.topMenuCards.length) return null;
        const selected = this.topMenuCards.find(card => card.group_id === this.activeDashboardGroup);
        return selected ?? this.topMenuCards[0];
    }

    get dashboardTitle(): string {
        const selected = this.selectedTopMenuCard;
        return selected ? selected.title : (this.layoutName || 'Dashboard');
    }

    get showFormBuilder(): boolean {
        return this.builderEnabled && this.builderMode && Boolean(this.builderSchemaDraft);
    }

    get canEditCurrentForm(): boolean {
        return (
            this.builderEnabled
            && this.isFormPage
            && this.builderEligibleCurrentForm
            && Boolean(this.builderSchemaDraft || this.formSchema)
            && !this.showFormBuilder
        );
    }

    get brandTitle(): string {
        return this.appModuleName || 'Mci Service';
    }

    get brandSubtitle(): string {
        const layout = this.layoutName || 'standard';
        const version = this.appVersion ? ` | ${this.appVersion}` : '';
        return `Layout ${layout}${version}`;
    }

    get userDisplayName(): string {
        return this.currentUserName || 'Utente';
    }

    get showBuilderToggle(): boolean {
        return this.isAdminUser;
    }

    get isDashboardPage(): boolean {
        return this.viewMode === 'dashboard';
    }

    get isListPage(): boolean {
        return this.viewMode === 'list';
    }

    get isFormPage(): boolean {
        return this.viewMode === 'form';
    }

    get userInitials(): string {
        const text = this.userDisplayName
            .split(/\s+/)
            .map(entry => entry.trim())
            .filter(Boolean)
            .slice(0, 2)
            .map(entry => entry.charAt(0).toUpperCase())
            .join('');
        return text || 'U';
    }

    get logoFallbackText(): string {
        const text = this.brandTitle
            .replace(/[^A-Za-z0-9 ]+/g, ' ')
            .split(/\s+/)
            .map(entry => entry.trim())
            .filter(Boolean)
            .slice(0, 2)
            .map(entry => entry.charAt(0).toUpperCase())
            .join('');
        return text || 'LOGO';
    }

    get builderSchemaForm(): FormioForm | undefined {
        return this.builderSchemaDraft ? (this.builderSchemaDraft as FormioForm) : undefined;
    }

    get builderSwitchLabel(): string {
        return this.builderEnabled ? 'ON' : 'OFF';
    }

    menuDrilldownGroups(card: MenuCard): MenuDrillDownGroup[] {
        if (!card || !Array.isArray(card.buttons) || !card.buttons.length) return [];
        const groups = new Map<string, MenuDrillDownGroup>();
        card.buttons.forEach((button, index) => {
            if (this.isMenuContainerButton(button)) return;
            const groupId = this.readFirstString(button.menu_group, card.group_id, `group_${index}`);
            if (!groupId) return;
            const existing = groups.get(groupId);
            if (!existing) {
                groups.set(groupId, {
                    group_id: groupId,
                    title: this.readFirstString(
                        groupId === card.group_id ? card.title : '',
                        button.menu_group,
                        this.humanizeModelLabel(groupId),
                        groupId
                    ),
                    buttons: [button]
                });
                return;
            }
            existing.buttons.push(button);
        });
        return [...groups.values()];
    }

    get isDarkTheme(): boolean {
        return this.themeMode === 'dark';
    }

    get tableColumnCount(): number {
        return this.tableColumns.length || 1;
    }

    get showTableRowCopyAction(): boolean {
        return this.tableCalledInsideForm && this.tableCopyEnabled;
    }

    get showTableRowRemoveAction(): boolean {
        return this.tableCalledInsideForm && this.tableRemoveEnabled;
    }

    get tableActionColumnCount(): number {
        return Number(this.showTableRowCopyAction) + Number(this.showTableRowRemoveAction);
    }

    get tableExtraColumnCount(): number {
        return 2 + this.tableActionColumnCount;
    }

    get pageSize(): number {
        return this.getPageSize();
    }

    get pageSizeOptions(): number[] {
        const pageSize = this.getPageSize();
        const options = [...this.defaultPageSizeOptions];
        if (!options.includes(pageSize)) {
            options.push(pageSize);
        }
        return options.sort((left, right) => left - right);
    }

    trackRowBy(_index: number, row: TableRow): number {
        return row.__rowid;
    }

    trackColumnBy(_index: number, column: TableColumn): string {
        return column.field;
    }

    displayCell(row: TableRow, field: string): string {
        const value = this.resolveFieldValue(row, field);
        const renderer = this.resolveTableCellRenderer(field);
        if (renderer) return renderer(value);
        return this.toDisplayValue(value);
    }

    setQueryMode(mode: QueryMode): void {
        this.queryMode = mode;
    }

    onQueryBuilderChanged(): void {
        if (this.queryMode !== 'builder') return;
        const query = this.queryBuilderToBackend(this.queryBuilderRules);
        this.queryText = JSON.stringify(query, null, 2);
    }

    resetQueryBuilderRules(): void {
        this.queryBuilderRules = { condition: 'and', rules: [] };
        this.onQueryBuilderChanged();
    }

    onFilterChanged(): void {
        this.refreshTableRows();
    }

    onThemeSwitchChanged(isDark: boolean): void {
        this.setTheme(isDark ? 'dark' : 'light', true);
    }

    toggleUserMenu(): void {
        this.userMenuOpen = !this.userMenuOpen;
    }

    onBuilderSwitchChanged(enabled: boolean): void {
        this.setBuilderEnabled(enabled, true);
    }

    enableFormBuilderMode(): void {
        if (!this.canEditCurrentForm) return;
        if (!this.builderSchemaDraft) {
            if (!this.formSchema) {
                this.setStatus('Schema non disponibile per Form Builder', true);
                return;
            }
            this.builderSchemaDraft = this.cloneSchema(this.formSchema);
        }
        this.builderMode = true;
        this.applyBuilderDraftToSubmission();
        this.setStatus('Form Builder attivato', false);
    }

    disableFormBuilderMode(): void {
        if (!this.builderMode) return;
        this.builderMode = false;
        this.setStatus('Form Viewer attivato', false);
    }

    openTopMenu(card: MenuCard): void {
        if (!card?.group_id) return;
        this.activeDashboardGroup = card.group_id;
        this.openedNavMenuGroup = this.openedNavMenuGroup === card.group_id ? '' : card.group_id;
    }

    closeTopMenu(): void {
        this.openedNavMenuGroup = '';
    }

    async runTopMenuAction(button: MenuButton): Promise<void> {
        await this.withClickTransition(async () => {
            await this.runMenuAction(button);
            this.closeTopMenu();
        });
    }

    async resetNavigation(): Promise<void> {
        await this.withClickTransition(async () => {
            this.closeTopMenu();
            this.userMenuOpen = false;
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
            await this.runMenuAction(button);
        });
    }

    async onFormSubmissionChanged(event: unknown): Promise<void> {
        const eventRecord = this.asRecord(event);
        const submissionData = this.extractChangeEventSubmissionData(eventRecord);
        if (submissionData) {
            this.mergeSubmissionData(submissionData);
        }
        const changedKey = this.extractChangedComponentKey(eventRecord);
        if (!changedKey) return;
        await this.refreshDependentSelectComponents(changedKey);
    }

    login(): void {
        if (!this.isKeycloakAuthEnabled()) return;
        this.userMenuOpen = false;
        this.setStatus('Reindirizzamento al login Keycloak...', false);
        const result = this.mainManager.hardReloadToUrl(this.backendAuth.getLoginUrl());
        if (result.reloaded) return;
        if (result.blocked) {
            this.setStatus(`Login bloccato verso origine non consentita: ${result.targetUrl}`, true);
            return;
        }
        this.setStatus('Endpoint login non valido', true);
    }

    logout(): void {
        this.userMenuOpen = false;
        if (this.isKeycloakAuthEnabled()) {
            const logoutResult = this.backendAuth.logout();
            this.applyRuntime(this.api.getRuntimeConfig());
            this.resetClientSessionState('Sessione chiusa, reindirizzamento logout...');
            const navigation = this.mainManager.hardReloadToUrl(logoutResult.redirectUrl);
            if (navigation.reloaded) return;
            if (navigation.blocked) {
                this.setStatus(`Logout bloccato verso origine non consentita: ${navigation.targetUrl}`, true);
                return;
            }
            this.setStatus('Sessione chiusa', false);
            return;
        }
        this.resetClientSessionState('Sessione chiusa');
    }

    private resetClientSessionState(statusMessage: string): void {
        this.baseToken = '';
        this.formSchema = null;
        this.rawFormSchema = null;
        this.rawFormSchemaModel = '';
        this.formSubmission = null;
        this.clearTableCellRenderers();
        this.builderSchemaDraft = null;
        this.builderMode = false;
        this.builderEligibleCurrentForm = false;
        this.dashboardMenu = [];
        this.dashboardCards = [];
        this.contextualActions = [];
        this.selectedModel = '';
        this.selectedRecordName = '';
        this.currentUserName = 'Utente';
        this.userAvatarUrl = '';
        this.sessionLocale = 'it';
        this.sessionTimezone = '';
        this.isAdminUser = false;
        this.builderFeatureEnabled = false;
        this.userNameSource = 'default';
        this.viewMode = 'dashboard';
        this.currentActionName = '';
        this.actionMenuIntegrated = false;
        this.actionRouterActive = false;
        this.userMenuOpen = false;
        this.backendSessionReady = false;
        this.resetTableRowActionsConfig();
        this.resetSelectionAndTable();
        this.setStatus(statusMessage, false);
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/dashboard');
        }
    }

    onTableLazyLoad(event: TableLazyLoadEvent): void {
        const previousSkip = this.skip;
        const previousLimit = this.limit;
        const previousOrder = this.order;

        const first = Number(event.first ?? this.skip);
        const rows = Number(event.rows ?? this.limit);

        if (Number.isFinite(first) && first >= 0) this.skip = first;
        if (Number.isFinite(rows) && rows > 0) this.limit = rows;

        this.currentPageIndex = this.computeCurrentPageIndex();
        this.syncOrderFromLazyEvent(event);

        const hasQueryChange = this.skip !== previousSkip || this.limit !== previousLimit || this.order !== previousOrder;

        if (!this.selectedModel || !hasQueryChange || this.isLoadingRecords) return;

        void this.loadRecords(true);
    }

    onTableRowClick(row: TableRow, event: Event): void {
        if ((event.target as HTMLElement | null)?.closest('button, .p-checkbox, .pi-bars')) return;
        this.selectedRecordName = String(row.__rec_name ?? '');
        this.selectedRows = [row];
        this.rebuildMenus();
    }

    async onTableRowDblClick(row: TableRow, event: Event): Promise<void> {
        if ((event.target as HTMLElement | null)?.closest('button, .p-checkbox, .pi-bars')) return;
        this.selectedRecordName = String(row.__rec_name ?? '');
        this.selectedRows = [row];
        this.rebuildMenus();
        await this.openRecordFromListSelection();
    }

    onTableSelectionChange(value: unknown): void {
        const resolved = this.isRecord(value) && Array.isArray(value['value']) ? value['value'] : value;
        const rows = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
        const normalized = rows
            .filter((row): row is TableRow => this.isRecord(row))
            .map(row => row as TableRow);
        this.selectedRows = normalized;
        this.selectedRecordName = String(normalized[0]?.__rec_name ?? '').trim();
        this.rebuildMenus();
    }

    async onCopyRow(row: TableRow, event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.showTableRowCopyAction) {
            this.setStatus('Azione copia non disponibile per questa tabella', true);
            return;
        }
        const recName = String(row.__rec_name ?? '').trim();
        if (!recName) {
            this.setStatus('Record non valido: impossibile copiare', true);
            return;
        }
        if (await this.executeTableRowServerAction(this.tableCopyActionPath, row, 'copia')) {
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(recName);
                this.setStatus(`Record copiato: ${recName}`, false);
            } catch {
                this.setStatus(`Errore clipboard. Record: ${recName}`, true);
            }
        } else {
            this.setStatus(`Clipboard non disponibile. Record: ${recName}`, false);
        }
    }

    async onRemoveRow(row: TableRow, event: Event): Promise<void> {
        event.stopPropagation();
        if (!this.showTableRowRemoveAction) {
            this.setStatus('Azione rimuovi non disponibile per questa tabella', true);
            return;
        }
        if (await this.executeTableRowServerAction(this.tableRemoveActionPath, row, 'rimozione')) {
            return;
        }
        const rowId = Number(row.__rowid);
        if (!Number.isFinite(rowId)) return;
        this.allRows = this.allRows.filter((entry) => entry.__rowid !== rowId);
        this.selectedRows = this.selectedRows.filter((entry) => entry.__rowid !== rowId);
        if (this.selectedRecordName === String(row.__rec_name ?? '')) this.selectedRecordName = '';
        this.refreshTableRows();
        this.tableTotalRecords = Math.max(0, this.tableTotalRecords - 1);
        this.rebuildMenus();
        this.setStatus(`Record rimosso dalla vista: ${row.__rec_name ?? rowId}`, false);
    }

    private async executeTableRowServerAction(rawActionPath: string, row: TableRow, actionLabel: string): Promise<boolean> {
        const recName = String(row.__rec_name ?? '').trim();
        if (!recName) return false;
        const actionPath = this.resolveTableRowActionPath(rawActionPath, recName);
        if (!actionPath) return false;
        this.setStatus(`Eseguo ${actionLabel} record "${recName}"...`, false);
        try {
            await this.runPathAction(actionPath);
            return true;
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            return true;
        }
    }

    private resolveTableRowActionPath(rawActionPath: string, recName: string): string {
        const raw = this.readFirstString(rawActionPath);
        if (!raw) return '';
        const encodedRecName = encodeURIComponent(recName);
        let resolved = raw;
        const placeholderPatterns = [
            /\{\{\s*rec_name\s*\}\}/gi,
            /\{\s*rec_name\s*\}/gi,
            /<\s*rec_name\s*>/gi,
            /:rec_name\b/gi,
            /\$rec_name\b/gi
        ];
        placeholderPatterns.forEach((pattern) => {
            resolved = resolved.replace(pattern, encodedRecName);
        });

        let normalized = this.normalizeNextActionRedirectCandidate(resolved);
        if (!normalized) normalized = this.normalizeActionUrl(resolved);
        if (!normalized) return '';
        if (this.shouldAppendRowRecNameToActionPath(normalized, recName, encodedRecName)) {
            return this.appendRecNameToActionPath(normalized, encodedRecName);
        }
        return normalized;
    }

    private shouldAppendRowRecNameToActionPath(path: string, recName: string, encodedRecName: string): boolean {
        if (!recName || !path.startsWith('/action/')) return false;
        const [basePath] = path.split('?', 2);
        const decodedPath = decodeURIComponent(basePath);
        if (decodedPath.endsWith(`/${recName}`) || basePath.endsWith(`/${encodedRecName}`)) return false;

        const segments = basePath
            .split('/')
            .map(entry => entry.trim())
            .filter(Boolean);
        if (segments.length < 2) return false;
        const actionName = String(segments[1] ?? '').toLowerCase();
        if (actionName === 'layout' || actionName === 'menu' || actionName === 'dashboard') return false;
        if (actionName === 'next_action') {
            return segments.length === 3;
        }
        return segments.length === 2;
    }

    private appendRecNameToActionPath(path: string, encodedRecName: string): string {
        const [basePath, queryString] = path.split('?', 2);
        const withRec = this.normalizeActionUrl(`${basePath}/${encodedRecName}`);
        return queryString ? `${withRec}?${queryString}` : withRec;
    }

    private async runPathAction(path: string): Promise<void> {
        const normalized = this.normalizeNextActionRedirectCandidate(path);
        if (!normalized) throw new Error(`Azione non valida: ${path}`);
        if (normalized === '/dashboard' || normalized.startsWith('/action/')) {
            await this.navigateToPath(normalized);
            return;
        }
        await this.runWindowPath(normalized);
    }

    onRowReorder(event: TableRowReorderEvent): void {
        if (this.filterText.trim()) {
            this.setStatus('Disattiva il filtro prima di riordinare le righe', true);
            return;
        }
        const from = Number(event.dragIndex);
        const to = Number(event.dropIndex);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
        const rows = [...this.allRows];
        const moved = rows.splice(from, 1)[0];
        if (!moved) return;
        rows.splice(to, 0, moved);
        this.allRows = [...rows];
        this.refreshTableRows();
        this.setStatus('Ordine righe aggiornato (solo vista corrente)', false);
    }

    async saveConnectionSettings(): Promise<void> {
        const updated = this.api.updateRuntimeConfig({
            backendUrl: this.backendUrl,
            useProxy: true
        });
        this.applyRuntime(updated);
        this.setStatus('Configurazione aggiornata', false);
        await this.loadModels();
    }

    async loadModels(): Promise<void> {
        if (!this.canAttemptBackendCalls()) {
            this.setStatus('Sessione Keycloak non attiva: usa Login prima di chiamare il server.', true);
            return;
        }
        this.setStatus('Caricamento modelli...', false);
        try {
            this.models = await this.api.getModels();
            if (!this.models.includes(this.selectedModel)) this.selectedModel = '';
            this.resetSelectionAndTable();
            this.rebuildMenus();
            this.setStatus(`Modelli caricati: ${this.models.length}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async loadActionLayout(name = ''): Promise<void> {
        this.setStatus('Caricamento layout...', false);
        try {
            const response = await this.api.getActionLayout(name);
            this.applyLayoutResponse(response);
            if (!this.actionMenuIntegrated) {
                await this.loadActionMenu();
            }
            this.setStatus(`Layout caricato: ${this.layoutName || 'default'}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    async loadActionMenu(parent = ''): Promise<void> {
        this.setStatus('Caricamento menu...', false);
        try {
            const response = await this.api.getActionMenu(parent);
            this.applyMenuResponse(response);
            this.setStatus(`Menu caricato: ${this.dashboardMenu.length} gruppi`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    async loadActionDashboard(parent = ''): Promise<void> {
        this.setStatus('Caricamento dashboard...', false);
        try {
            const response = await this.api.getActionDashboard(parent);
            this.applyDashboardResponse(response);
            this.currentActionName = '';
            this.viewMode = 'dashboard';
            this.setStatus(`Dashboard caricata: ${this.dashboardCards.length} card`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
            throw error;
        }
    }

    private async loadSession(preloadedPayload?: unknown): Promise<void> {
        try {
            const payload = preloadedPayload ?? await this.api.getSession();
            const session = this.extractSessionRecord(payload);
            if (!session) return;

            const user = this.isRecord(session['user']) ? session['user'] : {};
            this.sessionLocale = this.resolveSessionLocale(session);
            this.sessionTimezone = this.resolveSessionTimezone(session);
            const sessionUserName = this.resolveSessionUserName(session);
            if (sessionUserName) {
                this.currentUserName = sessionUserName;
                this.userNameSource = 'session';
            }
            this.userAvatarUrl = this.readFirstString(user['avatar'], this.userAvatarUrl);

            this.isAdminUser = this.resolveSessionAdminFlag(session);
            this.builderFeatureEnabled = this.isAdminUser;

            this.sessionAppSettings = this.extractSessionSettings(session);
            this.applySessionSettings(this.sessionAppSettings);
            this.setBuilderEnabled(this.initialBuilderPreference, false);
        } catch {
            this.sessionLocale = 'it';
            this.sessionTimezone = '';
            this.isAdminUser = false;
            this.builderFeatureEnabled = false;
            this.setBuilderEnabled(false, false);
        }
    }

    private async handleLocationRoute(replaceRoot: boolean): Promise<void> {
        if (typeof window === 'undefined') return;
        const path = this.normalizeActionUrl(window.location.pathname || '/');
        if (path === '/') {
            await this.navigateToPath('/dashboard', true);
            return;
        }
        if (path === '/dashboard') {
            this.currentActionName = '';
            this.viewMode = 'dashboard';
            return;
        }
        if (path.startsWith('/action/')) {
            await this.runActionRoute(path);
            return;
        }
        if (replaceRoot) {
            await this.navigateToPath('/dashboard', true);
        }
    }

    private async navigateToPath(path: string, replace = false): Promise<void> {
        const normalized = this.normalizeActionUrl(path || '/dashboard');
        if (typeof window !== 'undefined') {
            const current = this.normalizeActionUrl(window.location.pathname || '/');
            if (replace || current !== normalized) {
                if (replace) window.history.replaceState({}, '', normalized);
                else window.history.pushState({}, '', normalized);
            }
        }
        if (normalized === '/dashboard' || normalized === '/') {
            try {
                await this.loadActionDashboard();
            } catch {
                // status already set by loader
            }
            this.currentActionName = '';
            this.viewMode = 'dashboard';
            this.closeTopMenu();
            return;
        }
        if (normalized.startsWith('/action/')) {
            await this.runActionRoute(normalized);
            this.closeTopMenu();
            return;
        }
        this.viewMode = 'dashboard';
    }

    async loadSchema(): Promise<void> {
        if (!this.selectedModel) {
            this.setStatus('Seleziona un model', true);
            return;
        }
        this.setStatus('Caricamento schema...', false);
        try {
            const payload = await this.api.getRecordSchema(this.selectedModel);
            const schema = this.extractSchema(payload);
            if (!schema) throw new Error(`Schema Formio non trovato per model "${this.selectedModel}"`);
            this.rawFormSchema = this.cloneSchema(schema);
            this.rawFormSchemaModel = this.selectedModel;
            this.formSchema = null;
            this.formSubmission = null;
            this.formSchema = await this.hydrateRemoteSelectSchema(schema, null);
            await this.refreshTableCellRenderers(this.allRows);
            this.rebuildMenus();
            this.setStatus(`Schema caricato: ${this.selectedModel}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async loadRecords(preservePaginatorState = false): Promise<void> {
        if (!this.selectedModel || this.isLoadingRecords) return;
        const query = this.parseQueryInput();
        if (!query) return;
        this.resetTableRowActionsConfig();
        const querySignature = this.stableStringify({
            model: this.selectedModel,
            query,
            order: this.order,
            limit: this.limit
        });
        if (!preservePaginatorState && this.lastQuerySignature && this.lastQuerySignature !== querySignature) {
            this.skip = 0;
            this.currentPageIndex = 0;
        }
        const payload: ListRequestPayload = {
            query,
            skip: Number.isFinite(this.skip) && this.skip >= 0 ? this.skip : 0,
            limit: Number.isFinite(this.limit) && this.limit > 0 ? this.limit : 20,
            order: (this.order || 'rec_name asc').trim() || 'rec_name asc'
        };
        this.isLoadingRecords = true;
        this.resetSelectionAndTable({ preservePaginationState: preservePaginatorState, preserveFilterText: preservePaginatorState });
        this.strictHeaderColumns = true;
        this.setStatus('Caricamento record (stream)...', false);
        this.currentPageIndex = this.computeCurrentPageIndex();
        this.syncPrimeSortFromOrder(this.order);
        try {
            const streamed = await this.api.streamList(
                this.selectedModel,
                payload,
                (item: unknown) => { this.streamCount += 1; this.appendRecordRow(item); },
                (meta) => {
                    this.lastColumnsRaw = String(meta.columnsRaw ?? '');
                    this.strictHeaderColumns = Boolean(String(meta.columnsRaw ?? '').trim());
                    this.applyTableColumnsFromHeader(meta.columns);
                }
            );
            this.flushRows();
            await this.refreshTableCellRenderers(this.allRows);
            this.lastQuerySignature = querySignature;
            this.syncPaginationStateFromStream(streamed.result);
            this.rebuildMenus();
            this.setStatus(
                `Record caricati: ${streamed.result.count} / Totale: ${streamed.result.totalCount} (limit ${this.limit})`,
                false
            );
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        } finally {
            this.isLoadingRecords = false;
        }
    }

    async openSelectedRecord(): Promise<void> {
        if (!this.selectedModel || !this.selectedRecordName) return;
        this.setStatus(`Caricamento record "${this.selectedRecordName}"...`, false);
        try {
            const payload = await this.api.getRecord(this.selectedModel, this.selectedRecordName);
            const canReuseCachedSchema =
                Boolean(this.rawFormSchema)
                && (!this.rawFormSchemaModel || this.rawFormSchemaModel === this.selectedModel);
            let schema = this.extractSchema(payload) || (canReuseCachedSchema && this.rawFormSchema ? this.cloneSchema(this.rawFormSchema) : null);
            if (!schema) {
                const schemaPayload = await this.api.getRecordSchema(this.selectedModel);
                schema = this.extractSchema(schemaPayload);
                if (schema) {
                    this.rawFormSchema = this.cloneSchema(schema);
                    this.rawFormSchemaModel = this.selectedModel;
                }
            }
            if (!schema) throw new Error('Schema non trovato');
            this.rawFormSchema = this.cloneSchema(schema as Record<string, unknown>);
            this.rawFormSchemaModel = this.selectedModel;
            const submission = this.extractSubmission(payload);
            if (!submission) throw new Error(`Record "${this.selectedRecordName}" non valido`);
            this.formSchema = null;
            this.formSubmission = null;
            this.formSchema = await this.hydrateRemoteSelectSchema(schema as Record<string, unknown>, submission.data);
            this.formSubmission = submission;
            await this.refreshTableCellRenderers(this.allRows);
            if (this.selectedModel.toLowerCase() === 'component' && this.formSchema) {
                this.builderEligibleCurrentForm = true;
                this.builderMode = false;
                this.builderSchemaDraft = this.cloneSchema(this.formSchema);
            } else {
                this.builderEligibleCurrentForm = false;
                this.builderMode = false;
                this.builderSchemaDraft = null;
            }
            this.rebuildMenus();
            this.setStatus(`Record caricato: ${this.selectedRecordName}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    async openRecordFromListSelection(): Promise<void> {
        const recName = String(this.selectedRecordName ?? '').trim();
        if (!recName) return;
        await this.withClickTransition(async () => {
            const currentAction = this.resolveCurrentActionName();
            if (!currentAction) {
                await this.openSelectedRecord();
                return;
            }
            await this.runNextActionRoute([currentAction, recName]);
        });
    }

    async openNewRecord(): Promise<void> {
        const currentAction = this.resolveCurrentActionName();
        if (!currentAction) {
            this.setStatus('Azione corrente non disponibile per Nuovo record', true);
            return;
        }
        await this.withClickTransition(async () => {
            await this.runNextActionRoute([currentAction]);
        });
    }

    onModelChanged(): void {
        this.skip = 0;
        this.currentPageIndex = 0;
        this.tableTotalRecords = 0;
        this.listQuerySeed = null;
        this.formSchema = null;
        this.rawFormSchema = null;
        this.rawFormSchemaModel = '';
        this.formSubmission = null;
        this.builderMode = false;
        this.builderSchemaDraft = null;
        this.builderEligibleCurrentForm = false;
        this.clearTableCellRenderers();
        this.lastQuerySignature = '';
        this.remoteSelectCache.clear();
        this.remoteSelectInflight.clear();
        this.resetQueryBuilderRules();
        this.resetTableRowActionsConfig();
        this.resetSelectionAndTable();
        this.rebuildMenus();
    }

    async prevPage(): Promise<void> {
        this.skip = Math.max(0, (this.skip || 0) - this.getPageSize());
        await this.loadRecords();
    }

    async nextPage(): Promise<void> {
        this.skip = Math.max(0, (this.skip || 0) + this.getPageSize());
        await this.loadRecords();
    }

    private applyRuntime(config: RuntimeConfig): void {
        this.backendUrl = config.backendUrl;
        this.baseToken = config.baseToken;
        this.authMode = config.authMode;
    }

    private async initializeApplication(): Promise<void> {
        this.setStatus('Sincronizzazione sessione Keycloak...', false);
        try {
            const authResult = await this.backendAuth.bootstrap();
            this.applyRuntime(this.api.getRuntimeConfig());
            if (!authResult.authenticated) {
                this.backendSessionReady = false;
                this.setStatus('Sessione Keycloak non attiva: usa Login per autenticarti.', true);
                return;
            }
            await this.bootstrapSessionAndRoute(this.backendAuth.consumeSessionPayload());
        } catch (error) {
            this.backendSessionReady = false;
            this.applyRuntime(this.api.getRuntimeConfig());
            this.setStatus(this.errorMessage(error), true);
        }
    }

    private isKeycloakAuthEnabled(): boolean {
        return true;
    }

    private hasRuntimeToken(): boolean {
        return Boolean(this.baseToken && String(this.baseToken).trim());
    }

    private canAttemptBackendCalls(): boolean {
        return this.backendSessionReady;
    }

    private syncOrderFromLazyEvent(event: TableLazyLoadEvent): void {
        const field = String(Array.isArray(event.sortField) ? event.sortField[0] : event.sortField ?? '').trim();
        if (!field) return;
        const dir = Number(event.sortOrder) === -1 ? 'desc' : 'asc';
        this.order = `${field} ${dir}`;
        this.primeSortField = field;
        this.primeSortOrder = dir === 'asc' ? 1 : -1;
    }

    private syncPrimeSortFromOrder(orderValue: unknown): void {
        const raw = String(orderValue ?? '').trim();
        if (!raw) return;
        const parts = raw.split(/\s+/).filter(Boolean);
        if (!parts.length) return;
        const dir = (parts[parts.length - 1] ?? '').toLowerCase();
        const field = (dir === 'asc' || dir === 'desc' ? parts.slice(0, -1) : parts).join(' ').trim();
        if (!field) return;
        this.primeSortField = field;
        this.primeSortOrder = dir === 'desc' ? -1 : 1;
    }

    private initializeTheme(): void {
        const theme = this.readThemeFromQuery() || this.readThemeFromStorage() ||
            (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        this.setTheme(theme, false);
    }

    private initializeBuilderPreference(): void {
        const fromQuery = this.readBuilderFromQuery();
        const fromStorage = this.readBuilderFromStorage();
        this.initialBuilderPreference = fromQuery ?? fromStorage ?? false;
        this.setBuilderEnabled(this.initialBuilderPreference, false);
    }

    private setBuilderEnabled(enabled: boolean, persist: boolean): void {
        const canEnable = this.isAdminUser;
        this.builderEnabled = canEnable ? Boolean(enabled) : false;
        if (!this.builderEnabled) {
            this.builderMode = false;
            this.builderSchemaDraft = null;
            this.openedNavMenuGroup = '';
        }
        this.syncActiveDashboardGroup();
        if (persist && typeof window !== 'undefined') {
            window.localStorage.setItem(BUILDER_STORAGE_KEY, this.builderEnabled ? '1' : '0');
        }
    }

    private readBuilderFromQuery(): boolean | null {
        if (typeof window === 'undefined') return null;
        const value = new URLSearchParams(window.location.search).get('builder');
        if (value == null) return null;
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return null;
    }

    private readBuilderFromStorage(): boolean | null {
        if (typeof window === 'undefined') return null;
        const value = window.localStorage.getItem(BUILDER_STORAGE_KEY);
        if (value == null) return null;
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return null;
    }

    private setTheme(theme: ThemeMode, persist: boolean): void {
        this.themeMode = theme;
        if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.setAttribute('data-theme', theme);
            root.setAttribute('data-bs-theme', theme);
            root.style.colorScheme = theme;
        }
        if (persist && typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    private readThemeFromQuery(): ThemeMode | null {
        if (typeof window === 'undefined') return null;
        return this.normalizeTheme(new URLSearchParams(window.location.search).get('theme'));
    }

    private readThemeFromStorage(): ThemeMode | null {
        if (typeof window === 'undefined') return null;
        return this.normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    }

    private normalizeTheme(v: unknown): ThemeMode | null {
        const n = String(v ?? '').trim().toLowerCase();
        return (n === 'light' || n === 'dark') ? n : null;
    }

    private parseQueryInput(): Record<string, unknown> | null {
        if (this.queryMode === 'builder') {
            try {
                const query = this.queryBuilderToBackend(this.queryBuilderRules);
                this.queryText = JSON.stringify(query, null, 2);
                return this.applyListQuerySeed(query);
            } catch (e) {
                this.setStatus(this.errorMessage(e), true);
                return null;
            }
        }
        const raw = (this.queryText || '').trim();
        if (!raw) return this.applyListQuerySeed({});
        try {
            const p = JSON.parse(raw);
            if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Query JSON deve essere un oggetto');
            return this.applyListQuerySeed(p as Record<string, unknown>);
        } catch (e) {
            this.setStatus(this.errorMessage(e), true);
            return null;
        }
    }

    private applyListQuerySeed(query: Record<string, unknown>): Record<string, unknown> {
        const seed = this.listQuerySeed && this.isRecord(this.listQuerySeed)
            ? this.cloneSchema(this.listQuerySeed)
            : null;
        if (!seed || !Object.keys(seed).length) return query;
        if (!query || !Object.keys(query).length) return seed;
        return { $and: [seed, query] };
    }

    private queryBuilderToBackend(root: RuleSet): Record<string, unknown> {
        const expr = this.convertRuleSetToMongo(root);
        if (!expr) return {};
        if (this.isRecord(expr)) return expr;
        return {};
    }

    private convertRuleSetToMongo(node: RuleSet): Record<string, unknown> | null {
        const condition = String(node?.condition ?? 'and').toLowerCase() === 'or' ? '$or' : '$and';
        const clauses = (Array.isArray(node?.rules) ? node.rules : [])
            .map(rule => this.convertRuleNodeToMongo(rule))
            .filter((rule): rule is Record<string, unknown> => Boolean(rule && this.isRecord(rule)));
        if (!clauses.length) return null;
        if (clauses.length === 1) return clauses[0];
        return { [condition]: clauses };
    }

    private convertRuleNodeToMongo(node: RuleSet | Rule): Record<string, unknown> | null {
        if (!node) return null;
        if (Array.isArray((node as RuleSet).rules)) {
            return this.convertRuleSetToMongo(node as RuleSet);
        }
        return this.convertRuleToMongo(node as Rule);
    }

    private convertRuleToMongo(rule: Rule): Record<string, unknown> | null {
        const field = String(rule.field ?? '').trim();
        if (!field) return null;
        const operator = String(rule.operator ?? '=').trim().toLowerCase();
        const value = rule.value;

        switch (operator) {
            case '=':
                return { [field]: value };
            case '!=':
            case '<>':
                return { [field]: { $ne: value } };
            case '<':
                return { [field]: { $lt: value } };
            case '<=':
                return { [field]: { $lte: value } };
            case '>':
                return { [field]: { $gt: value } };
            case '>=':
                return { [field]: { $gte: value } };
            case 'contains':
                return { [field]: { $regex: this.escapeRegex(this.toDisplayValue(value)), $options: 'i' } };
            case 'does not contain':
                return { [field]: { $not: { $regex: this.escapeRegex(this.toDisplayValue(value)), $options: 'i' } } };
            case 'begins with':
                return { [field]: { $regex: `^${this.escapeRegex(this.toDisplayValue(value))}`, $options: 'i' } };
            case 'ends with':
                return { [field]: { $regex: `${this.escapeRegex(this.toDisplayValue(value))}$`, $options: 'i' } };
            case 'is null':
                return { [field]: null };
            case 'is not null':
                return { [field]: { $ne: null } };
            case 'in':
                return { [field]: { $in: this.normalizeArrayValue(value) } };
            case 'not in':
                return { [field]: { $nin: this.normalizeArrayValue(value) } };
            default:
                return { [field]: value };
        }
    }

    private normalizeArrayValue(value: unknown): unknown[] {
        if (Array.isArray(value)) return value;
        const text = String(value ?? '').trim();
        if (!text) return [];
        if (text.startsWith('[') && text.endsWith(']')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                return text.split(',').map(entry => entry.trim()).filter(Boolean);
            }
        }
        return text.split(',').map(entry => entry.trim()).filter(Boolean);
    }

    private escapeRegex(value: string): string {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private resetSelectionAndTable(opt: { preservePaginationState?: boolean; preserveFilterText?: boolean } = {}): void {
        this.selectedRecordName = '';
        this.selectedRows = [];
        this.streamCount = 0;
        this.rowCounter = 0;
        this.tableColumnsInitialized = false;
        this.serverColumns = null;
        this.tableColumns = [{ field: '__rec_name', title: 'Record' }];
        this.allRows = [];
        this.tableRows = [];
        this.rowBuffer = [];
        this.tableFieldRendererCache.clear();
        this.syncQueryBuilderFields(this.tableColumns);
        if (!opt.preserveFilterText) this.filterText = '';
        if (!opt.preservePaginationState) this.tableTotalRecords = 0;
        this.currentPageIndex = this.computeCurrentPageIndex();
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    }

    private appendRecordRow(payload: unknown): void {
        const rec = this.extractRecord(payload);
        if (!rec) return;
        this.rowCounter += 1;
        const recName = this.computeRecordName(rec, this.rowCounter);
        const row: TableRow = {
            ...rec,
            rec_name: this.readFirstString(rec['rec_name'], recName) || recName,
            __rowid: this.rowCounter,
            __rec_name: recName
        };
        if (!this.tableColumnsInitialized) {
            this.tableColumns = this.serverColumns ? [...this.serverColumns] : (this.strictHeaderColumns ? [] : this.buildTableColumnsFromRow(row));
            this.tableColumnsInitialized = true;
            this.syncQueryBuilderFields(this.tableColumns);
        }
        this.enqueueRow(row);
    }

    private applyTableColumnsFromHeader(payload: unknown): void {
        const cols = this.buildTableColumnsFromHeader(payload);
        if (!cols?.length) return;
        this.serverColumns = cols;
        this.tableColumns = [...cols];
        this.tableColumnsInitialized = true;
        this.syncQueryBuilderFields(this.tableColumns);
        this.refreshTableRows();
    }

    private buildTableColumnsFromHeader(payload: unknown): TableColumn[] | null {
        const cols: TableColumn[] = [];
        const add = (f: unknown, l: unknown) => {
            const field = String(f ?? '').trim();
            if (!field || field === '__rowid' || cols.some(e => e.field === field)) return;
            cols.push({ field, title: String(l ?? field).trim() || field });
        };
        if (Array.isArray(payload)) {
            payload.forEach(e => {
                if (Array.isArray(e) && e.length >= 2) { add(e[0], e[1]); }
                else if (this.isRecord(e)) { add((e as any)['k'] ?? (e as any)['field'] ?? (e as any)['name'], (e as any)['v'] ?? (e as any)['label'] ?? (e as any)['title']); }
            });
        } else if (this.isRecord(payload)) {
            Object.entries(payload).forEach(([f, v]) => add(f, this.isRecord(v) ? (v as any)['v'] ?? (v as any)['label'] ?? (v as any)['title'] : v));
        }
        return cols.length ? cols : null;
    }

    private buildTableColumnsFromRow(row: TableRow): TableColumn[] {
        const cols: TableColumn[] = [{ field: '__rec_name', title: 'Record' }];
        Object.keys(row).filter(k => k !== '__rowid' && k !== '__rec_name').forEach(k => cols.push({ field: k, title: k }));
        return cols;
    }

    private syncQueryBuilderFields(columns: TableColumn[]): void {
        const fields: QueryBuilderConfig['fields'] = {};
        columns
            .filter(column => column.field !== '__rowid' && column.field !== '__rec_name')
            .forEach(column => {
                fields[column.field] = {
                    name: column.title || column.field,
                    type: this.detectQueryFieldType(column.field)
                };
            });
        if (!fields['rec_name']) {
            fields['rec_name'] = { name: 'Record', type: 'string' };
        }
        this.queryBuilderConfig = { ...this.queryBuilderConfig, fields };
        this.pruneInvalidRules(this.queryBuilderRules, new Set(Object.keys(fields)));
    }

    private detectQueryFieldType(field: string): string {
        for (const row of this.allRows) {
            const value = this.resolveFieldValue(row, field);
            if (value == null) continue;
            if (typeof value === 'number') return 'number';
            if (typeof value === 'boolean') return 'boolean';
            return 'string';
        }
        return 'string';
    }

    private pruneInvalidRules(ruleset: RuleSet, allowedFields: Set<string>): void {
        if (!Array.isArray(ruleset.rules)) {
            ruleset.rules = [];
            return;
        }
        ruleset.rules = ruleset.rules.filter(rule => {
            if (!rule) return false;
            if (Array.isArray((rule as RuleSet).rules)) {
                this.pruneInvalidRules(rule as RuleSet, allowedFields);
                return (rule as RuleSet).rules.length > 0;
            }
            const field = String((rule as Rule).field ?? '').trim();
            return field ? allowedFields.has(field) : false;
        });
    }

    private enqueueRow(row: TableRow): void {
        this.rowBuffer.push(row);
        if (this.rowBuffer.length >= 100) { this.flushRows(); return; }
        if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushRows(); }, 35);
    }

    private flushRows(): void {
        if (!this.rowBuffer.length) return;
        this.allRows = [...this.allRows, ...this.rowBuffer.splice(0, this.rowBuffer.length)];
        this.refreshTableRows();
    }

    private refreshTableRows(): void {
        const f = this.filterText.trim().toLowerCase();
        this.tableRows = f ? this.allRows.filter(r => this.rowMatchesFilter(r, f)) : [...this.allRows];
        if (this.reconcileSelectionWithVisibleRows()) {
            this.rebuildMenus();
        }
    }

    private reconcileSelectionWithVisibleRows(): boolean {
        const visibleRecNames = new Set(this.tableRows.map(row => String(row.__rec_name ?? '')));
        let changed = false;

        const filteredRows = this.selectedRows.filter(row => visibleRecNames.has(String(row.__rec_name ?? '')));
        if (filteredRows.length !== this.selectedRows.length) {
            this.selectedRows = filteredRows;
            changed = true;
        }

        if (this.selectedRecordName && !visibleRecNames.has(this.selectedRecordName)) {
            this.selectedRecordName = '';
            changed = true;
        }

        if (!this.selectedRecordName && this.selectedRows.length) {
            this.selectedRecordName = String(this.selectedRows[0].__rec_name ?? '').trim();
            changed = true;
        }
        return changed;
    }

    private syncPaginationStateFromStream(result: { count: number; totalCount: number; skip?: string; limit?: string }): void {
        const nextSkip = this.parseNonNegativeInt(result.skip, this.skip);
        const nextLimit = this.parseNonNegativeInt(result.limit, this.limit || 20);
        this.skip = nextSkip;
        this.limit = nextLimit > 0 ? nextLimit : this.limit;
        this.currentPageIndex = this.computeCurrentPageIndex();
        const totalCount = this.parseNonNegativeInt(result.totalCount, result.count);
        this.tableTotalRecords = Math.max(totalCount, result.count);
    }

    private rowMatchesFilter(row: TableRow, filter: string): boolean {
        return this.tableColumns.some(c => this.displayCell(row, c.field).toLowerCase().includes(filter));
    }

    private resolveFieldValue(row: TableRow, field: string): unknown {
        const candidates = String(field)
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);
        if (!candidates.length && String(field ?? '').trim()) {
            candidates.push(String(field).trim());
        }
        const contexts = this.resolveRowValueContexts(row);
        for (const candidate of candidates) {
            for (const context of contexts) {
                if (Object.prototype.hasOwnProperty.call(context, candidate)) return context[candidate];
                const resolved = this.resolvePath(context, candidate);
                if (resolved !== undefined) return resolved;
            }
        }
        return undefined;
    }

    private resolveRowValueContexts(row: TableRow): Array<Record<string, unknown>> {
        const contexts: Array<Record<string, unknown>> = [row];
        const nestedData = this.asRecord(row['data']);
        const nestedDataValue = this.asRecord(row['data_value']);
        if (nestedData && !contexts.includes(nestedData)) contexts.push(nestedData);
        if (nestedDataValue && !contexts.includes(nestedDataValue)) contexts.push(nestedDataValue);
        return contexts;
    }

    private resolvePath(src: Record<string, unknown>, path: string): unknown {
        const norm = String(path).replace(/\[(\d+)\]/g, '.$1').trim();
        if (!norm) return undefined;
        let curr: any = src;
        for (const p of norm.split('.').filter(Boolean)) {
            if (curr === null || typeof curr !== 'object') return undefined;
            curr = curr[p];
            if (curr === undefined) return undefined;
        }
        return curr;
    }

    private extractSchema(payload: unknown): Record<string, unknown> | null {
        const nodes = this.collectResponseNodes(payload);
        for (const target of nodes) {
            const dataNode = this.asRecord(target['data']);
            const candidates: unknown[] = [
                target['schema'],
                target['formio'],
                target['components'],
                dataNode ? dataNode['schema'] : null,
                dataNode ? dataNode['formio'] : null,
                dataNode ? dataNode['components'] : null
            ];
            for (const entry of candidates) {
                const parsed = this.parseJsonMaybe(entry);
                const normalized = parsed ?? entry;
                if (Array.isArray(normalized)) return { display: 'form', components: normalized };
                if (this.isRecord(normalized) && Array.isArray(normalized['components'])) return normalized;
            }
        }
        return null;
    }

    private extractSubmission(payload: unknown): { data: Record<string, unknown> } | null {
        const nodes = this.collectResponseNodes(payload);
        for (const target of nodes) {
            const data = this.asRecord(target['data']);
            if (!data || !Object.keys(data).length) continue;
            if (this.isEnvelopeNode(target)) continue;
            return { data: this.normalizeFormSubmissionData(data) };
        }
        const rec = this.extractRecord(payload);
        return rec ? { data: this.normalizeFormSubmissionData(rec) } : null;
    }

    private extractRecord(payload: unknown): Record<string, unknown> | null {
        const nodes = this.collectResponseNodes(payload);
        for (const target of nodes) {
            const record = this.asRecord(target['record']);
            if (record) return record;
            const item = this.asRecord(target['item']);
            if (item) return item;
            const data = this.asRecord(target['data']);
            if (data && !this.isEnvelopeNode(target)) return data;
            if (!this.isEnvelopeNode(target)) return target;
        }
        return null;
    }

    private collectResponseNodes(payload: unknown, maxDepth = 8): Record<string, unknown>[] {
        if (!this.isRecord(payload)) return [];
        const queue: Array<{ node: Record<string, unknown>; depth: number }> = [{ node: payload, depth: 0 }];
        const visited = new Set<Record<string, unknown>>();
        const nodes: Record<string, unknown>[] = [];

        while (queue.length) {
            const current = queue.shift();
            if (!current) break;
            const { node, depth } = current;
            if (visited.has(node)) continue;
            visited.add(node);
            nodes.push(node);
            if (depth >= maxDepth) continue;

            const nestedData = this.asRecord(node['data']);
            if (nestedData) {
                queue.push({ node: nestedData, depth: depth + 1 });
            }
            for (const wrapper of this.responseWrappers) {
                const nested = this.asRecord(node[wrapper]);
                if (!nested) continue;
                queue.push({ node: nested, depth: depth + 1 });
            }
        }

        return nodes;
    }

    private isEnvelopeNode(node: Record<string, unknown>): boolean {
        if (!this.asRecord(node['content'])) return false;
        return (
            Object.prototype.hasOwnProperty.call(node, 'fail')
            || Object.prototype.hasOwnProperty.call(node, 'message')
            || !Object.prototype.hasOwnProperty.call(node, 'mode')
        );
    }

    private readEnvelopeFailureMessage(payload: unknown): string {
        const nodes = this.collectResponseNodes(payload, 4);
        for (const node of nodes) {
            const hasEnvelopeSignature = Boolean(this.asRecord(node['content']))
                || (
                    Object.prototype.hasOwnProperty.call(node, 'fail')
                    && (
                        Object.prototype.hasOwnProperty.call(node, 'message')
                        || Object.prototype.hasOwnProperty.call(node, 'content')
                    )
                );
            if (!hasEnvelopeSignature) continue;
            const failed = this.toOptionalBooleanFlag(node['fail']);
            if (failed !== true) continue;
            const data = this.asRecord(node['data']);
            const message = this.readFirstString(node['message'], data ? data['message'] : undefined, 'Operazione fallita');
            return message || 'Operazione fallita';
        }
        return '';
    }

    private normalizeFormSubmissionData(raw: Record<string, unknown>): Record<string, unknown> {
        const normalized: Record<string, unknown> = { ...raw };
        const nestedData = this.asRecord(normalized['data']);
        const nestedDataValue = this.asRecord(normalized['data_value']);

        const promoteMissingFields = (source: Record<string, unknown> | null): void => {
            if (!source) return;
            Object.entries(source).forEach(([key, value]) => {
                if (value === undefined) return;
                if (Object.prototype.hasOwnProperty.call(normalized, key)) return;
                normalized[key] = value;
            });
        };

        // Legacy payloads may keep real field values under nested data/data_value.
        promoteMissingFields(nestedData);
        promoteMissingFields(nestedDataValue);

        normalized['data_value'] = this.buildSubmissionDataValueAlias(normalized, nestedDataValue);
        return normalized;
    }

    private buildSubmissionDataValueAlias(
        submission: Record<string, unknown>,
        explicitDataValue: Record<string, unknown> | null
    ): Record<string, unknown> {
        const alias: Record<string, unknown> = explicitDataValue ? { ...explicitDataValue } : {};
        const excludedKeys = new Set(['data', 'data_value', 'schema', 'formio', 'components']);
        Object.entries(submission).forEach(([key, value]) => {
            if (excludedKeys.has(key) || value === undefined) return;
            if (Object.prototype.hasOwnProperty.call(alias, key)) return;
            alias[key] = value;
        });
        return alias;
    }

    private computeRecordName(rec: Record<string, unknown>, idx: number): string {
        return String(rec['rec_name'] || rec['name'] || rec['key'] || rec['_id'] || rec['id'] || `record_${idx}`);
    }

    private toDisplayValue(v: unknown): string {
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }

    private async refreshTableCellRenderers(rows: Array<Record<string, unknown>> = []): Promise<void> {
        const canReuseCachedSchema =
            Boolean(this.rawFormSchema)
            && (!this.selectedModel || !this.rawFormSchemaModel || this.rawFormSchemaModel === this.selectedModel);
        const schema = canReuseCachedSchema ? this.rawFormSchema : null;
        await this.configureTableCellRenderers(schema, rows);
    }

    private async configureTableCellRenderers(
        schema: Record<string, unknown> | null,
        rows: Array<Record<string, unknown>> = []
    ): Promise<void> {
        if (!schema) {
            this.clearTableCellRenderers();
            return;
        }
        let renderSchema = this.cloneSchema(schema);
        try {
            const sampleSubmission = this.buildTableRenderSubmission(rows);
            renderSchema = await this.hydrateRemoteSelectSchema(renderSchema, sampleSubmission);
        } catch {
            // Fallback: keep raw schema if remote select hydration fails.
        }
        this.tableRenderSchema = renderSchema;
        this.rebuildTableCellRenderers(renderSchema);
    }

    private buildTableRenderSubmission(rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
        if (!rows.length) return null;
        const sample: Record<string, unknown> = {};
        const maxRows = Math.min(rows.length, 64);
        for (let index = 0; index < maxRows; index += 1) {
            const row = rows[index];
            Object.entries(row).forEach(([field, value]) => {
                if (field.startsWith('__')) return;
                if (value === undefined || value === null) return;
                if (Object.prototype.hasOwnProperty.call(sample, field)) return;
                sample[field] = value;
            });
        }
        return Object.keys(sample).length ? sample : null;
    }

    private clearTableCellRenderers(): void {
        this.tableRenderSchema = null;
        this.tableCellRenderers.clear();
        this.tableFieldRendererCache.clear();
    }

    private rebuildTableCellRenderers(schema: Record<string, unknown>): void {
        this.tableCellRenderers.clear();
        this.tableFieldRendererCache.clear();
        this.collectTableCellRenderers(schema);
    }

    private collectTableCellRenderers(node: unknown): void {
        if (Array.isArray(node)) {
            node.forEach(entry => this.collectTableCellRenderers(entry));
            return;
        }
        if (!this.isRecord(node)) return;
        const key = String(node['key'] ?? '').trim();
        if (key) {
            const renderer = this.createTableCellRenderer(node);
            if (renderer) this.tableCellRenderers.set(key, renderer);
        }
        Object.values(node).forEach(entry => this.collectTableCellRenderers(entry));
    }

    private createTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        if (type === 'select' || type === 'radio') return this.createOptionsTableCellRenderer(component);
        if (type === 'selectboxes') return this.createSelectBoxesTableCellRenderer(component);
        if (type === 'datetime' || type === 'day' || type === 'time') return this.createDateTableCellRenderer(component);
        return null;
    }

    private createDateTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const type = String(component['type'] ?? '').trim().toLowerCase();
        const format = this.readDateComponentFormat(component);
        const widget = this.isRecord(component['widget']) ? component['widget'] : {};
        const showDateFromFormat = this.dateFormatContainsDateToken(format);
        const showTimeFromFormat = this.dateFormatContainsTimeToken(format);
        const showDate = type === 'time' ? false : (showDateFromFormat || type === 'datetime' || type === 'day');
        const showTime = type === 'day'
            ? false
            : (showTimeFromFormat
                || type === 'datetime'
                || type === 'time'
                || this.toOptionalBooleanFlag(component['enableTime']) === true
                || this.toOptionalBooleanFlag(widget['enableTime']) === true);
        const showSeconds = format.includes('ss');

        const renderSingle = (entry: unknown): string => {
            const parsed = this.parseDateLikeValue(entry, showDate, showTime);
            if (!parsed) return this.toDisplayValue(entry);
            return this.formatDateLikeValue(parsed, showDate, showTime, showSeconds);
        };

        return (value: unknown): string => {
            if (Array.isArray(value)) {
                return value.map(entry => renderSingle(entry)).filter(Boolean).join(', ');
            }
            return renderSingle(value);
        };
    }

    private readDateComponentFormat(component: Record<string, unknown>): string {
        const widget = this.isRecord(component['widget']) ? component['widget'] : {};
        const data = this.isRecord(component['data']) ? component['data'] : {};
        return this.readFirstString(
            component['format'],
            widget['format'],
            data['format'],
            component['displayFormat']
        );
    }

    private dateFormatContainsDateToken(format: string): boolean {
        return /[dDMyY]/.test(format);
    }

    private dateFormatContainsTimeToken(format: string): boolean {
        return /[hHsSaA]/.test(format) || /(^|[^M])m/.test(format);
    }

    private parseDateLikeValue(value: unknown, showDate: boolean, showTime: boolean): Date | null {
        if (value == null) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

        const normalized = this.normalizeDateLikeValue(value);
        if (normalized instanceof Date) return Number.isNaN(normalized.getTime()) ? null : normalized;
        if (typeof normalized === 'number') return this.dateFromEpoch(normalized);
        if (typeof normalized !== 'string') return null;

        const raw = normalized.trim();
        if (!raw) return null;

        if (showTime && !showDate) {
            const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (timeMatch) {
                const hours = Number(timeMatch[1]);
                const minutes = Number(timeMatch[2]);
                const seconds = Number(timeMatch[3] ?? '0');
                if (
                    Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)
                    && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59
                ) {
                    const base = new Date();
                    base.setHours(hours, minutes, seconds, 0);
                    return base;
                }
            }
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const [year, month, day] = raw.split('-').map(part => Number(part));
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            const parsed = new Date(year, month - 1, day);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        if (/^-?\d+(\.\d+)?$/.test(raw) && raw.replace('-', '').length >= 10) {
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) return this.dateFromEpoch(numeric);
        }

        const normalizedIso = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
        const parsed = new Date(normalizedIso);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private normalizeDateLikeValue(value: unknown): unknown {
        if (this.isRecord(value)) {
            const nested = this.isRecord(value['data']) ? value['data'] : null;
            const candidate = value['value'] ?? value['date'] ?? value['datetime'] ?? value['time'] ?? value['timestamp']
                ?? value['_value'] ?? nested?.['value'] ?? nested?.['date'] ?? nested?.['datetime'] ?? nested?.['time']
                ?? nested?.['timestamp'];
            if (candidate !== undefined) return candidate;
        }
        return value;
    }

    private dateFromEpoch(value: number): Date | null {
        if (!Number.isFinite(value)) return null;
        const asMillis = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(asMillis);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private formatDateLikeValue(date: Date, showDate: boolean, showTime: boolean, showSeconds: boolean): string {
        if (!showDate && !showTime) {
            return this.toDisplayValue(date.toISOString());
        }
        const options: Intl.DateTimeFormatOptions = {};
        if (showDate) {
            options.day = '2-digit';
            options.month = '2-digit';
            options.year = 'numeric';
        }
        if (showTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
            if (showSeconds) options.second = '2-digit';
            options.hour12 = false;
        }
        if (this.sessionTimezone) options.timeZone = this.sessionTimezone;
        const locale = this.sessionLocale || 'it';
        try {
            return new Intl.DateTimeFormat(locale, options).format(date);
        } catch {
            if (options.timeZone) delete options.timeZone;
            return new Intl.DateTimeFormat('it', options).format(date);
        }
    }

    private createOptionsTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const options = this.extractSchemaOptions(component);
        if (!options.length) return null;
        const labelsByValue = new Map<string, string>();
        options.forEach((entry) => {
            const optionKey = this.optionLookupKey(entry.value);
            if (!optionKey || labelsByValue.has(optionKey)) return;
            labelsByValue.set(optionKey, entry.label);
        });

        const renderSingle = (entry: unknown): string => {
            if (entry == null) return '';
            const parsed = this.toSelectValueOption(entry);
            if (parsed) {
                const mappedFromParsed = labelsByValue.get(this.optionLookupKey(parsed.value));
                if (mappedFromParsed) return mappedFromParsed;
                if (this.isRecord(entry) && parsed.label) return parsed.label;
            }
            const mapped = labelsByValue.get(this.optionLookupKey(entry));
            if (mapped) return mapped;
            return this.toDisplayValue(entry);
        };

        return (value: unknown): string => {
            if (Array.isArray(value)) {
                return value.map(entry => renderSingle(entry)).filter(Boolean).join(', ');
            }
            return renderSingle(value);
        };
    }

    private createSelectBoxesTableCellRenderer(component: Record<string, unknown>): ((value: unknown) => string) | null {
        const options = this.extractSchemaOptions(component);
        if (!options.length) return null;
        const lookup = options
            .map((entry) => ({
                field: this.optionFieldKey(entry.value),
                valueKey: this.optionLookupKey(entry.value),
                label: entry.label
            }))
            .filter(entry => Boolean(entry.field || entry.valueKey));
        if (!lookup.length) return null;

        const labelsByValue = new Map<string, string>();
        lookup.forEach((entry) => {
            if (entry.valueKey && !labelsByValue.has(entry.valueKey)) {
                labelsByValue.set(entry.valueKey, entry.label);
            }
        });

        return (value: unknown): string => {
            if (Array.isArray(value)) {
                return value
                    .map(entry => labelsByValue.get(this.optionLookupKey(entry)) || this.toDisplayValue(entry))
                    .filter(Boolean)
                    .join(', ');
            }
            if (this.isRecord(value)) {
                const labels: string[] = [];
                lookup.forEach((entry) => {
                    if (!entry.field) return;
                    if (this.toOptionalBooleanFlag(value[entry.field]) === true) {
                        labels.push(entry.label);
                    }
                });
                if (labels.length) return labels.join(', ');
            }
            const mapped = labelsByValue.get(this.optionLookupKey(value));
            if (mapped) return mapped;
            return this.toDisplayValue(value);
        };
    }

    private extractSchemaOptions(component: Record<string, unknown>): SelectValueOption[] {
        const data = this.isRecord(component['data']) ? component['data'] : {};
        const candidates: unknown[] = [
            data['values'],
            component['values'],
            data['items'],
            component['items']
        ];
        for (const candidate of candidates) {
            if (!Array.isArray(candidate)) continue;
            const parsed = candidate
                .map(entry => this.toSelectValueOption(entry))
                .filter((entry): entry is SelectValueOption => Boolean(entry));
            if (parsed.length) return parsed;
        }
        return [];
    }

    private optionLookupKey(value: unknown): string {
        const primitive = this.optionPrimitiveValue(value);
        if (primitive == null) return '';
        if (typeof primitive === 'string') return `s:${primitive}`;
        if (typeof primitive === 'number') return `n:${primitive}`;
        if (typeof primitive === 'boolean') return `b:${primitive}`;
        if (Array.isArray(primitive)) {
            return `a:${primitive.map(entry => this.optionLookupKey(entry)).join('|')}`;
        }
        if (this.isRecord(primitive)) {
            return `j:${this.stableStringify(primitive)}`;
        }
        return `x:${String(primitive)}`;
    }

    private optionFieldKey(value: unknown): string {
        const primitive = this.optionPrimitiveValue(value);
        if (typeof primitive === 'string' || typeof primitive === 'number') {
            return String(primitive);
        }
        return '';
    }

    private optionPrimitiveValue(value: unknown): unknown {
        if (!this.isRecord(value)) return value;
        const nested = this.isRecord(value['data']) ? value['data'] : null;
        const primitive = value['value'] ?? value['id'] ?? value['_id'] ?? value['code'] ?? value['key'] ?? value['k'] ?? value['name']
            ?? nested?.['value'] ?? nested?.['id'] ?? nested?.['_id'] ?? nested?.['code'] ?? nested?.['key'] ?? nested?.['k'] ?? nested?.['name'];
        return primitive !== undefined ? primitive : value;
    }

    private resolveTableCellRenderer(field: string): ((value: unknown) => string) | null {
        if (this.tableFieldRendererCache.has(field)) {
            return this.tableFieldRendererCache.get(field) ?? null;
        }
        const renderer = this.findTableCellRenderer(field);
        this.tableFieldRendererCache.set(field, renderer);
        return renderer;
    }

    private findTableCellRenderer(field: string): ((value: unknown) => string) | null {
        const candidates = this.expandFieldCandidates(field);
        for (const candidate of candidates) {
            const renderer = this.tableCellRenderers.get(candidate);
            if (renderer) return renderer;
        }
        return null;
    }

    private expandFieldCandidates(field: string): string[] {
        const out = new Set<string>();
        String(field ?? '')
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean)
            .forEach((entry) => {
                out.add(entry);
                const normalized = entry.replace(/\[(\d+)\]/g, '.$1');
                const parts = normalized.split('.').map(item => item.trim()).filter(Boolean);
                if (!parts.length) return;
                out.add(parts.join('.'));
                out.add(parts[parts.length - 1]);
            });
        return [...out];
    }

    private async hydrateRemoteSelectSchema(schema: Record<string, unknown>, sub: Record<string, unknown> | null): Promise<Record<string, unknown>> {
        const hydrated = this.cloneSchema(schema);
        const formKey = String(hydrated['key'] || hydrated['name'] || hydrated['path'] || this.selectedModel || '').trim();
        this.normalizeFormTableComponents(hydrated);

        for (const comp of this.findSelectComponents(hydrated)) {
            const payload = this.extractRemoteSelectPayload(comp, formKey);
            if (payload) {
                try {
                    const remoteOptions = await this.fetchRemoteSelectOptions(payload);
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, this.mergeSelectValues(remoteOptions, selectedOptions));
                } catch (error) {
                    const selectedOptions = this.extractSubmissionSelectOptions(comp, sub);
                    this.applyRemoteSelectValues(comp, selectedOptions);
                    console.error('Remote select fetch failed', error);
                }
                this.ensureSelectTemplate(comp);
                continue;
            }

            if (String(comp['dataSrc'] ?? '').trim() === 'custom' && sub) {
                const data = this.isRecord(comp['data']) ? comp['data'] : {};
                const customKey = String(data['custom'] ?? '').trim();
                const customValue = customKey ? (sub[customKey] ?? (this.isRecord(sub['data_value']) ? sub['data_value'][customKey] : null)) : null;
                if (Array.isArray(customValue)) {
                    const options = customValue
                        .map(entry => this.toSelectValueOption(entry))
                        .filter((entry): entry is SelectValueOption => Boolean(entry));
                    this.applyRemoteSelectValues(comp, options);
                }
            }

            this.ensureSelectTemplate(comp);
        }

        return hydrated;
    }

    private normalizeFormTableComponents(schema: Record<string, unknown>): void {
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'table') {
                node['tableView'] = true;
                node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-table');
            } else if (type === 'datagrid' || type === 'editgrid') {
                node['tableView'] = true;
                node['customClass'] = this.appendCustomClass(node['customClass'], 'ozon-form-datagrid');
            }
            Object.values(node).forEach(visit);
        };
        visit(schema);
    }

    private appendCustomClass(source: unknown, className: string): string {
        const classes = String(source ?? '')
            .split(/\s+/)
            .map(entry => entry.trim())
            .filter(Boolean);
        if (!classes.includes(className)) classes.push(className);
        return classes.join(' ').trim();
    }

    private cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
    }

    private findSelectComponents(src: unknown): any[] {
        const out: any[] = [];
        const visit = (n: any) => {
            if (Array.isArray(n)) n.forEach(visit);
            else if (this.isRecord(n)) {
                if (n['type'] === 'select') out.push(n);
                Object.values(n).forEach(visit);
            }
        };
        visit(src);
        return out;
    }

    private extractChangeEventSubmissionData(eventRecord: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!eventRecord) return null;
        const submission = this.asRecord(eventRecord['submission']);
        const submissionData = submission ? this.asRecord(submission['data']) : null;
        if (submissionData) return submissionData;
        return this.asRecord(eventRecord['data']);
    }

    private extractChangedComponentKey(eventRecord: Record<string, unknown> | null): string {
        if (!eventRecord) return '';
        const changed = this.asRecord(eventRecord['changed']);
        const changedComponent = changed ? this.asRecord(changed['component']) : null;
        const changedInstance = changed ? this.asRecord(changed['instance']) : null;
        const changedInstanceComponent = changedInstance ? this.asRecord(changedInstance['component']) : null;
        const eventComponent = this.asRecord(eventRecord['component']);
        const key = this.readFirstString(
            changedComponent?.['key'],
            changedInstanceComponent?.['key'],
            changed?.['key'],
            eventComponent?.['key']
        );
        if (key) return key;
        const path = this.readFirstString(
            changed?.['path'],
            changedComponent?.['path'],
            changedInstanceComponent?.['path']
        );
        if (!path) return '';
        const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
        const segments = normalizedPath
            .split('.')
            .map(entry => entry.trim())
            .filter(Boolean)
            .filter(entry => !/^\d+$/.test(entry));
        if (!segments.length) return '';
        return segments[segments.length - 1];
    }

    private async refreshDependentSelectComponents(changedKey: string): Promise<void> {
        if (!changedKey || !this.formSchema || this.isRefreshingDependentSelects) return;
        const schema = this.formSchema;
        const dependents = this.findDependentSelectComponents(schema, changedKey);
        if (!dependents.length) return;
        const formKey = String(schema['key'] || schema['name'] || schema['path'] || this.selectedModel || '').trim();
        const submissionData = this.formSubmission?.data && this.isRecord(this.formSubmission.data)
            ? this.formSubmission.data
            : null;
        let schemaChanged = false;
        let submissionChanged = false;
        this.isRefreshingDependentSelects = true;
        try {
            for (const comp of dependents) {
                const payload = this.extractRemoteSelectPayload(comp, formKey);
                if (payload) {
                    try {
                        const remoteOptions = await this.fetchRemoteSelectOptions(payload);
                        this.applyRemoteSelectValues(comp, remoteOptions);
                        schemaChanged = true;
                    } catch (error) {
                        console.error('Dependent remote select fetch failed', error);
                    }
                    this.ensureSelectTemplate(comp);
                    submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    continue;
                }

                if (String(comp['dataSrc'] ?? '').trim() === 'custom' && submissionData) {
                    const data = this.isRecord(comp['data']) ? comp['data'] : {};
                    const customKey = String(data['custom'] ?? '').trim();
                    const customValue = customKey
                        ? (submissionData[customKey] ?? (this.isRecord(submissionData['data_value']) ? submissionData['data_value'][customKey] : null))
                        : null;
                    if (Array.isArray(customValue)) {
                        const options = customValue
                            .map(entry => this.toSelectValueOption(entry))
                            .filter((entry): entry is SelectValueOption => Boolean(entry));
                        this.applyRemoteSelectValues(comp, options);
                        schemaChanged = true;
                        submissionChanged = this.pruneSelectSubmissionValue(comp, submissionData) || submissionChanged;
                    }
                }
            }
        } finally {
            this.isRefreshingDependentSelects = false;
        }
        if (schemaChanged && this.formSchema) {
            this.formSchema = this.cloneSchema(this.formSchema);
        }
        if (submissionChanged && submissionData) {
            this.mergeSubmissionData(submissionData);
        }
    }

    private mergeSubmissionData(nextData: Record<string, unknown>): void {
        if (!this.formSubmission || !this.isRecord(this.formSubmission.data)) {
            this.formSubmission = { data: this.normalizeFormSubmissionData(nextData) };
            return;
        }
        const merged = {
            ...this.formSubmission.data,
            ...nextData
        };
        this.formSubmission.data = this.normalizeFormSubmissionData(merged);
    }

    private findDependentSelectComponents(schema: Record<string, unknown>, changedKey: string): Record<string, unknown>[] {
        const sourceKey = String(changedKey ?? '').trim();
        if (!sourceKey) return [];
        return this.findSelectComponents(schema)
            .filter((component): component is Record<string, unknown> => this.isRecord(component))
            .filter((component) => {
                const componentKey = String(component['key'] ?? '').trim();
                if (!componentKey || componentKey === sourceKey) return false;
                return this.readSelectOnChangeFields(component).includes(sourceKey);
            });
    }

    private readSelectOnChangeFields(component: Record<string, unknown>): string[] {
        const properties = this.readComponentProperties(component);
        const data = this.isRecord(component['data']) ? component['data'] : {};
        const raw = (
            properties['onChangeFields']
            ?? properties['on_change_fields']
            ?? data['onChangeFields']
            ?? data['on_change_fields']
            ?? component['onChangeFields']
            ?? component['on_change_fields']
        );
        const entries = this.normalizeArrayValue(raw)
            .map(entry => String(entry ?? '').trim())
            .filter(Boolean);
        return Array.from(new Set(entries));
    }

    private pruneSelectSubmissionValue(
        component: Record<string, unknown>,
        submissionData: Record<string, unknown> | null
    ): boolean {
        if (!submissionData) return false;
        const key = String(component['key'] ?? '').trim();
        if (!key || !Object.prototype.hasOwnProperty.call(submissionData, key)) return false;
        const options = this.extractSchemaOptions(component);
        if (!options.length) return false;
        const allowedValues = new Set(
            options
                .map(option => this.optionLookupKey(option.value))
                .filter(Boolean)
        );
        const current = submissionData[key];
        if (Array.isArray(current)) {
            const filtered = current.filter((entry) => allowedValues.has(this.optionLookupKey(entry)));
            if (filtered.length === current.length) return false;
            submissionData[key] = filtered;
            return true;
        }
        if (current == null || current === '') return false;
        if (allowedValues.has(this.optionLookupKey(current))) return false;
        submissionData[key] = null;
        return true;
    }

    private extractRemoteSelectPayload(comp: Record<string, unknown>, formKey: string): RemoteSelectRequestPayload | null {
        const data = this.isRecord(comp['data']) ? comp['data'] : {};
        const props = this.readComponentProperties(comp);
        const key = String(comp['key'] ?? '').trim();
        const currModel = String(formKey || this.selectedModel || '').trim();
        const url = this.readFirstString(data['url'], comp['url'], this.readPropertyValue(props, ['url']));
        const src = this.readFirstString(comp['dataSrc'], props['src'], url ? 'url' : '');
        const hasInlineValues =
            (Array.isArray(data['values']) && data['values'].length > 0)
            || (Array.isArray(comp['values']) && comp['values'].length > 0);
        if (!url && !src && hasInlineValues) return null;
        const hasAbsoluteRemoteUrl = /^https?:\/\//i.test(url);
        const useInternalSelect = !hasAbsoluteRemoteUrl;
        const payloadData: Record<string, unknown> = {};
        const pathValue = this.readFirstString(
            data['pathValue'],
            data['path_value'],
            props['pathValue'],
            props['path_value']
        );
        const headerKey = this.readFirstString(
            data['headerKey'],
            data['header_key'],
            props['headerKey'],
            props['header_key']
        );
        const headerValueKey = this.readFirstString(
            data['headerValueKey'],
            data['header_value_key'],
            props['headerValueKey'],
            props['header_value_key']
        );
        const headers = this.normalizeRemoteHeaders(data['headers']);

        if (url) payloadData['url'] = url;
        if (pathValue) payloadData['pathValue'] = pathValue;
        if (headers.length) payloadData['headers'] = headers;
        if (headerKey) payloadData['headerKey'] = headerKey;
        if (headerValueKey) payloadData['headerValueKey'] = headerValueKey;

        // Per URL assoluti usiamo il payload remoto canonico (key/curr_model vuoti, properties vuoto).
        const payloadProperties: Record<string, unknown> = {};
        if (useInternalSelect) {
            const sourceModel = this.readFirstString(props['model'], data['model']);
            const sourceDomain = this.normalizeRemoteDomain(props['domain'] ?? data['domain']);
            const sourceComputeLabel = this.readFirstString(
                props['compute_label'],
                props['computeLabel'],
                data['compute_label'],
                data['computeLabel']
            );
            const labelKey = this.readFirstString(props['label'], comp['label'], key, 'label');
            const idKey = this.readFirstString(props['id'], comp['valueProperty'], 'id');

            if (src) payloadProperties['src'] = src;
            if (sourceModel) payloadProperties['model'] = sourceModel;
            if (sourceDomain) payloadProperties['domain'] = sourceDomain;
            if (sourceComputeLabel) payloadProperties['compute_label'] = sourceComputeLabel;
            if (labelKey) payloadProperties['label'] = labelKey;
            if (idKey) payloadProperties['id'] = idKey;
        }

        const payload: RemoteSelectRequestPayload = {
            key: useInternalSelect ? key : '',
            curr_model: useInternalSelect ? currModel : '',
            data: payloadData,
            properties: payloadProperties
        };

        const hasInternalSource = Boolean(payload.key && payload.curr_model);
        const hasRemoteSource = Boolean(url);
        if (!hasInternalSource && !hasRemoteSource) return null;
        return payload;
    }

    private normalizeRemoteHeaders(raw: unknown): Array<{ key: string; value: string }> {
        if (!Array.isArray(raw)) return [];
        const headers: Array<{ key: string; value: string }> = [];
        raw.forEach((entry: unknown) => {
            if (!this.isRecord(entry)) return;
            const key = String(entry['key'] ?? '').trim();
            const value = String(entry['value'] ?? '').trim();
            if (!key || !value) return;
            headers.push({ key, value });
        });
        return headers;
    }

    private normalizeRemoteDomain(raw: unknown): Record<string, unknown> | null {
        if (this.isRecord(raw)) return raw;
        const text = String(raw ?? '').trim();
        if (!text) return null;
        try {
            const parsed = JSON.parse(text);
            return this.isRecord(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    private async fetchRemoteSelectOptions(payload: RemoteSelectRequestPayload): Promise<SelectValueOption[]> {
        const cacheKey = this.stableStringify(payload);
        const cached = this.remoteSelectCache.get(cacheKey);
        if (cached) return cached;

        const inflight = this.remoteSelectInflight.get(cacheKey);
        if (inflight) return inflight;

        const request = this.api
            .getRemoteSelect(payload)
            .then((response: unknown) => this.normalizeRemoteSelectResponse(response))
            .then((options: SelectValueOption[]) => {
                this.remoteSelectCache.set(cacheKey, options);
                return options;
            })
            .finally(() => {
                this.remoteSelectInflight.delete(cacheKey);
            });

        this.remoteSelectInflight.set(cacheKey, request);
        return request;
    }

    private normalizeRemoteSelectResponse(payload: unknown): SelectValueOption[] {
        let target: unknown = payload;
        for (let i = 0; i < 4; i++) {
            if (this.isRecord(target) && this.isRecord(target['content'])) {
                target = target['content']['data'] ?? target['content'];
                continue;
            }
            if (this.isRecord(target)) {
                const next = target['data'] ?? target['items'] ?? target['records'] ?? target['values'];
                if (next !== undefined) {
                    target = next;
                    continue;
                }
            }
            break;
        }
        if (!Array.isArray(target)) return [];
        return target
            .map(entry => this.toSelectValueOption(entry))
            .filter((entry): entry is SelectValueOption => Boolean(entry));
    }

    private extractSubmissionSelectOptions(comp: Record<string, unknown>, sub: Record<string, unknown> | null): SelectValueOption[] {
        if (!sub) return [];
        const key = String(comp['key'] ?? '').trim();
        if (!key) return [];
        const current = sub[key];
        if (current == null) return [];
        const values = Array.isArray(current) ? current : [current];
        return values
            .map(entry => this.toSelectValueOption(entry))
            .filter((entry): entry is SelectValueOption => Boolean(entry));
    }

    private mergeSelectValues(primary: SelectValueOption[], secondary: SelectValueOption[]): SelectValueOption[] {
        const merged: SelectValueOption[] = [];
        const seen = new Set<string>();
        const pushUnique = (entry: SelectValueOption) => {
            const id = `${typeof entry.value}:${this.toDisplayValue(entry.value)}`;
            if (seen.has(id)) return;
            seen.add(id);
            merged.push(entry);
        };
        primary.forEach(pushUnique);
        secondary.forEach(pushUnique);
        return merged;
    }

    private stableStringify(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map(entry => this.stableStringify(entry)).join(',')}]`;
        if (this.isRecord(value)) {
            const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
            return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`).join(',')}}`;
        }
        return JSON.stringify(value ?? null);
    }

    private ensureSelectTemplate(comp: Record<string, unknown>): void {
        const props = this.readComponentProperties(comp);
        if (!comp['template'] && props['label']) {
            comp['template'] = '<span>{{ item.label || item.data?.label || item }}</span>';
        }
    }

    private readComponentProperties(c: Record<string, unknown>): Record<string, unknown> {
        const target: Record<string, unknown> = c;
        if (this.isRecord(target['properties'])) return target['properties'];
        if (this.isRecord(target['property'])) return target['property'];
        return {};
    }

    private readPropertyValue(p: Record<string, unknown>, keys: string[]): string {
        for (const k of keys) {
            const value = p[k];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    private readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) {
            if (typeof entry === 'string' && entry.trim()) return entry.trim();
        }
        return '';
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

    private toSelectValueOption(e: unknown): SelectValueOption | null {
        if (e == null) return null;
        if (!this.isRecord(e)) return { label: this.toDisplayValue(e), value: e };
        const nested = this.isRecord(e['data']) ? e['data'] : null;
        const v = e['value'] ?? e['id'] ?? e['_id'] ?? e['code'] ?? e['key'] ?? e['k'] ?? e['name'] ?? e['rec_name']
            ?? nested?.['value'] ?? nested?.['id'] ?? nested?.['_id'] ?? nested?.['code'] ?? nested?.['key'] ?? nested?.['k'] ?? nested?.['name'];
        const l = e['label'] ?? e['title'] ?? e['name'] ?? e['description'] ?? e['v']
            ?? nested?.['label'] ?? nested?.['title'] ?? nested?.['name'] ?? nested?.['description'] ?? nested?.['v']
            ?? v;
        return v !== undefined ? { label: this.toDisplayValue(l), value: v } : null;
    }

    private applyRemoteSelectValues(c: Record<string, unknown>, v: SelectValueOption[]): void {
        const currentData = this.isRecord(c['data']) ? c['data'] : {};
        const cleanedData: Record<string, unknown> = {};
        Object.entries(currentData).forEach(([key, value]) => {
            if (key === 'url' || key === 'method' || key === 'headers' || key === 'selectValues') return;
            cleanedData[key] = value;
        });
        c['data'] = { ...cleanedData, values: v };
        c['dataSrc'] = 'values';
        delete c['url'];
        delete c['method'];
        delete c['lazyLoad'];
        delete c['selectValues'];
        if (!c['valueProperty']) c['valueProperty'] = 'value';
    }

    private extractActionResponse(payload: unknown): ActionRouterResponse | null {
        if (!this.isRecord(payload)) return null;

        const hasActionPayloadFields = (node: Record<string, unknown>): boolean => (
            typeof node['mode'] === 'string'
            || Object.prototype.hasOwnProperty.call(node, 'data')
            || Object.prototype.hasOwnProperty.call(node, 'schema')
            || Object.prototype.hasOwnProperty.call(node, 'fields')
            || Object.prototype.hasOwnProperty.call(node, 'columns')
            || Object.prototype.hasOwnProperty.call(node, 'total_count')
            || Object.prototype.hasOwnProperty.call(node, 'model')
            || Object.prototype.hasOwnProperty.call(node, 'rec_name')
            || Object.prototype.hasOwnProperty.call(node, 'query')
            || Object.prototype.hasOwnProperty.call(node, 'batch_size')
            || Object.prototype.hasOwnProperty.call(node, 'editable_fields')
            || Object.prototype.hasOwnProperty.call(node, 'obfucated_fields')
            || Object.prototype.hasOwnProperty.call(node, 'filter_kyes')
        );

        const inferMode = (node: Record<string, unknown>, inheritedMode = ''): string => {
            const own = this.readFirstString(node['mode']).toLowerCase();
            if (own) return own;
            const inherited = this.readFirstString(inheritedMode).toLowerCase();
            if (inherited && inherited !== 'action') return inherited;
            if (typeof node['schema'] === 'string' && String(node['schema']).trim()) return 'form';
            if (this.isRecord(node['schema']) || Array.isArray(node['schema'])) return 'form';
            if (Object.prototype.hasOwnProperty.call(node, 'columns') || Object.prototype.hasOwnProperty.call(node, 'total_count') || Array.isArray(node['data'])) return 'list';
            return inherited;
        };

        const scoreCandidate = (candidate: ActionRouterResponse, depth: number): number => {
            const mode = this.readFirstString(candidate.mode).toLowerCase();
            let score = -(depth * 5);
            if (mode === 'form') score += 100;
            else if (mode === 'list') score += 90;
            else if (mode === 'layout') score += 80;
            else if (mode === 'menu') score += 70;
            else if (mode === 'card') score += 60;
            else if (mode === 'action') score += 10;
            if (this.isRecord(candidate.schema) || Array.isArray(candidate.schema)) score += 200;
            if (this.isRecord(candidate.data)) {
                score += 20;
                const nestedSchema = candidate.data['schema'];
                if (this.isRecord(nestedSchema) || Array.isArray(nestedSchema)) score += 120;
            }
            return score;
        };

        const queue: Array<{ node: Record<string, unknown>; mode: string; depth: number }> = [
            { node: payload, mode: '', depth: 0 }
        ];
        const visited = new Set<Record<string, unknown>>();
        let best: { score: number; candidate: ActionRouterResponse } | null = null;

        while (queue.length) {
            const current = queue.shift();
            if (!current) break;
            const node = current.node;
            if (visited.has(node)) continue;
            visited.add(node);

            const mode = inferMode(node, current.mode);
            if (hasActionPayloadFields(node)) {
                const candidate: ActionRouterResponse = {
                    ...(node as ActionRouterResponse),
                    ...(mode ? { mode } : {})
                };
                const score = scoreCandidate(candidate, current.depth);
                if (!best || score > best.score) best = { score, candidate };
            }

            const dataNode = node['data'];
            if (this.isRecord(dataNode)) {
                queue.push({ node: dataNode, mode, depth: current.depth + 1 });
            }
            for (const wrapper of this.responseWrappers) {
                const nested = node[wrapper];
                if (!this.isRecord(nested)) continue;
                queue.push({ node: nested, mode, depth: current.depth + 1 });
            }
        }

        return best?.candidate ?? null;
    }

    private applyLayoutResponse(payload: unknown): void {
        const response = this.extractActionResponse(payload);
        if (!response || String(response.mode ?? '').trim() !== 'layout') {
            throw new Error('Risposta layout non valida');
        }
        this.actionRouterActive = true;
        const data = this.isRecord(response.data) ? response.data : {};
        const schema = this.isRecord(data['schema']) ? data['schema'] : null;
        this.layoutName = this.readFirstString(data['layout'], schema?.['rec_name'], this.layoutName || 'default') || 'default';
        this.layoutSchema = schema ? this.cloneSchema(schema) : null;

        const layoutSettings = this.isRecord(data['settings']) ? data['settings'] : {};
        const settings = { ...this.sessionAppSettings, ...layoutSettings };
        const moduleName = this.readFirstString(
            settings['module_name'],
            settings['module_label'],
            settings['moduleName'],
            this.appModuleName
        );
        this.appModuleName = moduleName || this.appModuleName;
        this.appVersion = this.readFirstString(settings['app_version'], settings['version'], this.appVersion);
        const logoRaw = this.readFirstString(settings['logo'], settings['logo_img_url'], settings['logo_img'], settings['logo_url']);
        this.appLogoUrl = this.resolveBrandAssetUrl(logoRaw);

        const runtimeUser = this.readFirstString(settings['user_name'], settings['username'], settings['user']);
        if (runtimeUser && this.userNameSource === 'default') {
            this.currentUserName = runtimeUser;
            this.userNameSource = 'layout';
        }

        const menus = this.normalizeActionMenuCards(data['menu']);
        this.dashboardMenu = menus;
        this.actionMenuIntegrated = menus.length > 0;
        this.syncActiveDashboardGroup();
    }

    private applyMenuResponse(payload: unknown): void {
        const response = this.extractActionResponse(payload);
        if (!response || String(response.mode ?? '').trim() !== 'menu') {
            throw new Error('Risposta menu non valida');
        }
        this.actionRouterActive = true;
        this.dashboardMenu = this.normalizeActionMenuCards(response.data);
        this.syncActiveDashboardGroup();
        this.actionMenuIntegrated = this.dashboardMenu.length > 0;
    }

    private applyDashboardResponse(payload: unknown): void {
        const response = this.extractActionResponse(payload);
        if (!response || String(response.mode ?? '').trim() !== 'card') {
            throw new Error('Risposta dashboard non valida');
        }
        this.actionRouterActive = true;
        this.dashboardCards = this.normalizeActionCards(response.data);
    }

    private normalizeActionMenuCards(payload: unknown): MenuCard[] {
        const sourceList = Array.isArray(payload)
            ? payload
            : (this.isRecord(payload) ? [payload] : []);
        if (!sourceList.length) return [];
        const cards: MenuCard[] = [];
        sourceList.forEach((entry, index) => {
            if (!this.isRecord(entry)) return;
            const direct = this.toMenuCard(entry, index);
            if (direct) {
                cards.push(direct);
                return;
            }
            const dynamicCards = this.toDynamicMenuCards(entry, index);
            if (dynamicCards.length) {
                cards.push(...dynamicCards);
                return;
            }
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
            const parentTitle = card.parent && card.parent !== card.group_id
                ? this.humanizeModelLabel(parentId)
                : this.readFirstString(card.title, this.humanizeModelLabel(parentId), parentId);
            let parentCard = grouped.get(parentId);
            if (!parentCard) {
                parentCard = {
                    model: this.readFirstString(card.model),
                    group_id: parentId,
                    title: parentTitle,
                    buttons: [],
                    menu_type: this.normalizeMenuType(card.menu_type),
                    is_admin: Boolean(card.is_admin),
                    parent: parentId
                };
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
        return payload
            .map((entry, index) => this.toMenuCard(entry, index))
            .filter((entry): entry is MenuCard => Boolean(entry));
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
            const buttons = rawButtons
                .map((button, buttonIndex) => this.toMenuButton(button, buttonIndex, groupId, menuType))
                .filter((button): button is MenuButton => Boolean(button));
            if (!buttons.length) return;
            const title = this.readFirstString(groupTitle, `Gruppo ${index + 1}`);
            const isAdmin = this.isAdminMenuType(menuType) || this.guessAdminMenuByText(groupId, title);
            out.push({
                model: this.readFirstString(entry['model'], buttons[0]?.model),
                group_id: groupId,
                title,
                buttons,
                menu_type: menuType,
                is_admin: isAdmin,
                parent: this.readFirstString(entry['parent'], groupId)
            });
        });
        return out;
    }

    private toFlatMenuCard(entry: Record<string, unknown>, index: number): MenuCard | null {
        const groupId = this.readFirstString(entry['menu_group'], entry['group_id'], `group_${index}`);
        const menuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? entry['type']);
        const button = this.toMenuButton(entry, index, groupId, menuType);
        if (!button) return null;
        return {
            model: button.model,
            group_id: groupId,
            title: this.readFirstString(entry['menu_group_label'], entry['group_label'], this.humanizeModelLabel(groupId), groupId),
            buttons: [button],
            menu_type: menuType,
            is_admin: Boolean(button.is_admin),
            parent: this.readFirstString(entry['parent'], groupId)
        };
    }

    private toMenuCard(entry: unknown, index: number): MenuCard | null {
        if (!this.isRecord(entry)) return null;
        const groupId = this.readFirstString(entry['group_id'], entry['menu_group'], `group_${index}`);
        const menuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? entry['type']);
        const title = this.readFirstString(entry['title'], groupId || `Gruppo ${index + 1}`) || `Gruppo ${index + 1}`;
        const buttonsRaw = Array.isArray(entry['buttons']) ? entry['buttons'] : [];
        const buttons = buttonsRaw
            .map((button, buttonIndex) => this.toMenuButton(button, buttonIndex, groupId, menuType))
            .filter((button): button is MenuButton => Boolean(button));
        if (!buttons.length) return null;
        const isAdmin = this.isAdminMenuType(menuType) || this.guessAdminMenuByText(groupId, title);
        return {
            model: this.readFirstString(entry['model']),
            group_id: groupId,
            title,
            buttons,
            menu_type: menuType,
            is_admin: isAdmin,
            parent: this.readFirstString(entry['parent'], groupId)
        };
    }

    private toMenuButton(entry: unknown, index: number, groupId = '', menuType = ''): MenuButton | null {
        if (!this.isRecord(entry)) return null;
        const rawActionType = this.readFirstString(entry['action_type'], entry['type'], 'window') || 'window';
        const urlAction = this.readFirstString(entry['url_action'], entry['content'], '');
        const route = this.resolveMenuButtonRoute(rawActionType, urlAction);
        const actionType = route.actionType;
        const content = this.readFirstString(entry['content'], urlAction, '');
        const icon = this.readFirstString(entry['leftIcon'], entry['icon'], entry['button_icon'], 'pi pi-play') || 'pi pi-play';
        const numberRaw = Number(entry['number']);
        const number = Number.isFinite(numberRaw) ? numberRaw : undefined;
        const key = this.readFirstString(entry['key'], entry['rec_name'], entry['label'], `action_${index}`);
        const buttonGroup = this.readFirstString(entry['menu_group'], groupId);
        const buttonMenuType = this.normalizeMenuType(entry['menu_type'] ?? entry['menuType'] ?? menuType);
        const isAdmin =
            this.toBooleanFlag(entry['is_admin']) ||
            this.isAdminMenuType(buttonMenuType) ||
            this.guessAdminMenuByText(buttonGroup, this.readFirstString(entry['label'], entry['title']));
        return {
            model: this.readFirstString(entry['model'], this.selectedModel),
            key: key || `action_${index}`,
            type: 'button',
            label: this.readFirstString(entry['label'], entry['title'], key || `Action ${index + 1}`) || `Action ${index + 1}`,
            leftIcon: icon,
            authtoken: this.baseToken,
            req_id: this.uiReqId,
            btn_action_type: this.btnActionParser[actionType] ?? false,
            action_type: actionType,
            url_action: route.urlAction,
            builder: this.toBooleanFlag(entry['builder'] ?? entry['builder_enabled']),
            mode: this.readFirstString(entry['mode']),
            content,
            number,
            menu_group: buttonGroup,
            menu_type: buttonMenuType,
            is_admin: isAdmin
        };
    }

    private syncActiveDashboardGroup(): void {
        const visibleCards = this.topMenuCards;
        if (!visibleCards.length) {
            this.activeDashboardGroup = '';
            this.openedNavMenuGroup = '';
            return;
        }
        if (!visibleCards.some(card => card.group_id === this.activeDashboardGroup)) {
            this.activeDashboardGroup = visibleCards[0].group_id;
        }
        if (this.openedNavMenuGroup && !visibleCards.some(card => card.group_id === this.openedNavMenuGroup)) {
            this.openedNavMenuGroup = '';
        }
    }

    private normalizeMenuType(value: unknown): string {
        return String(value ?? '').trim().toLowerCase();
    }

    private isAdminMenuType(value: unknown): boolean {
        return this.normalizeMenuType(value) === 'admin';
    }

    private guessAdminMenuByText(...values: unknown[]): boolean {
        const text = values.map(value => String(value ?? '').trim().toLowerCase()).join(' ');
        if (!text) return false;
        return /\badmin\b/.test(text) || /\bdesign\b/.test(text);
    }

    private isAdminMenuCard(card: MenuCard): boolean {
        if (!card) return false;
        if (card.is_admin) return true;
        if (this.isAdminMenuType(card.menu_type)) return true;
        return this.guessAdminMenuByText(card.group_id, card.title);
    }

    private resolveMenuButtonRoute(actionType: string, rawActionPath: string): { actionType: string; urlAction: string } {
        const normalizedType = this.normalizeMenuType(actionType);
        const normalizedPath = this.normalizeActionUrl(rawActionPath || '/');
        if (normalizedType !== 'menu') {
            return { actionType, urlAction: normalizedPath };
        }
        if (!this.hasRunnableMenuPath(normalizedPath)) {
            return { actionType: 'menu', urlAction: normalizedPath };
        }
        return {
            actionType: 'window',
            urlAction: this.normalizeRunnableMenuPath(normalizedPath)
        };
    }

    private hasRunnableMenuPath(actionPath: string): boolean {
        const normalizedPath = this.normalizeActionUrl(actionPath || '/');
        return normalizedPath !== '/' && normalizedPath !== '/menu';
    }

    private normalizeRunnableMenuPath(actionPath: string): string {
        let normalizedPath = this.normalizeActionUrl(actionPath || '/');
        if (normalizedPath.startsWith('/actoin/')) {
            normalizedPath = this.normalizeActionUrl(`/action/${normalizedPath.slice('/actoin/'.length)}`);
        }
        if (
            normalizedPath === '/dashboard'
            || normalizedPath.startsWith('/action/')
            || normalizedPath.startsWith('/list/')
            || normalizedPath.startsWith('/record/')
        ) {
            return normalizedPath;
        }
        const actionName = normalizedPath.replace(/^\/+/, '');
        if (!actionName) return '/';
        return this.normalizeActionUrl(`/action/${actionName}`);
    }

    private isMenuContainerButton(button: MenuButton): boolean {
        return this.normalizeMenuType(button?.action_type) === 'menu';
    }

    private isBuilderAction(button: MenuButton): boolean {
        if (!button) return false;
        if (button.builder) return true;
        const label = this.readFirstString(button.label).toLowerCase();
        const path = this.getButtonActionPath(button).toLowerCase();
        return label.includes('design') || label.includes('resource') || path.includes('/design') || path.includes('/resource');
    }

    private rebuildMenus(): void {
        if (this.actionRouterActive) {
            this.contextualActions = [];
            this.syncActiveDashboardGroup();
            return;
        }
        this.dashboardMenu = this.makeMainMenu();
        this.dashboardCards = this.makeMainMenu();
        this.contextualActions = this.makeActionButtons(this.makeContextualActions(), this.getActiveRecName());
        this.syncActiveDashboardGroup();
    }

    private makeMainMenu(): MenuCard[] {
        return this.makeDashboardMenu();
    }

    private getBasicMenuList(): Array<{ model: string; menu_group: string; label: string }> {
        return this.models.map(model => ({
            model,
            menu_group: model,
            label: this.humanizeModelLabel(model)
        }));
    }

    private makeDashboardMenu(): MenuCard[] {
        const cards: MenuCard[] = [];
        const basicList = this.getBasicMenuList();
        for (const card of basicList) {
            cards.push(this.makeMenuItem(card));
        }
        return cards;
    }

    private makeMenuItem(card: { model: string; menu_group: string; label: string }): MenuCard {
        const actions: MenuActionDescriptor[] = [
            {
                model: card.model,
                rec_name: card.model,
                title: 'Schema',
                action_type: 'window',
                action_root_path: '/record',
                button_icon: 'pi pi-file',
                builder_enabled: false,
                mode: 'form',
                content: `/record/${encodeURIComponent(card.model)}`
            },
            {
                model: card.model,
                rec_name: card.model,
                title: 'Lista',
                action_type: 'window',
                action_root_path: '/list',
                button_icon: 'pi pi-list',
                builder_enabled: false,
                mode: 'list',
                content: `/list/${encodeURIComponent(card.model)}`,
                number: card.model === this.selectedModel ? this.tableRows.length : 0
            }
        ];

        const activeRec = this.getActiveRecName();
        if (card.model === this.selectedModel && activeRec) {
            actions.push({
                model: card.model,
                rec_name: activeRec,
                title: 'Apri record',
                action_type: 'window',
                action_root_path: `/record/${encodeURIComponent(card.model)}`,
                button_icon: 'pi pi-external-link',
                builder_enabled: false,
                mode: 'form',
                content: `/record/${encodeURIComponent(card.model)}/${encodeURIComponent(activeRec)}`
            });
        }

        return {
            model: card.model,
            group_id: card.menu_group,
            title: card.label,
            buttons: this.makeButtons(actions)
        };
    }

    private makeContextualActions(): MenuActionDescriptor[] {
        if (!this.selectedModel) return [];
        const activeRec = this.getActiveRecName();
        const actionRoot = `/record/${encodeURIComponent(this.selectedModel)}`;
        const actions: MenuActionDescriptor[] = [
            {
                model: this.selectedModel,
                rec_name: activeRec || 'save',
                title: 'Salva',
                action_type: 'save',
                action_root_path: actionRoot,
                button_icon: 'pi pi-save',
                builder_enabled: false,
                mode: 'form'
            },
            {
                model: this.selectedModel,
                rec_name: activeRec || 'copy',
                title: 'Copia rec_name',
                action_type: 'copy',
                action_root_path: actionRoot,
                button_icon: 'pi pi-copy',
                builder_enabled: false,
                mode: 'form'
            },
            {
                model: this.selectedModel,
                rec_name: activeRec || 'delete',
                title: 'Rimuovi da vista',
                action_type: 'delete',
                action_root_path: actionRoot,
                button_icon: 'pi pi-trash',
                builder_enabled: false,
                mode: 'list'
            }
        ];

        if (activeRec) {
            actions.unshift({
                model: this.selectedModel,
                rec_name: activeRec,
                title: 'Apri record',
                action_type: 'window',
                action_root_path: actionRoot,
                button_icon: 'pi pi-external-link',
                builder_enabled: false,
                mode: 'form',
                content: `/record/${encodeURIComponent(this.selectedModel)}/${encodeURIComponent(activeRec)}`
            });
        }
        return actions;
    }

    private makeButtons(listActions: MenuActionDescriptor[], groupByField = '', recName = ''): MenuButton[] {
        if (!groupByField) return this.makeActionButtons(listActions, recName);
        return this.makeActionButtons(listActions, recName);
    }

    private makeButtonMainMenu(action: MenuActionDescriptor): MenuButton {
        const button = this.makeActionButtons([action])[0];
        if (!button) throw new Error('Impossibile creare pulsante menu');
        return button;
    }

    private makeActionButtons(listActions: MenuActionDescriptor[], recName = ''): MenuButton[] {
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

            if (
                item.rec_name === recNameAction ||
                !Object.prototype.hasOwnProperty.call(this.btnActionParser, item.action_type)
            ) {
                urlAction = `${item.action_root_path}/${recNameAction}`;
            }

            buttons.push({
                model: item.model,
                key: item.rec_name,
                type: 'button',
                label: item.title,
                leftIcon: item.button_icon,
                authtoken: this.baseToken,
                req_id: this.uiReqId,
                btn_action_type: this.btnActionParser[item.action_type],
                action_type: item.action_type,
                url_action: this.normalizeActionUrl(urlAction),
                builder: item.builder_enabled,
                mode: item.mode,
                content: item.content,
                number: item.number,
                menu_group: '',
                menu_type: '',
                is_admin: false
            });
        }
        return buttons;
    }

    private normalizeActionUrl(url: string): string {
        let normalized = `/${String(url || '').trim().replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
        // Backend redirects may include proxy prefix (/api/action/...); keep internal router paths canonical.
        if (normalized === '/api') normalized = '/';
        else if (normalized.startsWith('/api/')) normalized = `/${normalized.slice('/api/'.length)}`.replace(/\/{2,}/g, '/');
        return normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
    }

    private humanizeModelLabel(model: string): string {
        return String(model)
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, s => s.toUpperCase());
    }

    canRunMenuAction(button: MenuButton): boolean {
        if (!button) return false;
        if (this.isMenuContainerButton(button)) return false;
        if (button.is_admin && !this.builderEnabled) return false;
        if (this.isBuilderAction(button) && !this.builderEnabled) return false;
        const actionPath = this.getButtonActionPath(button);
        if (actionPath.startsWith('/action/')) return true;
        if (button.action_type === 'save') return Boolean(this.selectedModel && this.formSubmission?.data);
        if (button.action_type === 'copy' || button.action_type === 'delete') return Boolean(this.getActiveRecName());
        if (button.action_type === 'window' && String(button.mode || '') === 'form') {
            return Boolean(this.selectedModel);
        }
        return true;
    }

    async runMenuAction(button: MenuButton): Promise<void> {
        if (!button) return;
        if (this.isMenuContainerButton(button)) return;
        if (!this.canRunMenuAction(button)) {
            this.setStatus(`Azione non disponibile: ${button.label}`, true);
            return;
        }
        const actionPath = this.getButtonActionPath(button);
        if (actionPath.startsWith('/action/')) {
            await this.navigateToPath(actionPath);
            return;
        }

        if (button.action_type === 'window') {
            await this.runWindowAction(button);
            return;
        }
        if (button.action_type === 'save') {
            await this.saveCurrentRecord();
            return;
        }
        if (button.action_type === 'copy') {
            await this.copyCurrentRecordName();
            return;
        }
        if (button.action_type === 'delete') {
            this.removeCurrentRecordFromView();
            return;
        }
        this.setStatus(`Azione non supportata: ${button.action_type}`, true);
    }

    private async runWindowAction(button: MenuButton): Promise<void> {
        await this.runWindowPath(this.getButtonActionPath(button));
    }

    private async runWindowPath(rawPath: string): Promise<void> {
        const segments = rawPath
            .split('/')
            .map(entry => entry.trim())
            .filter(Boolean)
            .map(entry => decodeURIComponent(entry));

        if (!segments.length) return;
        if (segments[0] === 'dashboard') {
            await this.navigateToPath('/dashboard');
            return;
        }
        if (segments[0] === 'action') {
            await this.navigateToPath(rawPath);
            return;
        }

        if (segments[0] === 'list' && segments[1]) {
            const model = segments[1];
            if (model !== this.selectedModel) {
                this.selectedModel = model;
                this.onModelChanged();
            }
            await this.loadSchema();
            await this.loadRecords();
            this.viewMode = 'list';
            return;
        }

        if (segments[0] === 'record' && segments[1]) {
            const model = segments[1];
            const recName = segments[2] ?? '';
            if (model !== this.selectedModel) {
                this.selectedModel = model;
                this.onModelChanged();
            }
            if (recName) {
                this.selectedRecordName = recName;
                this.rebuildMenus();
                await this.openSelectedRecord();
                this.viewMode = 'form';
            } else {
                await this.loadSchema();
                this.viewMode = 'form';
            }
            return;
        }

        this.setStatus(`Azione window non riconosciuta: ${rawPath}`, true);
    }

    private getButtonActionPath(button: MenuButton): string {
        const raw = this.readFirstString(button.url_action, button.content, '');
        return this.normalizeActionUrl(raw || '/');
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
        if (explicitSpriteRef) {
            return `${explicitSpriteRef[1]}#${explicitSpriteRef[2].toLowerCase()}`;
        }

        const iconId = this.extractBootstrapItaliaIconId(rawIcon);
        return iconId ? `bootstrap-italia/dist/svg/sprites.svg#${iconId}` : '';
    }

    private extractBootstrapItaliaIconId(rawIcon: string): string {
        const normalized = String(rawIcon || '').trim();
        if (!normalized) return '';

        if (normalized.startsWith('#it-')) {
            return normalized.slice(1).toLowerCase();
        }

        if (normalized.startsWith('it-')) {
            return normalized.toLowerCase();
        }

        const tokens = normalized.split(/\s+/).map(token => token.trim()).filter(Boolean);
        const tokenMatch = tokens.find(token => token.startsWith('it-'));
        if (tokenMatch) return tokenMatch.toLowerCase();

        const plain = normalized.replace(/^#/, '').trim().toLowerCase().replace(/_/g, '-');
        const likelyClassPrefix = /^(pi|fa|bi|mdi|ph|ti|ri)(-|$)/;
        if (!plain.includes(' ') && /^[a-z0-9-]+$/.test(plain) && !likelyClassPrefix.test(plain)) {
            return plain.startsWith('it-') ? plain : `it-${plain}`;
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

    private collectNextActionRedirectCandidates(payload: unknown): unknown[] {
        const candidates: unknown[] = [];
        const collect = (node: unknown): void => {
            if (typeof node === 'string') {
                candidates.push(node);
                return;
            }
            if (!this.isRecord(node)) return;
            candidates.push(
                node['redirect'],
                node['redirect_to'],
                node['next_page'],
                node['nextPage'],
                node['next_path'],
                node['path'],
                node['url'],
                node['url_action'],
                node['location']
            );
            collect(node['data']);
            for (const wrapper of this.responseWrappers) {
                collect(node[wrapper]);
            }
        };

        collect(payload);
        return candidates;
    }

    private extractNextActionRedirectRaw(payload: unknown): string {
        const candidates = this.collectNextActionRedirectCandidates(payload);
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
        return '';
    }

    private extractNextActionRedirectPath(payload: unknown): string {
        const candidates = this.collectNextActionRedirectCandidates(payload);
        for (const candidate of candidates) {
            const path = this.normalizeNextActionRedirectCandidate(candidate);
            if (path) return path;
        }
        return '';
    }

    private normalizeNextActionRedirectCandidate(candidate: unknown): string {
        if (typeof candidate !== 'string') return '';
        let raw = candidate.trim();
        if (!raw) return '';
        raw = raw.replace(/^https?:\/\/[^/]+/i, '');
        raw = raw.replace(/^\/+/, '');
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

    private extractNextActionRedirectStatus(payload: unknown): number {
        const statuses: unknown[] = [];
        const collect = (node: unknown): void => {
            if (!this.isRecord(node)) return;
            statuses.push(node['redirect_status'], node['redirectStatus'], node['status_code'], node['http_status']);
            collect(node['data']);
            for (const wrapper of this.responseWrappers) {
                collect(node[wrapper]);
            }
        };
        collect(payload);
        for (const status of statuses) {
            const parsed = Number(status);
            if (!Number.isFinite(parsed)) continue;
            const value = Math.floor(parsed);
            if (value >= 300 && value <= 399) return value;
        }
        return 0;
    }

    private extractNextActionResponseMode(payload: unknown): string {
        const modes: unknown[] = [];
        const collect = (node: unknown): void => {
            if (!this.isRecord(node)) return;
            modes.push(node['mode']);
            collect(node['data']);
            for (const wrapper of this.responseWrappers) {
                collect(node[wrapper]);
            }
        };
        collect(payload);
        for (const mode of modes) {
            if (typeof mode !== 'string') continue;
            const normalized = mode.trim().toLowerCase();
            if (normalized) return normalized;
        }
        return '';
    }

    private shouldLetBrowserHandle(event: MouseEvent): boolean {
        return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
    }

    private async runActionRoute(path: string): Promise<void> {
        const route = this.parseActionRoute(path);
        if (!route) {
            this.setStatus(`Azione non valida: ${path}`, true);
            return;
        }
        if (route.name === 'next_action') {
            await this.runNextActionRoute(route.args);
            return;
        }
        this.currentActionName = route.name;
        this.setStatus(`Caricamento azione: ${route.name}`, false);
        try {
            const response = await this.api.getAction(route.name, {
                recName: route.recName,
                query: this.parseQueryInput() ?? {},
                order: this.order,
                skip: this.skip,
                limit: this.limit
            });
            const redirectStatus = this.extractNextActionRedirectStatus(response);
            const redirectRaw = this.extractNextActionRedirectRaw(response);
            const redirectPath = this.extractNextActionRedirectPath(response);

            if (redirectStatus === 307 && (redirectPath || redirectRaw)) {
                const reloadTarget = redirectPath || redirectRaw;
                const reload = this.mainManager.hardReloadToUrl(reloadTarget);
                if (reload.reloaded) {
                    return;
                }
                if (reload.blocked) {
                    this.setStatus(
                        `Redirect bloccato: origin non abilitata (${reloadTarget})`,
                        true
                    );
                    return;
                }
            }

            if (redirectPath) {
                await this.navigateToPath(redirectPath, true);
                return;
            }
            await this.applyActionResponse(response);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    private async runNextActionRoute(args: string[]): Promise<void> {
        const currentAction = this.readFirstString(args[0], this.resolveCurrentActionName());
        const recName = this.readFirstString(args[1]);
        if (!currentAction) {
            this.setStatus('next_action richiede current_action', true);
            return;
        }
        this.setStatus(`Caricamento next_action: ${currentAction}${recName ? `/${recName}` : ''}`, false);
        try {
            const response = await this.api.getNextAction(currentAction, recName);
            const responseRecord = this.asRecord(response);
            const embeddedContent = responseRecord ? responseRecord['content'] : null;
            const embeddedActionResponse = this.extractActionResponse(embeddedContent);
            const redirectStatus = this.extractNextActionRedirectStatus(response);
            const redirectRaw = this.extractNextActionRedirectRaw(response);
            const redirectPath = this.extractNextActionRedirectPath(response);
            const responseMode = this.extractNextActionResponseMode(response);

            if (responseMode === 'redirect' && (redirectPath || redirectRaw)) {
                const reloadTarget = redirectPath || redirectRaw;
                const reload = this.mainManager.hardReloadToUrl(reloadTarget);
                if (reload.reloaded) {
                    return;
                }
                if (reload.blocked) {
                    this.setStatus(
                        `Redirect bloccato: origin non abilitata (${reloadTarget})`,
                        true
                    );
                    return;
                }
            }

            if (redirectStatus === 307 && (redirectPath || redirectRaw)) {
                // Prefer canonical internal app path to avoid cross-origin hard reloads.
                const reloadTarget = redirectPath || redirectRaw;
                const reload = this.mainManager.hardReloadToUrl(reloadTarget);
                if (reload.reloaded) {
                    return;
                }
                if (reload.blocked) {
                    this.setStatus(
                        `Redirect bloccato: origin non abilitata (${reloadTarget})`,
                        true
                    );
                    return;
                }
            }

            if (redirectPath) {
                // Always resolve redirect by loading the canonical action route.
                await this.navigateToPath(redirectPath, true);
                return;
            }

            const actionResponse = embeddedActionResponse ?? this.extractActionResponse(response);
            if (actionResponse?.mode) {
                await this.applyActionResponse(actionResponse);
                return;
            }
            throw new Error('Risposta next_action senza path di redirect');
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    private parseActionRoute(path: string): { name: string; recName: string; args: string[] } | null {
        const normalizedPath = this.normalizeActionUrl(path).split('?')[0];
        const segments = normalizedPath
            .split('/')
            .map(segment => segment.trim())
            .filter(Boolean)
            .map(segment => decodeURIComponent(segment));
        if (segments[0] !== 'action' || !segments[1]) return null;
        const args = segments.slice(2);
        return {
            name: segments[1],
            recName: args[0] ?? '',
            args
        };
    }

    private async applyActionResponse(payload: unknown): Promise<void> {
        const failedMessage = this.readEnvelopeFailureMessage(payload);
        if (failedMessage) throw new Error(failedMessage);

        const response = this.extractActionResponse(payload);
        if (!response) throw new Error('Risposta action non valida');
        const mode = String(response.mode ?? '').trim().toLowerCase();
        const fields = this.isRecord(response.fields) ? response.fields : {};
        const responseActionName = this.readFirstString(fields['action_name'], fields['current_action']);

        if (mode !== 'list') {
            this.resetTableRowActionsConfig();
            this.listQuerySeed = null;
        }

        if (mode === 'layout') {
            this.applyLayoutResponse(response);
            this.setStatus(`Layout caricato: ${this.layoutName || 'default'}`, false);
            return;
        }
        if (mode === 'menu') {
            this.applyMenuResponse(response);
            this.setStatus(`Menu caricato: ${this.dashboardMenu.length} gruppi`, false);
            return;
        }
        if (mode === 'card') {
            this.applyDashboardResponse(response);
            this.currentActionName = '';
            this.viewMode = 'dashboard';
            this.setStatus(`Dashboard caricata: ${this.dashboardCards.length} card`, false);
            return;
        }
        if (mode === 'list') {
            if (responseActionName) this.currentActionName = responseActionName;
            await this.applyActionListResponse(response);
            this.viewMode = 'list';
            this.setStatus(`Lista caricata: ${this.tableRows.length} record`, false);
            return;
        }
        if (mode === 'form') {
            if (responseActionName) this.currentActionName = responseActionName;
            await this.applyActionFormResponse(response, payload);
            this.viewMode = 'form';
            this.setStatus(`Record caricato: ${this.selectedRecordName || 'N/A'}`, false);
            return;
        }
        if (mode === 'action') {
            const data = this.isRecord(response.data) ? response.data : {};
            const message = this.readFirstString(data['message'], data['status'], 'Azione completata');
            this.setStatus(message || 'Azione completata', false);
            return;
        }

        this.setStatus(`Modalita azione non supportata: ${mode || 'unknown'}`, true);
    }

    private async applyActionListResponse(response: ActionRouterResponse): Promise<void> {
        this.syncTableRowActionsConfig(response);
        const rows = this.normalizeActionListData(response.data);
        const responseData = this.asRecord(response.data) ?? {};
        this.resetSelectionAndTable({ preserveFilterText: true });
        this.strictHeaderColumns = Boolean(response.columns);
        this.tableTotalRecords = this.parseNonNegativeInt(response.total_count, rows.length);
        this.applyTableColumnsFromHeader(response.columns);
        rows.forEach(row => this.appendRecordRow(row));
        this.flushRows();
        const responseModel = this.readFirstString(response.model);
        if (responseModel) this.selectedModel = responseModel;
        this.formSubmission = null;
        let listSchema: Record<string, unknown> | null = this.extractSchema({
            schema: response.schema,
            data: { schema: response.schema }
        });
        if (!listSchema) listSchema = this.extractSchema(responseData);
        if (!listSchema && this.isRecord(responseData['schema'])) {
            listSchema = this.extractSchema({
                schema: responseData['schema'],
                data: { schema: responseData['schema'] }
            });
        }
        this.syncListQuerySeed(response, responseData, listSchema);
        if (listSchema) {
            this.rawFormSchema = this.cloneSchema(listSchema);
            this.rawFormSchemaModel = this.selectedModel;
        }
        await this.refreshTableCellRenderers(rows);
        this.syncBuilderMode(response, null, null);
        this.rebuildMenus();
    }

    private resetTableRowActionsConfig(): void {
        this.tableCalledInsideForm = false;
        this.tableCopyEnabled = false;
        this.tableRemoveEnabled = false;
        this.tableCopyActionPath = '';
        this.tableRemoveActionPath = '';
    }

    private syncTableRowActionsConfig(response: ActionRouterResponse): void {
        const fields = this.isRecord(response.fields) ? response.fields : {};
        const data = this.isRecord(response.data) ? response.data : {};
        const candidates: Array<Record<string, unknown>> = [
            fields,
            data,
            this.isRecord(fields['table']) ? fields['table'] : {},
            this.isRecord(fields['table_action']) ? fields['table_action'] : {},
            this.isRecord(fields['table_actions']) ? fields['table_actions'] : {},
            this.isRecord(data['table']) ? data['table'] : {},
            this.isRecord(data['table_action']) ? data['table_action'] : {},
            this.isRecord(data['table_actions']) ? data['table_actions'] : {},
            this.isRecord(data['settings']) ? data['settings'] : {}
        ];

        const inForm = this.readFirstBooleanFromCandidates(candidates, [
            'table_in_form',
            'in_form',
            'inside_form',
            'is_form_context',
            'form_context',
            'called_in_form',
            'from_form'
        ]);
        const copyEnabled = this.readFirstBooleanFromCandidates(candidates, [
            'table_copy_enabled',
            'copy_enabled',
            'enable_copy',
            'allow_copy',
            'copy_active',
            'show_copy'
        ]);
        const removeEnabled = this.readFirstBooleanFromCandidates(candidates, [
            'table_remove_enabled',
            'remove_enabled',
            'enable_remove',
            'allow_remove',
            'remove_active',
            'show_remove',
            'delete_enabled',
            'enable_delete'
        ]);
        const copyActionPath = this.readFirstStringFromCandidates(candidates, [
            'copy_url',
            'table_copy_url',
            'copy_action_url',
            'copy_action',
            'url_action_copy'
        ]);
        const removeActionPath = this.readFirstStringFromCandidates(candidates, [
            'remove_url',
            'table_remove_url',
            'delete_url',
            'remove_action_url',
            'delete_action_url',
            'remove_action',
            'delete_action',
            'url_action_remove'
        ]);

        this.tableCalledInsideForm = inForm ?? false;
        this.tableCopyEnabled = copyEnabled ?? Boolean(copyActionPath);
        this.tableRemoveEnabled = removeEnabled ?? Boolean(removeActionPath);
        this.tableCopyActionPath = copyActionPath;
        this.tableRemoveActionPath = removeActionPath;
    }

    private readFirstBooleanFromCandidates(
        candidates: Array<Record<string, unknown>>,
        keys: string[]
    ): boolean | null {
        for (const candidate of candidates) {
            for (const key of keys) {
                const value = this.toOptionalBooleanFlag(candidate[key]);
                if (value !== null) return value;
            }
        }
        return null;
    }

    private readFirstStringFromCandidates(
        candidates: Array<Record<string, unknown>>,
        keys: string[]
    ): string {
        for (const candidate of candidates) {
            for (const key of keys) {
                const value = this.readFirstString(candidate[key]);
                if (value) return value;
            }
        }
        return '';
    }

    private syncListQuerySeed(
        response: ActionRouterResponse,
        responseData: Record<string, unknown>,
        listSchema: Record<string, unknown> | null
    ): void {
        const fields = this.isRecord(response.fields) ? response.fields : {};
        const data = this.isRecord(response.data) ? response.data : {};
        const tableField = this.isRecord(fields['table']) ? fields['table'] : {};
        const tableData = this.isRecord(data['table']) ? data['table'] : {};
        const settingsData = this.isRecord(data['settings']) ? data['settings'] : {};
        const directCandidates: unknown[] = [
            fields['query'],
            data['query'],
            tableField['query'],
            tableData['query'],
            settingsData['query']
        ];
        for (const candidate of directCandidates) {
            const normalized = this.normalizeQuerySeed(candidate);
            if (normalized) {
                this.listQuerySeed = normalized;
                return;
            }
        }

        const wellSeed = this.findWellQuerySeed(listSchema);
        this.listQuerySeed = wellSeed;
    }

    private normalizeQuerySeed(value: unknown): Record<string, unknown> | null {
        if (this.isRecord(value)) {
            return Object.keys(value).length ? this.cloneSchema(value) : null;
        }
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            return this.isRecord(parsed) && Object.keys(parsed).length
                ? this.cloneSchema(parsed)
                : null;
        } catch {
            return null;
        }
    }

    private findWellQuerySeed(schema: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!schema) return null;
        const wells = this.findWellComponents(schema);
        const preferredTypes = new Set(['search_area', 'export_area']);
        for (const well of wells) {
            const kind = this.readWellComponentKind(well);
            if (!preferredTypes.has(kind)) continue;
            const properties = this.readComponentProperties(well);
            const normalized = this.normalizeQuerySeed(properties['query']);
            if (normalized) return normalized;
            const data = this.isRecord(well['data']) ? well['data'] : {};
            const fallback = this.normalizeQuerySeed(data['query']);
            if (fallback) return fallback;
        }
        return null;
    }

    private findWellComponents(src: unknown): Record<string, unknown>[] {
        const wells: Record<string, unknown>[] = [];
        const visit = (node: unknown): void => {
            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }
            if (!this.isRecord(node)) return;
            const type = String(node['type'] ?? '').trim().toLowerCase();
            if (type === 'well') wells.push(node);
            Object.values(node).forEach(visit);
        };
        visit(src);
        return wells;
    }

    private readWellComponentKind(component: Record<string, unknown>): string {
        const properties = this.readComponentProperties(component);
        return this.readFirstString(
            properties['type'],
            component['well_type'],
            component['wellType']
        ).toLowerCase();
    }

    private normalizeActionListData(payload: unknown): Array<Record<string, unknown>> {
        if (Array.isArray(payload)) {
            return payload.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
        }
        if (!this.isRecord(payload)) return [];
        const target = payload['data'] ?? payload['items'] ?? payload['records'];
        if (Array.isArray(target)) {
            return target.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
        }
        return [];
    }

    private async applyActionFormResponse(response: ActionRouterResponse, sourcePayload: unknown = null): Promise<void> {
        const responseData = this.asRecord(response.data) ?? {};
        const responseDataSchema = this.extractSchema(responseData);
        const nestedResponseData = this.asRecord(responseData['data']);
        let data = responseDataSchema && nestedResponseData ? nestedResponseData : responseData;

        const sourceData = this.isRecord(sourcePayload) && this.isRecord(sourcePayload['data']) ? sourcePayload['data'] : null;
        const envelopeCandidates: unknown[] = this.isRecord(sourcePayload)
            ? [
                sourcePayload,
                sourcePayload['content'],
                sourcePayload['payload'],
                sourcePayload['response'],
                sourcePayload['result'],
                sourcePayload['action'],
                sourceData,
                sourceData ? sourceData['content'] : null,
                sourceData ? sourceData['payload'] : null,
                sourceData ? sourceData['response'] : null,
                sourceData ? sourceData['result'] : null,
                sourceData ? sourceData['action'] : null
            ]
            : [];
        if (!Object.keys(data).length && envelopeCandidates.length) {
            for (const candidate of envelopeCandidates) {
                const candidateRecord = this.asRecord(candidate);
                if (!candidateRecord) continue;
                const candidateSchema = this.extractSchema(candidateRecord);
                if (!candidateSchema) continue;
                const candidateData = this.asRecord(candidateRecord['data']);
                if (candidateData && Object.keys(candidateData).length) {
                    data = candidateData;
                    break;
                }
            }
        }
        data = this.normalizeFormSubmissionData(data);

        const responseModel = this.readFirstString(response.model, data['model'], responseData['model']);
        if (responseModel) this.selectedModel = responseModel;
        const recName = this.readFirstString(response.rec_name, data['rec_name'], this.selectedRecordName);
        this.selectedRecordName = recName;

        let schema: Record<string, unknown> | null = this.extractSchema({
            schema: response.schema,
            data: { schema: response.schema }
        });
        if (!schema) schema = responseDataSchema;
        if (!schema) {
            schema = this.extractSchema({
                schema: data['schema'],
                data: { schema: data['schema'] }
            });
        }
        if (!schema && envelopeCandidates.length) {
            for (const candidate of envelopeCandidates) {
                schema = this.extractSchema(candidate);
                if (schema) break;
            }
        }
        if (!schema) {
            const modelFromAction = this.inferModelFromActionName(this.currentActionName);
            const schemaModel = this.readFirstString(responseModel, this.selectedModel, modelFromAction);
            if (schemaModel && !responseModel) this.selectedModel = schemaModel;
            if (schemaModel) schema = await this.loadModelSchemaForActionForm(schemaModel);
        }
        if (schema) {
            this.rawFormSchema = this.cloneSchema(schema);
            this.rawFormSchemaModel = this.selectedModel;
        }

        const canReuseCachedSchema =
            Boolean(this.rawFormSchema)
            && (!this.selectedModel || !this.rawFormSchemaModel || this.rawFormSchemaModel === this.selectedModel);
        const baseSchema = schema
            ? this.cloneSchema(schema)
            : (canReuseCachedSchema && this.rawFormSchema ? this.cloneSchema(this.rawFormSchema) : null);
        this.formSubmission = { data };
        this.formSchema = baseSchema ? await this.hydrateRemoteSelectSchema(baseSchema, data) : null;
        await this.refreshTableCellRenderers(this.allRows);
        if (!this.formSchema) {
            const actionName = this.currentActionName || 'unknown';
            const modelName = this.selectedModel ? ` (model: ${this.selectedModel})` : '';
            throw new Error(`Schema non trovato per action form "${actionName}"${modelName}`);
        }
        this.syncBuilderMode(response, data, this.formSchema);
        this.rebuildMenus();
    }

    private inferModelFromActionName(actionName: string): string {
        const raw = String(actionName || '').trim().toLowerCase();
        if (!raw) return '';
        const candidates = [
            { prefix: 'form_form_', value: raw.slice('form_form_'.length) },
            { prefix: 'form_', value: raw.slice('form_'.length) }
        ];
        for (const candidate of candidates) {
            if (!raw.startsWith(candidate.prefix)) continue;
            const model = candidate.value.replace(/^_+|_+$/g, '').trim();
            if (model) return model;
        }
        return '';
    }

    private async loadModelSchemaForActionForm(model: string): Promise<Record<string, unknown> | null> {
        try {
            const payload = await this.api.getRecordSchema(model);
            const schema = this.extractSchema(payload);
            if (schema) return schema;

            // Accept empty components as valid schema fallback when backend intentionally returns a blank form.
            if (!this.isRecord(payload)) return null;
            const target: any = payload['content'] || payload;
            const candidates = [target['schema'], target['formio'], target['components'], target['data']?.['schema']];
            for (const candidate of candidates) {
                if (Array.isArray(candidate)) return { display: 'form', components: candidate };
                if (this.isRecord(candidate) && Array.isArray(candidate['components'])) return candidate as Record<string, unknown>;
            }
            return null;
        } catch {
            return null;
        }
    }

    onFormBuilderChanged(event: unknown): void {
        const schema = this.extractBuilderSchema(event);
        if (!schema) return;
        this.builderSchemaDraft = this.cloneSchema(schema);
        this.formSchema = this.cloneSchema(schema);
        this.applyBuilderDraftToSubmission();
        this.setStatus('Schema aggiornata in builder mode', false);
    }

    private syncBuilderMode(
        response: ActionRouterResponse,
        data: Record<string, unknown> | null,
        schema: Record<string, unknown> | null
    ): void {
        const eligible = Boolean(schema) && this.isBuilderEligibleResponse(response, data);
        this.builderEligibleCurrentForm = eligible;
        if (!eligible || !schema) {
            this.builderMode = false;
            this.builderSchemaDraft = null;
            return;
        }
        this.builderMode = false;
        this.builderSchemaDraft = this.cloneSchema(schema);
    }

    private isBuilderEligibleResponse(response: ActionRouterResponse, data: Record<string, unknown> | null): boolean {
        const fields = this.isRecord(response.fields) ? response.fields : {};
        const componentType = this.readFirstString(fields['component_type'], data?.['component_type']).toLowerCase();
        const actionName = this.readFirstString(fields['action_name']).toLowerCase();
        const actionModel = this.readFirstString(fields['action_model'], response.model).toLowerCase();
        if (componentType === 'form' || componentType === 'resource') return true;
        if (actionModel === 'component') return true;
        return actionName.includes('design') || actionName.includes('resource') || actionName.includes('form');
    }

    private extractBuilderSchema(event: unknown): Record<string, unknown> | null {
        if (this.isRecord(event) && this.isRecord(event['form'])) return event['form'];
        if (!this.isRecord(event)) return null;
        if (Array.isArray(event['components']) || typeof event['display'] === 'string') return event;
        return null;
    }

    private applyBuilderDraftToSubmission(): void {
        if (!this.formSubmission?.data || !this.builderSchemaDraft) return;
        const nextData: Record<string, unknown> = { ...this.formSubmission.data };
        const components = Array.isArray(this.builderSchemaDraft['components']) ? this.builderSchemaDraft['components'] : null;

        if (Object.prototype.hasOwnProperty.call(nextData, 'schema')) {
            nextData['schema'] = this.cloneSchema(this.builderSchemaDraft);
        }
        if (Object.prototype.hasOwnProperty.call(nextData, 'formio')) {
            nextData['formio'] = this.cloneSchema(this.builderSchemaDraft);
        }
        if (components && Object.prototype.hasOwnProperty.call(nextData, 'components')) {
            nextData['components'] = [...components];
        }
        if (
            !Object.prototype.hasOwnProperty.call(nextData, 'schema') &&
            !Object.prototype.hasOwnProperty.call(nextData, 'formio') &&
            !Object.prototype.hasOwnProperty.call(nextData, 'components')
        ) {
            nextData['schema'] = this.cloneSchema(this.builderSchemaDraft);
        }

        this.formSubmission = { data: this.normalizeFormSubmissionData(nextData) };
    }

    private resolveSessionUserName(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        return this.readFirstString(
            session['name'],
            session['full_name'],
            session['display_name'],
            session['uid'],
            session['user_name'],
            user['name'],
            user['full_name'],
            user['display_name'],
            user['uid'],
            user['user_name'],
            profile['name'],
            profile['full_name'],
            profile['display_name'],
            profile['username']
        );
    }

    private resolveSessionAdminFlag(session: Record<string, unknown>): boolean {
        return this.toOptionalBooleanFlag(session['is_admin']) === true;
    }

    private resolveSessionLocale(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        const settings = this.extractSessionSettings(session);
        const locale = this.readFirstString(
            session['locale'],
            session['lang'],
            session['language'],
            session['user_locale'],
            user['locale'],
            user['lang'],
            user['language'],
            user['user_locale'],
            profile['locale'],
            profile['lang'],
            profile['language'],
            profile['user_locale'],
            settings['locale'],
            settings['lang'],
            settings['language']
        );
        return this.normalizeSessionLocale(locale);
    }

    private resolveSessionTimezone(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        const settings = this.extractSessionSettings(session);
        const timezone = this.readFirstString(
            session['tz'],
            session['timezone'],
            user['tz'],
            user['timezone'],
            profile['tz'],
            profile['timezone'],
            settings['tz'],
            settings['timezone']
        );
        return this.normalizeSessionTimezone(timezone);
    }

    private normalizeSessionLocale(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) return 'it';
        const normalized = raw.replace(/_/g, '-');
        try {
            const [canonical] = Intl.getCanonicalLocales(normalized);
            return canonical || 'it';
        } catch {
            return 'it';
        }
    }

    private normalizeSessionTimezone(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        try {
            new Intl.DateTimeFormat('it', { timeZone: raw }).format(new Date());
            return raw;
        } catch {
            return '';
        }
    }

    private toOptionalBooleanFlag(value: unknown): boolean | null {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return null;
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
            return null;
        }
        return null;
    }

    private scoreSessionRecord(record: Record<string, unknown>): number {
        const user = this.isRecord(record['user']) ? record['user'] : {};
        const settings = this.extractSessionSettings(record);
        let score = 0;
        if (Object.keys(user).length) score += 3;
        if (this.resolveSessionUserName(record)) score += 3;
        if (this.resolveSessionAdminFlag(record)) score += 2;
        if (this.isRecord(record['app'])) score += 1;
        if (Object.keys(settings).length) score += 1;
        return score;
    }

    private extractSessionRecord(payload: unknown): Record<string, unknown> | null {
        let target: unknown = payload;
        for (let i = 0; i < 4; i += 1) {
            if (this.isRecord(target) && this.isRecord(target['content'])) {
                target = target['content']['data'] ?? target['content'];
                continue;
            }
            if (this.isRecord(target) && Array.isArray(target['data'])) {
                target = target['data'];
                continue;
            }
            break;
        }
        if (Array.isArray(target)) {
            const records = target.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
            if (!records.length) return null;
            records.sort((left, right) => this.scoreSessionRecord(right) - this.scoreSessionRecord(left));
            return records[0];
        }
        return this.isRecord(target) ? target : null;
    }

    private extractSessionSettings(session: Record<string, unknown>): Record<string, unknown> {
        const app = this.isRecord(session['app']) ? session['app'] : {};
        const settings = this.isRecord(app['settings']) ? app['settings'] : {};
        const settingsDataValue = this.isRecord(settings['data_value']) ? settings['data_value'] : {};
        return { ...settings, ...settingsDataValue };
    }

    private applySessionSettings(settings: Record<string, unknown>): void {
        if (!settings || !Object.keys(settings).length) return;
        const moduleName = this.readFirstString(settings['module_name'], settings['module_label'], this.appModuleName);
        if (moduleName) this.appModuleName = moduleName;
        const version = this.readFirstString(settings['app_version'], settings['version'], this.appVersion);
        if (version) this.appVersion = version;
        const logo = this.readFirstString(settings['logo'], settings['logo_img_url'], settings['logo_img'], settings['logo_url']);
        if (logo) this.appLogoUrl = this.resolveBrandAssetUrl(logo);
    }

    private resolveBrandAssetUrl(raw: string): string {
        const value = String(raw ?? '').trim();
        if (!value) return '';
        if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
        const normalized = `/${value.replace(/^\/+/, '')}`;
        if (normalized.startsWith('/api/')) return normalized;
        if (this.backendUrl && /^https?:\/\//i.test(this.backendUrl)) {
            try {
                return new URL(normalized, this.backendUrl).toString();
            } catch {
                return normalized;
            }
        }
        return `/api${normalized}`;
    }

    private async saveCurrentRecord(): Promise<void> {
        if (this.showFormBuilder) {
            this.applyBuilderDraftToSubmission();
        }
        if (!this.selectedModel) {
            this.setStatus('Seleziona un model prima di salvare', true);
            return;
        }
        const payload = this.formSubmission?.data;
        if (!payload || !this.isRecord(payload)) {
            this.setStatus('Nessun dato form disponibile da salvare', true);
            return;
        }

        const recName = this.getActiveRecName() || String(payload['rec_name'] ?? '').trim();
        if (!recName) {
            this.setStatus('rec_name mancante: impossibile salvare', true);
            return;
        }

        this.setStatus(`Salvataggio record "${recName}"...`, false);
        try {
            const response = await this.api.updateRecord(this.selectedModel, recName, payload);
            const submission = this.extractSubmission(response);
            if (submission) this.formSubmission = submission;
            this.selectedRecordName = recName;
            this.rebuildMenus();
            this.setStatus(`Record salvato: ${recName}`, false);
        } catch (error) {
            this.setStatus(this.errorMessage(error), true);
        }
    }

    private async copyCurrentRecordName(): Promise<void> {
        const recName = this.getActiveRecName();
        if (!recName) {
            this.setStatus('Nessun record selezionato da copiare', true);
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
            this.setStatus(`Clipboard non disponibile. Record: ${recName}`, false);
            return;
        }
        try {
            await navigator.clipboard.writeText(recName);
            this.setStatus(`Record copiato: ${recName}`, false);
        } catch {
            this.setStatus(`Errore clipboard. Record: ${recName}`, true);
        }
    }

    private removeCurrentRecordFromView(): void {
        const recName = this.getActiveRecName();
        if (!recName) {
            this.setStatus('Nessun record selezionato da rimuovere', true);
            return;
        }

        const before = this.allRows.length;
        this.allRows = this.allRows.filter(entry => String(entry.__rec_name ?? '') !== recName);
        this.selectedRows = this.selectedRows.filter(entry => String(entry.__rec_name ?? '') !== recName);
        this.selectedRecordName = '';
        this.refreshTableRows();
        const removed = before - this.allRows.length;
        if (removed > 0) this.tableTotalRecords = Math.max(0, this.tableTotalRecords - removed);
        this.rebuildMenus();
        this.setStatus(
            removed > 0 ? `Record rimosso dalla vista: ${recName}` : `Record non presente nella vista corrente: ${recName}`,
            removed <= 0
        );
    }

    private getActiveRecName(): string {
        const fromSelection = String(this.selectedRecordName ?? '').trim();
        if (fromSelection) return fromSelection;
        const fromForm = this.formSubmission?.data?.['rec_name'];
        return String(fromForm ?? '').trim();
    }

    private parseNonNegativeInt(value: unknown, fallback = 0): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return fallback;
        return Math.floor(parsed);
    }

    private beginClickTransition(): void {
        this.transitionLoadingCount += 1;
        this.isTransitionLoading = true;
    }

    private endClickTransition(): void {
        this.transitionLoadingCount = Math.max(0, this.transitionLoadingCount - 1);
        this.isTransitionLoading = this.transitionLoadingCount > 0;
    }

    private async withClickTransition<T>(task: () => Promise<T>): Promise<T> {
        this.beginClickTransition();
        try {
            return await task();
        } finally {
            this.endClickTransition();
        }
    }

    private parseJsonMaybe(value: unknown): unknown {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        if (!(raw.startsWith('{') || raw.startsWith('['))) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        if (this.isRecord(value)) return value;
        const parsed = this.parseJsonMaybe(value);
        return this.isRecord(parsed) ? parsed : null;
    }

    private setStatus(m: string, e: boolean): void { this.statusText = m; this.statusError = e; }
    private errorMessage(e: any): string { return e instanceof Error ? e.message : String(e); }
    private computeCurrentPageIndex(): number { return Math.floor((this.skip || 0) / this.getPageSize()); }
    private getPageSize(): number { return Number(this.limit) || 20; }
    private isRecord(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
}
