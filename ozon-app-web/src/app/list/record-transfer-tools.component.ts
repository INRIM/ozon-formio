import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OzonApiService } from '../core/ozon-api.service';
import {
    ExportFileType,
    ImportPreviewRow,
    ImportTemplateFormat,
    ListExportConfig,
    ListImportConfig,
    ListSearchSessionContext
} from '../models/app.types';
import { ListRequestPayload } from '../models/ozon.types';

interface GeneratedFile {
    blob: Blob;
    fileName: string;
}

interface ModelFieldDefinition {
    key: string;
    type: string;
    multiple: boolean;
}

interface XlsxSheet {
    [key: string]: unknown;
}

interface XlsxWorkbook {
    SheetNames: string[];
    Sheets: Record<string, XlsxSheet>;
}

interface XlsxRuntime {
    read(data: ArrayBuffer | Uint8Array, options?: Record<string, unknown>): XlsxWorkbook;
    write(workbook: XlsxWorkbook, options?: Record<string, unknown>): ArrayBuffer | Uint8Array;
    utils: {
        sheet_to_json(sheet: XlsxSheet, options?: Record<string, unknown>): Array<Record<string, unknown>>;
        json_to_sheet(rows: Array<Record<string, unknown>>, options?: Record<string, unknown>): XlsxSheet;
        aoa_to_sheet(rows: unknown[][], options?: Record<string, unknown>): XlsxSheet;
        book_new(): XlsxWorkbook;
        book_append_sheet(workbook: XlsxWorkbook, sheet: XlsxSheet, name: string): void;
    };
}

declare global {
    interface Window {
        XLSX?: XlsxRuntime;
    }
}

