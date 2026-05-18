import { Component, Inject, OnDestroy, OnInit, Optional, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormioComponent, FormioModule } from '@formio/angular';
import { EditorModule } from 'primeng/editor';
import { InputSwitchModule } from 'primeng/inputswitch';
import { FORMIO_BUILDER_EXTENSIONS, FormioBuilderExtension } from './formio/formio-builder-config';
import { OzonFormBuilderHostComponent } from './formio/ozon-form-builder-host.component';
import { RecordListComponent } from './list/record-list.component';
import { AppThemeService } from './managers/app-theme.service';
import { AppManagerService } from './managers/app-manager.service';
import { AppTableManagerService } from './managers/app-table-manager.service';
import { AppFormioRendererService } from './managers/app-formio-renderer.service';
import { AppFormioBuilderService } from './managers/app-formio-builder.service';
import { AppActionManagerService } from './managers/app-action-manager.service';
import { ContextAction, ListPageChange, ListSortChange, TableColumn, TableRow, MenuButton, MenuCard, MenuDrillDownGroup } from './models/app.types';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, FormsModule, FormioModule, InputSwitchModule, EditorModule, OzonFormBuilderHostComponent, RecordListComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
    providers: [AppThemeService, AppManagerService, AppTableManagerService, AppFormioRendererService, AppFormioBuilderService, AppActionManagerService]
})
export class AppComponent implements OnInit, OnDestroy {
    @ViewChild(OzonFormBuilderHostComponent) activeBuilderHost?: OzonFormBuilderHostComponent;
    @ViewChild('formioViewer') formioViewer?: FormioComponent;
    readonly formPlaceholderRows = [0, 1, 2, 3, 4];

    constructor(
        readonly theme: AppThemeService,
        readonly appManager: AppManagerService,
        readonly tableManager: AppTableManagerService,
        readonly renderer: AppFormioRendererService,
        readonly builder: AppFormioBuilderService,
        readonly actionManager: AppActionManagerService,
        @Optional() @Inject(FORMIO_BUILDER_EXTENSIONS) private readonly formBuilderExtensions: readonly FormioBuilderExtension[] | null
    ) {}

    ngOnInit(): void {
        this.theme.initialize();
        this.appManager.initializeBuilderPreference();
        this.builder.setFormBuilderExtensions(this.formBuilderExtensions);
        this.actionManager.setFormioViewerGetter(() => this.formioViewer);
        this.actionManager.initSubscriptions();
        void this.actionManager.initializeApplication();
    }

    ngOnDestroy(): void {
        this.actionManager.destroySubscriptions();
    }

    // --- Theme ---

    get isDarkTheme(): boolean { return this.theme.isDarkTheme; }
    get currentThemeLabel(): string { return this.theme.currentThemeLabel; }
    onThemeSwitchChanged(isDark: boolean): void { this.theme.onThemeSwitchChanged(isDark); }

    // --- App / Session state ---

    get statusText(): string { return this.appManager.statusText; }
    get statusError(): boolean { return this.appManager.statusError; }
    get serverErrorRetryVisible(): boolean { return this.appManager.serverErrorRetryVisible; }
    get models(): string[] { return this.appManager.models; }
    get selectedModel(): string { return this.appManager.selectedModel; }
    set selectedModel(v: string) { this.appManager.selectedModel = v; }
    get userMenuOpen(): boolean { return this.appManager.userMenuOpen; }
    get isAdminUser(): boolean { return this.appManager.isAdminUser; }
    get userAvatarUrl(): string { return this.appManager.userAvatarUrl; }
    get appLogoUrl(): string { return this.appManager.appLogoUrl; }
    get activeDashboardGroup(): string { return this.appManager.activeDashboardGroup; }
    get openedNavMenuGroup(): string { return this.appManager.openedNavMenuGroup; }
    set openedNavMenuGroup(v: string) { this.appManager.openedNavMenuGroup = v; }

