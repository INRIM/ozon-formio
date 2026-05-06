import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { FormioForm } from '@formio/angular';
import { OzonApiService } from '../core/ozon-api.service';
import { AppFormioRendererService } from './app-formio-renderer.service';
import { AppManagerService } from './app-manager.service';
import { buildOzonFormBuilderOptions, FormioBuilderExtension } from '../formio/formio-builder-config';
import { OzonFormBuilder } from '../formio/ozon-form-builder';
import { OzonFormBuilderHostComponent } from '../formio/ozon-form-builder-host.component';

export const BUILDER_STORAGE_KEY = 'ozon-app-web.builder';

@Injectable()
export class AppFormioBuilderService {
    builderMode = false;
    builderSchemaDraft: Record<string, unknown> | null = null;
    builderEligibleCurrentForm = false;
    private builderModePreferred = false;
    formEditorExplicitlyOpened = false;
    formEditorActiveTab: 'builder' | 'print' | 'config' = 'builder';
    formEditorDesignContext = false;
    formPreviewSubmission: { data: Record<string, unknown> } | null = null;

    readonly formBuilderComponent = OzonFormBuilder;
    formBuilderConfig: Record<string, unknown> = buildOzonFormBuilderOptions();

    private readonly formBuilderRebuildSubject = new Subject<Record<string, unknown>>();
    readonly formBuilderRebuild$ = this.formBuilderRebuildSubject.asObservable();

    private parentModelBuilderComponentsCache = new Map<string, Record<string, unknown>>();
    private builderPaletteRevision = 0;
    private formBuilderExtensions: readonly FormioBuilderExtension[] = [];

    constructor(
        private readonly api: OzonApiService,
        private readonly renderer: AppFormioRendererService,
        private readonly appManager: AppManagerService
    ) {}

    get builderEnabled(): boolean {
        return this.appManager.builderEnabled;
    }

    setFormBuilderExtensions(ext: readonly FormioBuilderExtension[] | null): void {
        this.formBuilderExtensions = ext ?? [];
    }

    get builderSchemaForm(): FormioForm | undefined {
        return this.builderSchemaDraft ? (this.builderSchemaDraft as FormioForm) : undefined;
    }

    get builderSwitchLabel(): string { return this.builderEnabled ? 'ON' : 'OFF'; }

    get showFormBuilder(): boolean {
        return this.builderEnabled && this.builderMode && Boolean(this.builderSchemaDraft);
    }

    get canEditCurrentForm(): boolean {
        return (
            this.builderEnabled
            && this.builderEligibleCurrentForm
            && Boolean(this.builderSchemaDraft || this.renderer.formSchema)
            && !this.showFormBuilder
        );
    }

    get isFormEditorPage(): boolean {
        return this.builderEligibleCurrentForm && this.formEditorExplicitlyOpened;
    }

    get canOpenFormEditor(): boolean {
        return this.builderEnabled && this.appManager.isAdminUser && Boolean(this.renderer.formSchema) && !this.isFormEditorPage;
    }

    get canPreviewFormEditor(): boolean {
        return this.isFormEditorPage && Boolean(this.renderer.formSchema || this.builderSchemaDraft);
    }

    get formEditorData(): Record<string, unknown> {
        return (this.renderer.formSubmission?.data && this.isRecord(this.renderer.formSubmission.data))
            ? this.renderer.formSubmission.data : {};
    }

    get formEditorProperties(): Record<string, unknown> {
        const p = this.formEditorData['properties'];
        return this.isRecord(p) ? p : {};
    }

    isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }

    cloneSchema(s: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
    }

    readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) { if (typeof entry === 'string' && entry.trim()) return entry.trim(); }
        return '';
    }

    private shouldRestoreBuilderMode(): boolean {
        return this.builderEnabled && this.appManager.isAdminUser && this.builderModePreferred;
    }

    onBuilderSwitchChanged(enabled: boolean): void {
        this.setBuilderEnabled(enabled, true);
    }

    setBuilderEnabled(enabled: boolean, persist: boolean): void {
        const canEnable = this.appManager.isAdminUser;
        const nextEnabled = canEnable ? Boolean(enabled) : false;
        this.appManager.setBuilderEnabled(nextEnabled, persist);
        if (!nextEnabled) {
            this.builderMode = false;
            this.builderSchemaDraft = null;
            this.builderModePreferred = false;
        }
    }

    enableFormBuilderMode(setStatusFn: (m: string, e: boolean) => void): void {
        if (!this.canEditCurrentForm) return;
        this.builderModePreferred = true;
        if (!this.builderSchemaDraft) {
            if (!this.renderer.formSchema) { setStatusFn('Schema non disponibile per Form Builder', true); return; }
            this.builderSchemaDraft = this.cloneSchema(this.renderer.formSchema);
        }
        this.builderMode = true;
        this.applyBuilderDraftToSubmission();
        setStatusFn('Form Builder attivato', false);
    }

    disableFormBuilderMode(setStatusFn: (m: string, e: boolean) => void): void {
        if (!this.builderMode) return;
        this.builderModePreferred = false;
        this.builderMode = false;
        setStatusFn('Form Viewer attivato', false);
    }

    setFormEditorActiveTab(tab: 'builder' | 'print' | 'config'): void {
        this.formEditorActiveTab = tab;
    }

    updateFormEditorField(key: string, value: unknown): void {
        if (!this.renderer.formSubmission) this.renderer.formSubmission = { data: {} };
        this.renderer.formSubmission.data = { ...this.renderer.formSubmission.data, [key]: value };
        if (key === 'data_model') {
            void this.refreshFormBuilderConfigForCurrentForm();
        }
    }

    updateFormEditorProperty(key: string, value: unknown): void {
        const currentProps = this.formEditorProperties;
        this.updateFormEditorField('properties', { ...currentProps, [key]: value });
    }

    openFormEditorInline(): void {
        if (!this.builderEligibleCurrentForm) return;
        this.formPreviewSubmission = null;
        this.formEditorExplicitlyOpened = true;
        this.formEditorActiveTab = 'builder';
    }

    previewFormEditor(setStatusFn: (m: string, e: boolean) => void): void {
        if (!this.canPreviewFormEditor) return;
        this.formPreviewSubmission = this.formEditorDesignContext ? { data: {} } : null;
        this.formEditorExplicitlyOpened = false;
        this.formEditorActiveTab = 'builder';
        setStatusFn('Preview form attivata', false);
    }

    onFormBuilderChanged(event: unknown, setStatusFn: (m: string, e: boolean) => void): void {
        const schema = this.extractBuilderSchema(event);
        if (!schema) {
            console.debug('[builder] onFormBuilderChanged: extractBuilderSchema returned null, event:', event);
            return;
        }
        const components = Array.isArray(schema['components']) ? schema['components'] : [];
        console.debug('[builder] onFormBuilderChanged: schema components count =', components.length, 'type =', (event as Record<string, unknown>)?.['type']);
        this.updateBuilderDraftSchema(schema);
        this.renderer.formSchema = this.cloneSchema(schema);
        this.applyBuilderDraftToSubmission();
        setStatusFn('Schema aggiornata in builder mode', false);
    }

    updateBuilderDraftSchema(schema: Record<string, unknown>): void {
        const nextDraft = this.cloneSchema(schema);
        if (!this.builderSchemaDraft) { this.builderSchemaDraft = nextDraft; return; }
        const staleKeys = Object.keys(this.builderSchemaDraft).filter(key => !Object.prototype.hasOwnProperty.call(nextDraft, key));
        Object.assign(this.builderSchemaDraft, nextDraft);
        staleKeys.forEach(key => { delete this.builderSchemaDraft?.[key]; });
    }

    syncBuilderSchemaFromLiveInstance(activeBuilderHost?: OzonFormBuilderHostComponent): void {
        if (!this.builderSchemaDraft) return;
        const liveSchema = activeBuilderHost?.getLiveSchema();
        if (!liveSchema) { console.debug('[builder] syncBuilderSchemaFromLiveInstance: no live instance available'); return; }
        const liveComponents = Array.isArray(liveSchema['components']) ? liveSchema['components'] as unknown[] : [];
        const draftComponents = Array.isArray(this.builderSchemaDraft['components']) ? this.builderSchemaDraft['components'] as unknown[] : [];
        console.debug('[builder] syncBuilderSchemaFromLiveInstance: live components =', liveComponents.length, ', draft components =', draftComponents.length);
        this.updateBuilderDraftSchema(liveSchema);
    }

    applyBuilderDraftToSubmission(): void {
        if (!this.renderer.formSubmission?.data || !this.builderSchemaDraft) return;
        const nextData: Record<string, unknown> = { ...this.renderer.formSubmission.data };
        const components = Array.isArray(this.builderSchemaDraft['components']) ? this.builderSchemaDraft['components'] : null;
        console.debug('[builder] applyBuilderDraftToSubmission: draft components =', (components as unknown[] | null)?.length ?? 'null', 'nextData keys =', Object.keys(nextData));
        if (Object.prototype.hasOwnProperty.call(nextData, 'schema')) nextData['schema'] = this.cloneSchema(this.builderSchemaDraft);
        if (Object.prototype.hasOwnProperty.call(nextData, 'formio')) nextData['formio'] = this.cloneSchema(this.builderSchemaDraft);
        if (components) nextData['components'] = [...components as unknown[]];
        if (!components && !Object.prototype.hasOwnProperty.call(nextData, 'schema') && !Object.prototype.hasOwnProperty.call(nextData, 'formio')) {
            nextData['schema'] = this.cloneSchema(this.builderSchemaDraft);
        }
        console.debug('[builder] applyBuilderDraftToSubmission: result components =', Array.isArray(nextData['components']) ? (nextData['components'] as unknown[]).length : 'none');
        this.renderer.formSubmission = { data: this.renderer.normalizeFormSubmissionData(nextData) };
    }

    syncBuilderMode(response: Record<string, unknown>, data: Record<string, unknown> | null, schema: Record<string, unknown> | null): void {
        const pageIsForm = this.appManager.viewMode === 'form';
        const eligible = pageIsForm && Boolean(schema) && this.isBuilderEligibleResponse(response, data);
        const designContext = eligible && this.isDesignContextResponse(response, data);
        this.builderEligibleCurrentForm = eligible;
        this.formEditorDesignContext = designContext;
        this.formPreviewSubmission = null;
        this.formEditorExplicitlyOpened = designContext;
        if (!pageIsForm || !eligible || !schema) { this.builderMode = false; this.builderSchemaDraft = null; this.builderEligibleCurrentForm = false; this.formEditorExplicitlyOpened = false; this.formEditorDesignContext = false; return; }
        this.builderSchemaDraft = this.resolveBuilderComponentSchema(data, schema, designContext);
        this.builderMode = this.shouldRestoreBuilderMode();
        if (this.builderMode) this.applyBuilderDraftToSubmission();
        this.formEditorActiveTab = 'builder';
    }

    syncDirectRecordBuilderMode(model: string, data: Record<string, unknown> | null, schema: Record<string, unknown> | null): void {
        const pageIsForm = this.appManager.viewMode === 'form';
        const eligible = pageIsForm && Boolean(schema) && String(model || '').trim().toLowerCase() === 'component';
        this.builderEligibleCurrentForm = eligible;
        this.formEditorDesignContext = false;
        this.formPreviewSubmission = null;
        this.formEditorExplicitlyOpened = false;
        if (!pageIsForm || !eligible || !schema) { this.builderMode = false; this.builderSchemaDraft = null; this.builderEligibleCurrentForm = false; return; }
        this.builderSchemaDraft = this.resolveBuilderComponentSchema(data, schema);
        this.builderMode = this.shouldRestoreBuilderMode();
        if (this.builderMode) this.applyBuilderDraftToSubmission();
        this.formEditorActiveTab = 'builder';
    }

    resetBuilderState(clearModeMemory = false): void {
        this.builderMode = false;
        this.builderSchemaDraft = null;
        this.builderEligibleCurrentForm = false;
        this.formEditorExplicitlyOpened = false;
        this.formEditorDesignContext = false;
        this.formPreviewSubmission = null;
        if (clearModeMemory) this.builderModePreferred = false;
        this.builderPaletteRevision += 1;
        this.applyFormBuilderConfig(null);
    }

    async refreshFormBuilderConfigForCurrentForm(): Promise<void> {
        const revision = ++this.builderPaletteRevision;
        const parentModel = this.resolveBuilderParentModel();
        if (!parentModel) { this.applyFormBuilderConfig(null, true); return; }
        this.applyFormBuilderConfig(null, true);
        const parentModelComponents = await this.loadParentModelBuilderComponents(parentModel);
        if (revision !== this.builderPaletteRevision) return;
        this.applyFormBuilderConfig(parentModelComponents, true);
    }

    applyFormBuilderConfig(parentModelComponents: Record<string, unknown> | null, rebuild = false): void {
        this.formBuilderConfig = buildOzonFormBuilderOptions({ parentModelComponents, extensions: this.formBuilderExtensions });
        if (rebuild) this.formBuilderRebuildSubject.next(this.formBuilderConfig);
    }

    complete(): void { this.formBuilderRebuildSubject.complete(); }

    private resolveBuilderParentModel(): string {
        const formData = this.renderer.formSubmission?.data && this.isRecord(this.renderer.formSubmission.data) ? this.renderer.formSubmission.data : null;
        let model = this.readFirstString(formData?.['data_model']).trim();
        if (!model || model === 'no_model') return '';
        if (model.startsWith('?')) model = model.slice(1).trim();
        return model;
    }

    private async loadParentModelBuilderComponents(model: string): Promise<Record<string, unknown> | null> {
        const normalizedModel = String(model ?? '').trim();
        if (!normalizedModel) return null;
        const cached = this.parentModelBuilderComponentsCache.get(normalizedModel);
        if (cached) return this.cloneSchema(cached);
        try {
            const payload = await this.api.getRecordSchema(normalizedModel);
            const schema = this.renderer.extractFormSchema(payload);
            if (!schema) return null;
            const components = this.buildParentModelBuilderComponents(schema);
            if (!Object.keys(components).length) return null;
            this.parentModelBuilderComponentsCache.set(normalizedModel, this.cloneSchema(components));
            return this.cloneSchema(components);
        } catch { return null; }
    }

    private buildParentModelBuilderComponents(schema: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        let weight = 0;
        const humanize = (s: string) => String(s).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
        const visit = (nodes: unknown[]): void => {
            nodes.forEach(node => {
                if (!this.isRecord(node)) return;
                const key = this.readFirstString(node['key']);
                const type = this.readFirstString(node['type']);
                const nested = Array.isArray(node['components']) ? node['components'] : [];
                if (key && type && type !== 'button' && node['input'] !== false) {
                    result[key] = {
                        title: this.readFirstString(node['label'], humanize(key), key) || key,
                        icon: this.builderIconForComponentType(type),
                        group: 'modelfield',
                        weight: weight++,
                        schema: this.cloneSchema(node)
                    };
                }
                if (nested.length) visit(nested as unknown[]);
            });
        };
        const components = Array.isArray(schema['components']) ? schema['components'] : [];
        visit(components as unknown[]);
        return result;
    }

    private builderIconForComponentType(type: string): string {
        switch (String(type ?? '').trim().toLowerCase()) {
            case 'textfield': return 'terminal';
            case 'textarea': return 'align-left';
            case 'number': return 'hashtag';
            case 'datetime': return 'calendar';
            case 'select': return 'list';
            case 'checkbox': return 'check-square';
            case 'radio': return 'dot-circle-o';
            case 'email': return 'at';
            case 'phoneNumber': case 'phonenumber': return 'phone';
            case 'content': case 'htmlelement': return 'paragraph';
            default: return 'cube';
        }
    }

    private resolveBuilderComponentSchema(data: Record<string, unknown> | null, fallback: Record<string, unknown>, preferBlankSchema = false): Record<string, unknown> {
        const candidates = [data?.['schema'], data?.['formio'], this.renderer.formSubmission?.data?.['schema'], this.renderer.formSubmission?.data?.['formio']];
        for (const c of candidates) {
            if (this.isRecord(c) && (Array.isArray((c as Record<string, unknown>)['components']) || typeof (c as Record<string, unknown>)['display'] === 'string')) {
                console.log('[builder] component schema found:', Object.keys(c as object));
                return this.cloneSchema(c as Record<string, unknown>);
            }
        }
        const components = data?.['components'] ?? this.renderer.formSubmission?.data?.['components'];
        if (Array.isArray(components)) {
            console.log('[builder] components array found, length:', (components as unknown[]).length);
            return { display: 'form', components: [...(components as unknown[])] };
        }
        if (preferBlankSchema) {
            const display = this.readFirstString(data?.['display'], fallback['display']) || 'form';
            console.log('[builder] blank schema for design context, data keys:', Object.keys(data ?? {}));
            return { display, components: [] };
        }
        console.log('[builder] fallback to rendering schema, data keys:', Object.keys(data ?? {}));
        return this.cloneSchema(fallback);
    }

    private isBuilderEligibleResponse(response: Record<string, unknown>, data: Record<string, unknown> | null): boolean {
        const fields = this.isRecord(response['fields']) ? response['fields'] : {};
        const actionComponentType = this.readFirstString(fields['component_type']).toLowerCase();
        const actionName = this.readFirstString(fields['action_name']).toLowerCase();
        const responseModel = this.readFirstString(response['model'], data?.['model'], this.renderer.selectedModel).toLowerCase();
        if (actionComponentType === 'form' || actionComponentType === 'resource') return true;
        if (responseModel === 'component') return true;
        return actionName === 'form_form' || actionName.startsWith('form_form_') || actionName === 'form' || actionName.startsWith('form_') || actionName.includes('design') || actionName.includes('resource');
    }

    private isDesignContextResponse(response: Record<string, unknown>, data: Record<string, unknown> | null): boolean {
        const fields = this.isRecord(response['fields']) ? response['fields'] : {};
        const actionComponentType = this.readFirstString(fields['component_type']).toLowerCase();
        const actionName = this.readFirstString(fields['action_name']).toLowerCase();
        if (actionComponentType === 'form' || actionComponentType === 'resource') return true;
        return actionName === 'form_form' || actionName.includes('design');
    }

    private extractBuilderSchema(event: unknown): Record<string, unknown> | null {
        if (this.isRecord(event) && this.isRecord(event['form'])) return event['form'];
        if (!this.isRecord(event)) return null;
        if (Array.isArray(event['components']) || typeof event['display'] === 'string') return event;
        return null;
    }
}