@Component({
    selector: 'app-record-transfer-tools',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './record-transfer-tools.component.html',
    styleUrl: './record-transfer-tools.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecordTransferToolsComponent {
    @Input() exportConfig: ListExportConfig | null = null;
    @Input() importConfig: ListImportConfig | null = null;
    @Input() searchContext: ListSearchSessionContext | null = null;

    private readonly importMetadataKeys = new Set([
        'id', 'owner_uid', 'owner_name', 'owner_sector', 'owner_sector_id',
        'owner_function', 'update_datetime', 'create_datetime', 'owner_mail',
        'update_uid', 'owner_function_type', 'demo', 'deleted', 'list_order',
        'owner_personal_type', 'owner_job_title', 'childs'
    ]);

    importPanelOpen = false;
    exportBusy = false;
    templateBusy = false;
    importBusy = false;
    dragActive = false;
    deleteBefore = false;
    selectedFileName = '';
    previewColumns: string[] = [];
    previewRows: ImportPreviewRow[] = [];
    panelMessage = '';
    panelError = false;
    importResultLines: string[] = [];

    private xlsxLoader: Promise<XlsxRuntime> | null = null;
    private readonly modelFieldCache = new Map<string, Promise<ModelFieldDefinition[]>>();
    private readonly sampledFieldCache = new Map<string, Promise<ModelFieldDefinition[]>>();
    private readonly modelsWithoutBackendSchema = new Set<string>();

    constructor(private readonly api: OzonApiService) {}

    get hasExport(): boolean {
        return Boolean(this.exportConfig?.visible && this.exportConfig.model);
    }

    get hasImport(): boolean {
        return Boolean(this.importConfig?.visible && this.importConfig.model);
    }

    get previewRowsVisible(): ImportPreviewRow[] {
        return this.previewRows.slice(0, 100);
    }

    get previewTruncated(): boolean {
        return this.previewRows.length > this.previewRowsVisible.length;
    }

    get canSubmitImport(): boolean {
        return this.hasImport && this.previewColumns.length > 0 && this.previewRows.length > 0 && !this.importBusy;
    }

    toggleImportPanel(): void {
        this.importPanelOpen = !this.importPanelOpen;
        this.clearPanelMessage();
    }

    async exportFiltered(fileType: ExportFileType): Promise<void> {
        await this.runExport(fileType, true);
    }

    async exportAll(fileType: ExportFileType): Promise<void> {
        await this.runExport(fileType, false);
    }

    async downloadTemplate(format: ImportTemplateFormat, withData: boolean): Promise<void> {
        if (!this.importConfig?.model || this.templateBusy) return;
        this.clearPanelMessage();
        this.templateBusy = true;
        try {
            const generated = await this.buildTemplateFile(this.importConfig.model, format, withData);
            this.saveGeneratedFile(generated);
            this.setPanelMessage('Template scaricato.', false);
        } catch (error) {
            this.setPanelMessage(this.errorMessage(error), true);
        } finally {
            this.templateBusy = false;
        }
    }

    async submitImport(): Promise<void> {
        if (!this.importConfig?.model || !this.canSubmitImport) return;
        this.clearPanelMessage();
        this.importBusy = true;
        try {
            const fieldDefinitions = await this.enrichFieldDefinitionsFromExistingRows(
                this.importConfig.model,
                await this.loadModelFieldDefinitions(this.importConfig.model),
                this.previewColumns
            );
            const fieldMap = new Map(fieldDefinitions.map((entry) => [entry.key, entry]));

            // Pre-pass: coerce all rows, collect warnings and missing rec_name (hard errors).
            const hardErrors: string[] = [];
            const allWarnings: string[] = [];
            const preparedRows: Array<{ prepared: Record<string, unknown>; recName: string }> = [];
            for (let index = 0; index < this.previewRows.length; index += 1) {
                const { prepared, warnings } = this.prepareImportRow(this.previewRows[index], fieldMap);
                warnings.forEach((w) => allWarnings.push(`Riga ${index + 1}: ${w}`));
                const recName = String(prepared['rec_name'] ?? '').trim();
                if (!recName) hardErrors.push(`Riga ${index + 1}: rec_name mancante.`);
                preparedRows.push({ prepared, recName });
            }
            if (hardErrors.length) {
                this.importResultLines = hardErrors;
                this.setPanelMessage('Validazione fallita. Correggere i dati prima di importare.', true);
                return;
            }

            const errors: string[] = [];
            if (this.deleteBefore) {
                const deleteErrors = await this.deleteExistingRecords(this.importConfig.model);
                errors.push(...deleteErrors);
            }

            let ok = 0;
            for (let index = 0; index < preparedRows.length; index += 1) {
                const { prepared, recName } = preparedRows[index];
                try {
                    await this.api.updateRecord(this.importConfig.model, recName, prepared);
                    ok += 1;
                } catch (error) {
                    errors.push(`Riga ${index + 1} (${recName}): ${this.errorMessage(error)}`);
                }
            }

            this.importResultLines = [...allWarnings, ...errors];
            this.setPanelMessage(`Import completato: ${ok} record importati.`, errors.length > 0);
        } catch (error) {
            this.importResultLines = [];
            this.setPanelMessage(this.errorMessage(error), true);
        } finally {
            this.importBusy = false;
        }
    }

    async onFileInputChange(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (!file) return;
        await this.loadPreview(file);
        if (input) input.value = '';
    }

    async onFileDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = false;
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        await this.loadPreview(file);
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = true;
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = false;
    }

    clearPreview(): void {
        this.selectedFileName = '';
        this.previewColumns = [];
        this.previewRows = [];
        this.deleteBefore = false;
        this.importResultLines = [];
        this.clearPanelMessage();
    }

    trackPreviewColumn(_index: number, column: string): string {
        return column;
    }

    private async runExport(fileType: ExportFileType, filtered: boolean): Promise<void> {
        if (!this.exportConfig?.model || this.exportBusy) return;
        this.clearPanelMessage();
        this.exportBusy = true;
        try {
            const rows = await this.fetchSourceRows(this.exportConfig.model, filtered);
            const generated = await this.buildExportFile(fileType, this.exportConfig.model, rows);
            this.saveGeneratedFile(generated);
            this.setPanelMessage(
                filtered
                    ? `Export ${fileType.toUpperCase()} pronto.`
                    : `Export completo ${fileType.toUpperCase()} pronto.`,
                false
            );
        } catch (error) {
            this.setPanelMessage(this.errorMessage(error), true);
        } finally {
            this.exportBusy = false;
        }
    }

    private async loadPreview(file: File): Promise<void> {
        this.clearPreview();
        this.selectedFileName = file.name;
        try {
            const rows = await this.parseFile(file);
            const columns = this.collectColumns(rows);
            if (!rows.length || !columns.length) {
                throw new Error('Il file non contiene righe importabili.');
            }
            this.previewColumns = columns;
            this.previewRows = rows.map((row) => this.normalizePreviewRow(row, columns));
            this.setPanelMessage(`File caricato: ${this.previewRows.length} righe.`, false);
        } catch (error) {
            this.clearPreview();
            this.setPanelMessage(this.errorMessage(error), true);
        }
    }

    private async parseFile(file: File): Promise<ImportPreviewRow[]> {
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.json')) {
            return this.parseJsonFile(await file.text());
        }
        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
            const xlsx = await this.ensureXlsxRuntime();
            const buffer = await file.arrayBuffer();
            const workbook = xlsx.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
                throw new Error('Workbook non valido o privo di fogli.');
            }
            return xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
                header: 0,
                defval: ''
            }).map((row) => this.flattenPreviewRow(row));
        }
        throw new Error('Formato non supportato. Usa .xlsx, .xls, .csv oppure .json.');
    }

    private parseJsonFile(text: string): ImportPreviewRow[] {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('JSON non valido.');
        }
        const rows = Array.isArray(parsed)
            ? parsed
            : (this.isRecord(parsed) && Array.isArray(parsed['data']) ? parsed['data'] : []);
        if (!Array.isArray(rows)) return [];
        return rows
            .filter((row): row is Record<string, unknown> => this.isRecord(row))
            .map((row) => this.flattenPreviewRow(row));
    }

    private async buildExportFile(fileType: ExportFileType, model: string, rows: Array<Record<string, unknown>>): Promise<GeneratedFile> {
        if (fileType === 'json') {
            return {
                blob: new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }),
                fileName: `${model}_${this.buildTimestamp()}.json`
            };
        }

        const flattenedRows = rows.map((row) => this.flattenPreviewRow(row));
        const columns = this.collectColumns(flattenedRows);
        const normalizedRows = flattenedRows.map((row) => this.normalizePreviewRow(row, columns));

        if (fileType === 'csv') {
            return {
                blob: new Blob([this.toCsv(columns, normalizedRows)], { type: 'text/csv;charset=utf-8' }),
                fileName: `${model}_${this.buildTimestamp()}.csv`
            };
        }

        const xlsx = await this.ensureXlsxRuntime();
        const sheet = normalizedRows.length
            ? xlsx.utils.json_to_sheet(normalizedRows, { header: columns })
            : xlsx.utils.aoa_to_sheet(columns.length ? [columns] : [[]]);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, sheet, 'Export');
        const bytes = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
        return {
            blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            fileName: `${model}_${this.buildTimestamp()}.xlsx`
        };
    }

    private async buildTemplateFile(model: string, format: ImportTemplateFormat, withData: boolean): Promise<GeneratedFile> {
        const fieldDefinitions = await this.loadModelFieldDefinitions(model);
        const fields = fieldDefinitions.map((field) => field.key);
        if (!fields.length) throw new Error(`Campi schema non trovati per "${model}".`);

        const rows = withData
            ? (await this.fetchSourceRows(model, true)).map((row) => this.flattenPreviewRow(row))
            : [];

        if (format === 'json') {
            return {
                blob: new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }),
                fileName: `${model}_${this.buildTimestamp()}.json`
            };
        }

        const normalizedRows = rows.map((row) => this.normalizePreviewRow(row, fields));
        const xlsx = await this.ensureXlsxRuntime();
        const sheet = normalizedRows.length
            ? xlsx.utils.json_to_sheet(normalizedRows, { header: fields })
            : xlsx.utils.aoa_to_sheet([fields]);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, sheet, 'Import Template');
        const bytes = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
        return {
            blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            fileName: `${model}_${this.buildTimestamp()}.xlsx`
        };
    }

    private async fetchSourceRows(model: string, filtered: boolean): Promise<Array<Record<string, unknown>>> {
        const context = this.searchContext;
        const queryCandidate = filtered ? context?.currentQuery : context?.baseQuery;
        const query = this.isRecord(queryCandidate) ? this.cloneRecord(queryCandidate) : {};
        const order = this.readFirstString(context?.order, 'rec_name asc');
        const totalCount = Math.max(0, Number(context?.totalCount ?? 0));

        if (context?.actionName) {
            const response = await this.api.getAction(context.actionName, {
                query,
                order,
                skip: 0,
                limit: Math.max(totalCount, 1)
            });
            return this.extractRows(response);
        }

        const sourceModel = this.readFirstString(model, context?.dataModel, context?.searchModel);
        if (!sourceModel) return [];

        const rows: Array<Record<string, unknown>> = [];
        const payload: ListRequestPayload = {
            query,
            order,
            skip: 0,
            limit: Math.max(totalCount, 1)
        };
        await this.api.streamList(
            sourceModel,
            payload,
            (item) => {
                if (this.isRecord(item)) rows.push(item);
            },
            undefined,
            { stream: false }
        );
        return rows;
    }

    private async loadModelFieldDefinitions(model: string): Promise<ModelFieldDefinition[]> {
        const normalizedModel = String(model ?? '').trim();
        if (!normalizedModel) return [];
        const cached = this.modelFieldCache.get(normalizedModel);
        if (cached) return cached;

        const loader = (async () => {
            const [recordSchemaPayload, modelSchemaPayload] = await Promise.allSettled([
                this.api.getRecordSchema(normalizedModel),
                this.api.getSchemaModel(normalizedModel)
            ]);

            const schema = recordSchemaPayload.status === 'fulfilled'
                ? this.extractFormSchema(recordSchemaPayload.value)
                : null;
            const definitions: ModelFieldDefinition[] = [];
            if (schema) {
                this.collectFieldDefinitions(
                    Array.isArray(schema['components']) ? schema['components'] as unknown[] : [],
                    definitions,
                    new Set<string>()
                );
            }

            // Merge Pydantic/backend field types — overrides Form.io textfield when backend knows better.
            if (modelSchemaPayload.status === 'fulfilled') {
                const backendProperties = this.extractBackendProperties(modelSchemaPayload.value);
                if (backendProperties) {
                    this.modelsWithoutBackendSchema.delete(normalizedModel);
                    this.mergeBackendFieldDefinitions(modelSchemaPayload.value, definitions);
                } else {
                    this.modelsWithoutBackendSchema.add(normalizedModel);
                }
            } else {
                this.modelsWithoutBackendSchema.add(normalizedModel);
            }

            this.ensureFieldDefinition(definitions, 'rec_name');
            this.ensureFieldDefinition(definitions, 'owner_uid');
            return definitions;
        })();

        this.modelFieldCache.set(normalizedModel, loader);
        return loader;
    }

    private async enrichFieldDefinitionsFromExistingRows(
        model: string,
        baseDefinitions: ModelFieldDefinition[],
        previewColumns: string[]
    ): Promise<ModelFieldDefinition[]> {
        const normalizedModel = String(model ?? '').trim();
        if (!normalizedModel || !previewColumns.length) return baseDefinitions;
        // Run sample-row inference regardless of whether backend schema was found:
        // backend schema may be incomplete (missing list fields, wrong type, $ref etc.).
        // needsExistingRowInference prevents unnecessary fetches when all fields are well-typed.
        if (!this.needsExistingRowInference(baseDefinitions, previewColumns)) return baseDefinitions;

        const cached = this.sampledFieldCache.get(normalizedModel);
        if (cached) return cached;

        const loader = (async () => {
            const sampledRows = await this.fetchSourceRows(normalizedModel, true);
            if (!sampledRows.length) return baseDefinitions;

            const merged = baseDefinitions.map((entry) => ({ ...entry }));
            this.mergeDefinitionsFromSampleRows(sampledRows, merged, previewColumns);
            return merged;
        })();

        this.sampledFieldCache.set(normalizedModel, loader);
        return loader;
    }

    private needsExistingRowInference(definitions: ModelFieldDefinition[], previewColumns: string[]): boolean {
        const previewSet = new Set(previewColumns.map((column) => String(column ?? '').trim()).filter(Boolean));
        if (!previewSet.size) return false;

        const definitionMap = new Map(definitions.map((entry) => [entry.key, entry]));
        for (const column of previewSet) {
            const definition = definitionMap.get(column);
            if (!definition) return true;
            if (definition.type === 'textfield' && !definition.multiple) return true;
        }
        return false;
    }

    private mergeDefinitionsFromSampleRows(
        rows: Array<Record<string, unknown>>,
        definitions: ModelFieldDefinition[],
        previewColumns: string[]
    ): void {
        const previewSet = new Set(previewColumns.map((column) => String(column ?? '').trim()).filter(Boolean));
        const defMap = new Map(definitions.map((entry) => [entry.key, entry]));

        for (const row of rows) {
            for (const [key, value] of Object.entries(row)) {
                if (!previewSet.has(key)) continue;
                const sampledDefinition = this.definitionFromSampleValue(key, value);
                if (!sampledDefinition) continue;

                const existing = defMap.get(key);
                if (existing) {
                    if (sampledDefinition.multiple) existing.multiple = true;
                    if ((existing.type === 'textfield' || existing.type === '') && sampledDefinition.type !== 'textfield') {
                        existing.type = sampledDefinition.type;
                    }
                    continue;
                }

                definitions.push(sampledDefinition);
                defMap.set(key, sampledDefinition);
            }
        }
    }

    private definitionFromSampleValue(key: string, value: unknown): ModelFieldDefinition | null {
        if (Array.isArray(value)) return { key, type: 'textfield', multiple: true };
        if (typeof value === 'boolean') return { key, type: 'checkbox', multiple: false };
        if (typeof value === 'number' && Number.isFinite(value)) return { key, type: 'number', multiple: false };
        return null;
    }

    private extractFormSchema(payload: unknown): Record<string, unknown> | null {
        if (!this.isRecord(payload)) return null;
        const content = this.isRecord(payload['content']) ? payload['content'] : null;
        if (content) {
            const schema = content['schema'];
            if (Array.isArray(schema)) return { display: 'form', components: schema };
            if (this.isRecord(schema) && Array.isArray(schema['components'])) return schema;
        }
        if (Array.isArray(payload['components'])) return { display: 'form', components: payload['components'] };
        return null;
    }

    private collectFieldDefinitions(
        nodes: unknown[],
        definitions: ModelFieldDefinition[],
        seen: Set<string>
    ): void {
        for (const node of nodes) {
            if (!this.isRecord(node)) continue;
            const key = String(node['key'] ?? '').trim();
            const type = String(node['type'] ?? '').trim().toLowerCase();
            const input = node['input'] !== false;
            if (key && input && !seen.has(key) && !this.isStructuralComponent(type)) {
                definitions.push({
                    key,
                    type: type || 'textfield',
                    multiple: this.toBooleanFlag(node['multiple'])
                });
                seen.add(key);
            }

            const nestedComponents = Array.isArray(node['components']) ? node['components'] as unknown[] : [];
            if (nestedComponents.length) this.collectFieldDefinitions(nestedComponents, definitions, seen);

            const columns = Array.isArray(node['columns']) ? node['columns'] as unknown[] : [];
            columns.forEach((column) => {
                const columnComponents = this.isRecord(column) && Array.isArray(column['components'])
                    ? column['components'] as unknown[]
                    : [];
                if (columnComponents.length) this.collectFieldDefinitions(columnComponents, definitions, seen);
            });

            const rows = Array.isArray(node['rows']) ? node['rows'] as unknown[] : [];
            rows.forEach((row) => {
                if (!Array.isArray(row)) return;
                row.forEach((cell) => {
                    const cellComponents = this.isRecord(cell) && Array.isArray(cell['components'])
                        ? cell['components'] as unknown[]
                        : [];
                    if (cellComponents.length) this.collectFieldDefinitions(cellComponents, definitions, seen);
                });
            });
        }
    }

    /**
     * Parses the /schema_model response (Pydantic JSON Schema or custom format) and
     * upserts field definitions so backend types take precedence over Form.io types.
     */
    private mergeBackendFieldDefinitions(payload: unknown, definitions: ModelFieldDefinition[]): void {
        const props = this.extractBackendProperties(payload);
        if (!props) return;

        const defMap = new Map(definitions.map((d) => [d.key, d]));

        for (const [key, meta] of Object.entries(props)) {
            if (!key || key === '__rowid') continue;
            const fieldMeta = this.isRecord(meta) ? meta : {};
            const rawType = this.extractBackendFieldType(fieldMeta);
            const formioType = this.backendTypeToFormio(rawType);
            if (!formioType) continue;

            const isMultiple = this.isBackendMultipleField(fieldMeta, rawType)
                || this.toBooleanFlag(fieldMeta['multiple'])
                || this.hasBackendItems(fieldMeta);

            const existing = defMap.get(key);
            if (existing) {
                // Always propagate multiple flag from backend (e.g. tags component).
                if (isMultiple && !existing.multiple) existing.multiple = true;
                // Only upgrade textfield → richer type; never downgrade.
                if (existing.type === 'textfield' || existing.type === '') {
                    existing.type = formioType;
                }
            } else {
                const def: ModelFieldDefinition = { key, type: formioType, multiple: isMultiple };
                definitions.push(def);
                defMap.set(key, def);
            }
        }
    }

    private extractBackendProperties(payload: unknown): Record<string, unknown> | null {
        if (!this.isRecord(payload)) return null;

        const directProperties = this.isRecord(payload['properties']) ? payload['properties'] : null;
        if (directProperties) return directProperties;

        const directFields = this.isRecord(payload['fields']) ? payload['fields'] : null;
        if (directFields) return directFields;

        const schema = this.isRecord(payload['schema']) ? payload['schema'] : null;
        const schemaProperties = schema && this.isRecord(schema['properties']) ? schema['properties'] : null;
        if (schemaProperties) return schemaProperties;

        const content = this.isRecord(payload['content']) ? payload['content'] : null;
        if (!content) return null;

        const contentProperties = this.isRecord(content['properties']) ? content['properties'] : null;
        if (contentProperties) return contentProperties;

        const contentFields = this.isRecord(content['fields']) ? content['fields'] : null;
        if (contentFields) return contentFields;

        const contentSchema = this.isRecord(content['schema']) ? content['schema'] : null;
        return contentSchema && this.isRecord(contentSchema['properties']) ? contentSchema['properties'] : null;
    }

    private extractBackendFieldType(fieldMeta: Record<string, unknown>): string {
        const typeCandidates = this.collectBackendTypeCandidates(fieldMeta).filter((entry) => entry !== 'null');
        return typeCandidates[0] ?? '';
    }

    private collectBackendTypeCandidates(fieldMeta: Record<string, unknown>): string[] {
        const types: string[] = [];
        const pushType = (value: unknown): void => {
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (normalized) types.push(normalized);
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((entry) => pushType(entry));
            }
        };
        const pushCompositeTypes = (value: unknown): void => {
            if (!Array.isArray(value)) return;
            value.forEach((entry) => {
                if (!this.isRecord(entry)) return;
                pushType(entry['type']);
                pushType(entry['python_type']);
                if (this.hasBackendItems(entry)) types.push('array');
            });
        };

        pushType(fieldMeta['type']);
        pushType(fieldMeta['python_type']);
        pushCompositeTypes(fieldMeta['anyOf']);
        pushCompositeTypes(fieldMeta['oneOf']);
        pushCompositeTypes(fieldMeta['allOf']);
        if (this.hasBackendItems(fieldMeta)) types.push('array');

        return Array.from(new Set(types));
    }

    private isBackendMultipleField(fieldMeta: Record<string, unknown>, rawType: string): boolean {
        if (rawType === 'array' || rawType === 'list') return true;
        return this.collectBackendTypeCandidates(fieldMeta).some((entry) => entry === 'array' || entry === 'list');
    }

    private hasBackendItems(fieldMeta: Record<string, unknown>): boolean {
        return this.isRecord(fieldMeta['items']) || Array.isArray(fieldMeta['items']);
    }

    private backendTypeToFormio(rawType: string): string | null {
        switch (rawType) {
            case 'bool': case 'boolean':                    return 'checkbox';
            case 'int': case 'float': case 'number':
            case 'integer': case 'decimal':                 return 'number';
            case 'str': case 'string':                      return 'textfield';
            case 'list': case 'array':                      return 'textfield'; // multiple handled separately
            default:                                         return null;
        }
    }

    private ensureFieldDefinition(definitions: ModelFieldDefinition[], key: string): void {
        if (definitions.some((entry) => entry.key === key)) return;
        definitions.unshift({ key, type: 'textfield', multiple: false });
    }

    private isStructuralComponent(type: string): boolean {
        return new Set([
            'button',
            'content',
            'htmlelement',
            'columns',
            'column',
            'panel',
            'fieldset',
            'well',
            'tabs',
            'tab',
            'container',
            'table',
            'search_area',
            'export_area',
            'import_component'
        ]).has(type);
    }

    private prepareImportRow(
        row: ImportPreviewRow,
        fieldMap: Map<string, ModelFieldDefinition>
    ): { prepared: Record<string, unknown>; warnings: string[] } {
        const prepared: Record<string, unknown> = {};
        const warnings: string[] = [];

        Object.entries(row).forEach(([key, value]) => {
            const normalizedKey = String(key ?? '').trim();
            if (!normalizedKey || this.importMetadataKeys.has(normalizedKey)) return;
            const definition = fieldMap.get(normalizedKey);
            const coerced = this.coerceFieldValue(value, definition);
            if (definition) {
                const warn = this.coercionWarning(value, coerced, normalizedKey, definition);
                if (warn) warnings.push(warn);
            }
            prepared[normalizedKey] = coerced;
        });

        prepared['data_value'] = this.buildDataValueAlias(prepared);
        return { prepared, warnings };
    }

    private buildDataValueAlias(record: Record<string, unknown>): Record<string, unknown> {
        const explicit = this.isRecord(record['data_value']) ? this.cloneRecord(record['data_value']) : {};
        const alias: Record<string, unknown> = { ...explicit };
        const excludedKeys = new Set(['data', 'data_value', 'schema', 'formio', 'components']);
        Object.entries(record).forEach(([key, value]) => {
            if (excludedKeys.has(key) || value === undefined) return;
            if (Object.prototype.hasOwnProperty.call(alias, key)) return;
            alias[key] = value;
        });
        return alias;
    }

    private async deleteExistingRecords(model: string): Promise<string[]> {
        const rows = await this.fetchSourceRows(model, false);
        const errors: string[] = [];
        const actionName = `delete_${model}`;
        for (const row of rows) {
            const recName = String(row['rec_name'] ?? '').trim();
            if (!recName) continue;
            try {
                await this.api.deleteAction(actionName, recName, {});
            } catch (error) {
                errors.push(`Delete ${recName}: ${this.errorMessage(error)}`);
            }
        }
        return errors;
    }

    private coerceFieldValue(value: unknown, definition?: ModelFieldDefinition): unknown {
        // Arrays → join only when field is explicitly a string type (e.g. app_code: str in Pydantic).
        // For unknown or non-string fields keep the array as-is.
        if (Array.isArray(value)) {
            if (definition?.multiple) return value;
            if (definition?.type === 'textfield') {
                return value.map((v) => String(v ?? '')).filter(Boolean).join(',');
            }
            return value;
        }

        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!trimmed) {
            if (definition?.multiple) return [];
            if (definition?.type === 'number') return null;
            if (definition?.type === 'checkbox') return false;
            return value; // '' → '' for string fields (Pydantic str accepts empty string)
        }

        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                const parsed = JSON.parse(trimmed);
                // Re-apply array coercion after JSON.parse.
                if (Array.isArray(parsed)) {
                    if (definition?.multiple) return parsed;
                    // Empty array → empty string regardless of definition (never a valid backend scalar).
                    if (!parsed.length) return '';
                    // Non-empty + known string field → join.
                    if (definition?.type === 'textfield') {
                        return parsed.map((v) => String(v ?? '')).filter(Boolean).join(',');
                    }
                    return parsed;
                }
                return parsed;
            } catch {
                // keep raw string when the cell contains plain text that looks like JSON.
            }
        }

        if (definition?.multiple && trimmed.includes(',')) {
            return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
        }

        switch (definition?.type) {
            case 'number': {
                const parsed = Number(trimmed);
                return Number.isFinite(parsed) ? parsed : 0;
            }
            case 'checkbox': {
                const parsed = this.parseBooleanString(trimmed);
                return parsed ?? true;
            }
            default:
                return value;
        }
    }

    /** Returns a warning string when coercion had to fall back to a default, null otherwise. */
    private coercionWarning(originalValue: unknown, coerced: unknown, key: string, definition: ModelFieldDefinition): string | null {
        if (definition.type === 'number') {
            const raw = typeof originalValue === 'string' ? originalValue.trim() : null;
            if (raw && coerced === 0 && !Number.isFinite(Number(raw))) {
                return `campo "${key}": "${raw}" non è un numero valido, impostato a 0`;
            }
        }
        return null;
    }

    private parseBooleanString(value: string): boolean | null {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'si', 'sì'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
        return null;
    }

    private extractRows(payload: unknown): Array<Record<string, unknown>> {
        let target: unknown = payload;
        for (let index = 0; index < 4; index += 1) {
            if (this.isRecord(target) && this.isRecord(target['content'])) {
                target = target['content']['data'] ?? target['content'];
                continue;
            }
            if (this.isRecord(target)) {
                const next = target['data'] ?? target['items'] ?? target['records'];
                if (next !== undefined) {
                    target = next;
                    continue;
                }
            }
            break;
        }
        if (!Array.isArray(target)) return [];
        return target.filter((row): row is Record<string, unknown> => this.isRecord(row));
    }

    private flattenPreviewRow(row: Record<string, unknown>): ImportPreviewRow {
        const flattened: ImportPreviewRow = {};
        Object.entries(row).forEach(([key, value]) => {
            if (value !== null && typeof value === 'object') {
                flattened[key] = JSON.stringify(value);
                return;
            }
            flattened[key] = value;
        });
        return flattened;
    }

    private collectColumns(rows: ImportPreviewRow[]): string[] {
        const columns = new Set<string>();
        rows.forEach((row) => {
            Object.keys(row).forEach((key) => {
                const normalized = String(key ?? '').trim();
                if (normalized) columns.add(normalized);
            });
        });
        return [...columns];
    }

    private normalizePreviewRow(row: ImportPreviewRow, columns: string[]): ImportPreviewRow {
        const normalized: ImportPreviewRow = {};
        columns.forEach((column) => {
            normalized[column] = row[column] ?? '';
        });
        return normalized;
    }

    private toCsv(columns: string[], rows: ImportPreviewRow[]): string {
        const csvRows = [
            columns.map((value) => this.escapeCsv(value)).join(','),
            ...rows.map((row) => columns.map((column) => this.escapeCsv(this.toCellString(row[column]))).join(','))
        ];
        return `${csvRows.join('\n')}\n`;
    }

    private escapeCsv(value: string): string {
        const normalized = String(value ?? '');
        if (!/[",\n]/.test(normalized)) return normalized;
        return `"${normalized.replace(/"/g, '""')}"`;
    }

    private toCellString(value: unknown): string {
        if (value == null) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    private saveGeneratedFile(file: GeneratedFile): void {
        const downloadUrl = URL.createObjectURL(file.blob);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = file.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
    }

    private clearPanelMessage(): void {
        this.panelMessage = '';
        this.panelError = false;
    }

    private setPanelMessage(message: string, error: boolean): void {
        this.panelMessage = message;
        this.panelError = error;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private buildTimestamp(date = new Date()): string {
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
        return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
    }

    private readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) {
            if (typeof entry === 'string' && entry.trim()) return entry.trim();
        }
        return '';
    }

    private toBooleanFlag(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            return ['true', '1', 'yes', 'on', 'si', 'sì'].includes(value.trim().toLowerCase());
        }
        return false;
    }

    private async ensureXlsxRuntime(): Promise<XlsxRuntime> {
        if (window.XLSX) return window.XLSX;
        if (this.xlsxLoader) return this.xlsxLoader;

        this.xlsxLoader = new Promise<XlsxRuntime>((resolve, reject) => {
            const existing = document.querySelector('script[data-ozon-xlsx="1"]') as HTMLScriptElement | null;
            if (existing) {
                existing.addEventListener('load', () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Runtime XLSX non disponibile.')), { once: true });
                existing.addEventListener('error', () => reject(new Error('Impossibile caricare il parser XLSX.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'assets/vendor/xlsx/xlsx.full.min.js';
            script.async = true;
            script.dataset['ozonXlsx'] = '1';
            script.onload = () => {
                if (window.XLSX) resolve(window.XLSX);
                else reject(new Error('Runtime XLSX non disponibile.'));
            };
            script.onerror = () => reject(new Error('Impossibile caricare il parser XLSX.'));
            document.head.appendChild(script);
        });

        return this.xlsxLoader;
    }
}