    get brandTitle(): string { return this.appManager.appModuleName || 'Mci Service'; }
    get brandSubtitle(): string {
        const layout = this.appManager.layoutName || 'standard';
        const version = this.appManager.appVersion ? ` | ${this.appManager.appVersion}` : '';
        return `Layout ${layout}${version}`;
    }
    get userDisplayName(): string { return this.appManager.currentUserName || 'Utente'; }
    get userInitials(): string {
        const text = this.userDisplayName.split(/\s+/).map(w => w.trim()).filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
        return text || 'U';
    }
    get logoFallbackText(): string {
        const text = this.brandTitle.replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).map(w => w.trim()).filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
        return text || 'LOGO';
    }
    get showBuilderToggle(): boolean { return this.appManager.isAdminUser; }
    get viewMode(): 'dashboard' | 'list' | 'form' { return this.appManager.viewMode; }
    get isDashboardPage(): boolean { return this.appManager.viewMode === 'dashboard'; }
    get isListPage(): boolean { return this.appManager.viewMode === 'list'; }
    get isFormPage(): boolean { return this.appManager.viewMode === 'form'; }

    toggleUserMenu(): void { this.appManager.toggleUserMenu(); }
    openTopMenu(card: MenuCard): void { this.appManager.openTopMenu(card); }

    // --- Action Manager ---

    get currentActionName(): string { return this.actionManager.currentActionName; }
    get isTransitionLoading(): boolean { return this.actionManager.isTransitionLoading; }
    get topMenuCards(): MenuCard[] { return this.actionManager.topMenuCards; }
    get showTopMenu(): boolean { return this.actionManager.showTopMenu; }
    get showHomeButton(): boolean { return this.actionManager.showHomeButton; }
    get showLoginButton(): boolean { return this.actionManager.showLoginButton; }
    get showLogoutButton(): boolean { return this.actionManager.showLogoutButton; }
    get nonAdminDashboardCards(): MenuCard[] { return this.actionManager.nonAdminDashboardCards; }
    get selectedTopMenuCard(): MenuCard | null { return this.actionManager.selectedTopMenuCard; }
    get dashboardTitle(): string { return this.actionManager.dashboardTitle; }
    get showFormViewerActionButtons(): boolean { return this.actionManager.showFormViewerActionButtons; }
    get currentFormActionButtons(): MenuButton[] { return this.actionManager.currentFormActionButtons; }
    get formEditorActionButtons(): MenuButton[] { return this.actionManager.formEditorActionButtons; }
    get formEditorSaveLabel(): string { return this.actionManager.formEditorSaveLabel; }
    get selectedInfo(): string {
        return this.tableManager.selectedRecordName
            ? `Record selezionato: ${this.tableManager.selectedRecordName}`
            : 'Nessun record selezionato';
    }
    get canOpenRecord(): boolean { return this.actionManager.canOpenRecord; }
    get canOpenNewRecord(): boolean { return this.actionManager.canOpenNewRecord; }
    get listContextActions() { return this.actionManager.listContextActions; }
    get isLoadingRecords(): boolean { return this.tableManager.isLoadingRecords; }

    login(): void { this.actionManager.login(); }
    logout(): void { this.actionManager.logout(); }
    async resetNavigation(): Promise<void> { return this.actionManager.resetNavigation(); }
    async runTopMenuAction(button: MenuButton): Promise<void> { return this.actionManager.runTopMenuAction(button); }
    canRunMenuAction(button: MenuButton): boolean { return this.actionManager.canRunMenuAction(button); }
    menuActionHref(button: MenuButton): string { return this.actionManager.menuActionHref(button); }
    async onMenuActionAnchorClick(button: MenuButton, event: MouseEvent): Promise<void> { return this.actionManager.onMenuActionAnchorClick(button, event); }
    resolveButtonIconClass(button: MenuButton): string { return this.actionManager.resolveButtonIconClass(button); }
    resolveBootstrapItaliaIconSrc(button: MenuButton): string { return this.actionManager.resolveBootstrapItaliaIconSrc(button); }
    async openRecordFromListSelection(): Promise<void> { return this.actionManager.openRecordFromListSelection(); }
    async openNewRecord(): Promise<void> { return this.actionManager.openNewRecord(); }
    async onContextActionClick(action: ContextAction): Promise<void> {
        const btn = this.actionManager.contextActionToMenuButtonPublic(action);
        return this.actionManager.runTopMenuAction(btn);
    }
    async retryServerError(): Promise<void> { return this.actionManager.retryServerError(); }
    async saveCurrentRecord(): Promise<void> { return this.actionManager.saveCurrentRecord(this.activeBuilderHost, this.formioViewer); }
    menuDrilldownGroups(card: MenuCard): MenuDrillDownGroup[] { return this.actionManager.menuDrilldownGroups(card); }

    // --- Table Manager ---

    get tableColumns(): TableColumn[] { return this.tableManager.tableColumns; }
    get tableRows(): TableRow[] { return this.tableManager.tableRows; }
    get selectedRows(): TableRow[] { return this.tableManager.selectedRows; }
    set selectedRows(v: TableRow[]) { this.tableManager.selectedRows = v; }
    get selectedRecordName(): string { return this.tableManager.selectedRecordName; }
    get filterText(): string { return this.tableManager.filterText; }
    set filterText(v: string) { this.tableManager.filterText = v; }
    get skip(): number { return this.tableManager.skip; }
    get limit(): number { return this.tableManager.limit; }
    get primeSortField(): string { return this.tableManager.primeSortField; }
    get primeSortOrder(): number { return this.tableManager.primeSortOrder; }
    get sortDirection() { return this.tableManager.sortDirection; }
    get streamCount(): number { return this.tableManager.streamCount; }
    get tableTotalRecords(): number { return this.tableManager.tableTotalRecords; }
    get pageSize(): number { return this.tableManager.pageSize; }
    get pageSizeOptions(): number[] { return this.tableManager.pageSizeOptions; }
    get tableColumnCount(): number { return this.tableManager.tableColumnCount; }
    get tableExtraColumnCount(): number { return this.tableManager.tableExtraColumnCount; }
    get showTableRowCopyAction(): boolean { return this.tableManager.showTableRowCopyAction; }
    get showTableRowRemoveAction(): boolean { return this.tableManager.showTableRowRemoveAction; }
    readonly recordDisplayCell = (row: TableRow, field: string): string => this.tableManager.displayCell(row, field);

    displayCell(row: TableRow, field: string): string { return this.tableManager.displayCell(row, field); }
    trackRowBy(_index: number, row: TableRow): number { return row.__rowid; }
    trackColumnBy(_index: number, col: TableColumn): string { return col.field; }

    onTableLazyLoad(event: unknown): void {
        this.tableManager.onTableLazyLoad(event, preserve => this.actionManager.loadRecords(preserve));
    }
    onListPageChange(change: ListPageChange): void {
        this.tableManager.onListPageChange(change, preserve => this.actionManager.loadRecords(preserve));
    }
    onListSortChange(change: ListSortChange): void {
        this.tableManager.onListSortChange(change, preserve => this.actionManager.loadRecords(preserve));
    }
    onTableRowClick(row: TableRow, event: Event): void {
        this.tableManager.onTableRowClick(row, event, () => this.actionManager.rebuildMenus());
    }
    async onTableRowDblClick(row: TableRow, event: Event): Promise<void> {
        return this.tableManager.onTableRowDblClick(row, event, () => this.actionManager.rebuildMenus(), () => this.actionManager.openRecordFromListSelection());
    }
    onTableSelectionChange(value: unknown): void {
        this.tableManager.onTableSelectionChange(value, () => this.actionManager.rebuildMenus());
    }
    onFilterChanged(): void {
        this.tableManager.onFilterChanged(() => { void this.actionManager.loadRecords(); });
    }
    onRowReorder(event: unknown): void {
        this.tableManager.onRowReorder(event, (m, e) => this.appManager.setStatus(m, e));
    }
    async onCopyRow(row: TableRow, event: Event): Promise<void> { return this.actionManager.onCopyRow(row, event); }
    async onRemoveRow(row: TableRow, event: Event): Promise<void> { return this.actionManager.onRemoveRow(row, event); }

    // --- Fast Search ---

    get fastSearchEnabled(): boolean { return this.tableManager.fastSearchEnabled; }
    get fastSearchLoading(): boolean { return this.tableManager.fastSearchLoading; }
    get fastSearchSchema(): Record<string, unknown> | null { return this.tableManager.fastSearchSchema; }
    get fastSearchSubmission(): { data: Record<string, unknown> } { return this.tableManager.fastSearchSubmission; }
    get tableRenderLoading(): boolean { return this.tableManager.tableRenderLoading; }
    get formioRenderOptions(): Record<string, unknown> { return this.appManager.formioRenderOptions; }
    get formViewerLoading(): boolean { return this.renderer.formViewerLoading; }
    get showFormViewerShell(): boolean {
        return this.isFormPage
            && !this.showFormBuilder
            && !this.isFormEditorPage
            && (this.formViewerLoading || Boolean(this.formSchema));
    }

    async onFastSearchFormChange(event: unknown): Promise<void> {
        const shouldAutoSearch = await this.tableManager.applyFastSearchFormChange(event);
        if (!shouldAutoSearch) return;
        await this.doFastSearch();
    }
    onFastSearchKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'TEXTAREA') return;
        const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 991px)').matches;
        event.preventDefault();
        event.stopPropagation();
        if (isMobile) return;
        void this.doFastSearch();
    }
    async doFastSearch(): Promise<void> { this.tableManager.activateFastSearch(); return this.actionManager.loadRecords(false); }
    async resetFastSearch(): Promise<void> { this.tableManager.resetFastSearch(); return this.actionManager.loadRecords(false); }

    // --- Formio Renderer ---

    get formSchema(): Record<string, unknown> | null { return this.renderer.formSchema; }
    get formViewerTitle(): string {
        return this.actionManager.dashboardTitle || 'Form Viewer';
    }
    get formSubmission(): { data: Record<string, unknown> } | null { return this.renderer.formSubmission; }
    get viewerFormSubmission(): { data: Record<string, unknown> } | null {
        return this.renderer.formPreviewSubmission ?? this.renderer.formSubmission;
    }
    async onFormViewerReady(): Promise<void> {
        return this.renderer.onFormViewerReady();
    }
    async onFormSubmissionChanged(event: unknown): Promise<void> {
        return this.renderer.onFormSubmissionChanged(event, (m, e) => this.appManager.setStatus(m, e));
    }

    // --- Formio Builder ---

    get builderEnabled(): boolean { return this.appManager.builderEnabled; }
    get builderSwitchLabel(): string { return this.builder.builderSwitchLabel; }
    get showFormBuilder(): boolean { return this.builder.showFormBuilder; }
    get canEditCurrentForm(): boolean { return this.builder.canEditCurrentForm; }
    get isFormEditorPage(): boolean { return this.builder.isFormEditorPage; }
    get canOpenFormEditor(): boolean { return this.builder.canOpenFormEditor; }
    get canPreviewFormEditor(): boolean { return this.builder.canPreviewFormEditor; }
    get formEditorData(): Record<string, unknown> { return this.builder.formEditorData; }
    get formEditorProperties(): Record<string, unknown> { return this.builder.formEditorProperties; }
    get formEditorDesignContext(): boolean { return this.builder.formEditorDesignContext; }
    get builderMode(): boolean { return this.builder.builderMode; }
    get builderEligibleCurrentForm(): boolean { return this.builder.builderEligibleCurrentForm; }
    get formEditorActiveTab(): 'builder' | 'print' | 'config' { return this.builder.formEditorActiveTab; }
    set formEditorActiveTab(v: 'builder' | 'print' | 'config') { this.builder.formEditorActiveTab = v; }
    get builderSchemaForm() { return this.builder.builderSchemaForm; }
    get formBuilderComponent() { return this.builder.formBuilderComponent; }
    get formBuilderConfig(): Record<string, unknown> { return this.builder.formBuilderConfig; }
    get formBuilderRebuild$() { return this.builder.formBuilderRebuild$; }

    onBuilderSwitchChanged(enabled: boolean): void { this.builder.onBuilderSwitchChanged(enabled); }
    enableFormBuilderMode(): void { this.builder.enableFormBuilderMode((m, e) => this.appManager.setStatus(m, e)); }
    openFormEditorInline(): void { this.builder.openFormEditorInline(); }
    onFormBuilderChanged(event: unknown): void {
        this.builder.onFormBuilderChanged(event, (m, e) => this.appManager.setStatus(m, e));
    }
    setFormEditorActiveTab(tab: 'builder' | 'print' | 'config'): void { this.builder.setFormEditorActiveTab(tab); }
    updateFormEditorField(field: string, value: unknown): void { this.builder.updateFormEditorField(field, value); }
    updateFormEditorProperty(property: string, value: unknown): void { this.builder.updateFormEditorProperty(property, value); }
    previewFormEditor(): void { this.builder.previewFormEditor((m, e) => this.appManager.setStatus(m, e)); }
    disableFormBuilderMode(): void { this.builder.disableFormBuilderMode((m, e) => this.appManager.setStatus(m, e)); }
}
