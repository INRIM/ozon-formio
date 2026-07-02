import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Formio } from '@formio/js';
import { eachComponent as formioEachComponent } from '@formio/js/utils';
import { OzonApiService } from '../core/ozon-api.service';
import {
    ExportFileType,
    ImportPreviewRow,
    ImportTemplateFormat,
    ListExportConfig,
    ListImportConfig,
    ListSearchSessionContext
} from '../models/app.types';
import { FastSearchPayload, ListRequestPayload } from '../models/ozon.types';

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

class PythonLiteralParser {
    private index = 0;

    constructor(private readonly input: string) {}

    parse(): unknown {
        const value = this.parseValue();
        this.skipWhitespace();
        if (this.index !== this.input.length) {
            throw new Error(`Unexpected token at ${this.index}`);
        }
        return value;
    }

    private parseValue(): unknown {
        this.skipWhitespace();
        const current = this.input[this.index];
        if (!current) throw new Error('Unexpected end of input');

        if (current === '{') return this.parseObject();
        if (current === '[') return this.parseArray();
        if (current === '\'' || current === '"') return this.parseString(current);
        if (current === '-' || this.isDigit(current)) return this.parseNumber();
        if (this.input.startsWith('True', this.index)) {
            this.index += 4;
            return true;
        }
        if (this.input.startsWith('False', this.index)) {
            this.index += 5;
            return false;
        }
        if (this.input.startsWith('None', this.index)) {
            this.index += 4;
            return null;
        }

        return this.parseIdentifier();
    }

    private parseObject(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        this.index += 1;
        this.skipWhitespace();
        if (this.input[this.index] === '}') {
            this.index += 1;
            return result;
        }

        while (this.index < this.input.length) {
            const key = String(this.parseObjectKey());
            this.skipWhitespace();
            this.expect(':');
            result[key] = this.parseValue();
            this.skipWhitespace();

            const current = this.input[this.index];
            if (current === '}') {
                this.index += 1;
                return result;
            }
            this.expect(',');
            this.skipWhitespace();
            if (this.input[this.index] === '}') {
                this.index += 1;
                return result;
            }
        }

        throw new Error('Unterminated object literal');
    }

    private parseArray(): unknown[] {
        const result: unknown[] = [];
        this.index += 1;
        this.skipWhitespace();
        if (this.input[this.index] === ']') {
            this.index += 1;
            return result;
        }

        while (this.index < this.input.length) {
            result.push(this.parseValue());
            this.skipWhitespace();

            const current = this.input[this.index];
            if (current === ']') {
                this.index += 1;
                return result;
            }
            this.expect(',');
            this.skipWhitespace();
            if (this.input[this.index] === ']') {
                this.index += 1;
                return result;
            }
        }

        throw new Error('Unterminated array literal');
    }

    private parseObjectKey(): unknown {
        this.skipWhitespace();
        const current = this.input[this.index];
        if (current === '\'' || current === '"') return this.parseString(current);
        return this.parseIdentifier();
    }

    private parseIdentifier(): string {
        const start = this.index;
        while (this.index < this.input.length) {
            const current = this.input[this.index];
            if (!current || !/[A-Za-z0-9_\-$]/.test(current)) break;
            this.index += 1;
        }
        if (start === this.index) {
            throw new Error(`Unexpected token at ${this.index}`);
        }
        return this.input.slice(start, this.index);
    }

    private parseString(quote: string): string {
        let result = '';
        this.index += 1;
        while (this.index < this.input.length) {
            const current = this.input[this.index];
            if (current === quote) {
                this.index += 1;
                return result;
            }
            if (current !== '\\') {
                result += current;
                this.index += 1;
                continue;
            }

            const next = this.input[this.index + 1];
            if (!next) throw new Error('Invalid string escape');

            switch (next) {
                case '\\': result += '\\'; break;
                case '\'': result += '\''; break;
                case '"': result += '"'; break;
                case 'n': result += '\n'; break;
                case 'r': result += '\r'; break;
                case 't': result += '\t'; break;
                case 'b': result += '\b'; break;
                case 'f': result += '\f'; break;
                case '/': result += '/'; break;
                case 'u': {
                    const hex = this.input.slice(this.index + 2, this.index + 6);
                    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new Error('Invalid unicode escape');
                    result += String.fromCharCode(parseInt(hex, 16));
                    this.index += 4;
                    break;
                }
                default:
                    result += next;
                    break;
            }

            this.index += 2;
        }

        throw new Error('Unterminated string literal');
    }

    private parseNumber(): number {
        const start = this.index;
        if (this.input[this.index] === '-') this.index += 1;
        while (this.isDigit(this.input[this.index])) this.index += 1;
        if (this.input[this.index] === '.') {
            this.index += 1;
            while (this.isDigit(this.input[this.index])) this.index += 1;
        }
        if (this.input[this.index] === 'e' || this.input[this.index] === 'E') {
            this.index += 1;
            if (this.input[this.index] === '+' || this.input[this.index] === '-') this.index += 1;
            while (this.isDigit(this.input[this.index])) this.index += 1;
        }

        const raw = this.input.slice(start, this.index);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) throw new Error(`Invalid number ${raw}`);
        return parsed;
    }

    private expect(char: string): void {
        if (this.input[this.index] !== char) {
            throw new Error(`Expected "${char}" at ${this.index}`);
        }
        this.index += 1;
    }

    private skipWhitespace(): void {
        while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
            this.index += 1;
        }
    }

    private isDigit(value: string | undefined): boolean {
        return !!value && value >= '0' && value <= '9';
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
    @Output() importBusyChange = new EventEmitter<boolean>();
    @Output() importFinished = new EventEmitter<void>();

    private readonly importMetadataKeys = new Set([
        '_id', 'id', 'owner_uid', 'owner_name', 'owner_sector', 'owner_sector_id',
        'owner_function', 'update_datetime', 'create_datetime', 'owner_mail',
        'update_uid', 'owner_function_type', 'demo', 'deleted', 'list_order',
        'owner_personal_type', 'owner_job_title', 'childs', '__sourceRow',
        'status', 'message', 'msg', 'detail', 'tz', 'data_value'
    ]);
    private readonly componentObjectKeys = new Set(['properties', 'settings', 'links']);
    private readonly componentArrayKeys = new Set(['components', 'tags']);
    private readonly componentScalarStringKeys = new Set(['app_code']);
    private readonly componentBooleanKeys = new Set([
        'make_virtual_model', 'authenticate', 'active', 'default', 'sys', 'demo'
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
    importRowStatuses: Array<{ rowReference: string; recName: string; ok: boolean; message: string }> = [];

    private xlsxLoader: Promise<XlsxRuntime> | null = null;
    private readonly modelPayloadCache = new Map<string, Promise<unknown>>();
    private readonly modelFieldCache = new Map<string, Promise<ModelFieldDefinition[]>>();

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
        this.importBusyChange.emit(true);
        try {
            const importModel = this.importConfig.model;
            const [fieldDefinitions, formSchema] = await Promise.all([
                this.loadModelFieldDefinitions(importModel),
                this.loadFormSchemaForModel(importModel)
            ]);
            const fieldMap = new Map(fieldDefinitions.map((entry) => [entry.key, entry]));

            const isComponentModel = this.isComponentImportModel(importModel);
            const rowsWithMeta: Array<{ row: ImportPreviewRow; componentError?: string }> = isComponentModel
                ? await Promise.all(this.previewRows.map((row) => this.preNormalizeComponentRow(row)))
                : this.previewRows.map((row) => ({ row }));

            const formHandle = formSchema ? await this.createFormInstanceForImport(formSchema) : null;
            const allWarnings: string[] = [];
            const preparedRows: Array<{
                rowReference: string;
                recName: string;
                prepared: Record<string, unknown>;
                componentError?: string;
            }> = [];
            try {
                for (let index = 0; index < rowsWithMeta.length; index += 1) {
                    const { row, componentError } = rowsWithMeta[index];
                    if (componentError) {
                        const recName = String(row['rec_name'] ?? '').trim();
                        const rowReference = this.describeImportRow(row, index, recName);
                        preparedRows.push({ rowReference, recName, prepared: {}, componentError });
                        continue;
                    }
                    const { prepared, warnings } = this.prepareImportRow(row, fieldMap, importModel);
                    // Formio submission normalization: override manually-coerced values with
                    // formio-typed values for fields the form schema knows about.
                    if (formHandle) {
                        const formioData = this.extractFormioSubmissionData(formHandle.form, prepared);
                        this.mergePreparedWithFormioData(prepared, formioData, fieldMap);
                        // Re-serialize any dict/array that formio parsed but the backend field expects as string.
                        for (const [key, value] of Object.entries(prepared)) {
                            const def = fieldMap.get(key);
                            if (this.isComponentImportModel(importModel)
                                && (this.componentObjectKeys.has(key) || this.componentArrayKeys.has(key))) {
                                continue;
                            }
                            if (def && this.isScalarStringField(def) && (this.isRecord(value) || Array.isArray(value))) {
                                prepared[key] = JSON.stringify(value);
                            }
                        }
                    }
                    const recName = String(prepared['rec_name'] ?? '').trim();
                    const rowReference = this.describeImportRow(row, index, recName);
                    warnings.forEach((w) => allWarnings.push(`${rowReference}: ${w}`));
                    preparedRows.push({ rowReference, recName, prepared, componentError });
                }
            } finally {
                if (formHandle) this.destroyFormInstance(formHandle);
            }
            if (!preparedRows.length) {
                throw new Error('Il file non contiene righe importabili.');
            }

            const errorLines: string[] = [];
            const rowStatuses: Array<{ rowReference: string; recName: string; ok: boolean; message: string }> = [];
            let ok = 0;
            if (this.deleteBefore) {
                const cleanResponse = await this.api.importClean(importModel);
                const cleanResult = this.normalizeImportResponse(cleanResponse);
                if (!cleanResult.success) {
                    const cleanMessage = cleanResult.errorLines[0] || cleanResult.message || 'Pulizia record fallita.';
                    throw new Error(cleanMessage);
                }
            }

            for (const row of preparedRows) {
                if (row.componentError) {
                    const message = row.componentError;
                    errorLines.push(`${row.rowReference}: ${message}`);
                    rowStatuses.push({ rowReference: row.rowReference, recName: row.recName, ok: false, message });
                    continue;
                }
                if (!row.recName) {
                    const message = 'rec_name mancante';
                    errorLines.push(`${row.rowReference}: ${message}`);
                    rowStatuses.push({ rowReference: row.rowReference, recName: '', ok: false, message });
                    continue;
                }

                try {
                    const response = await this.api.importData(importModel, row.prepared);
                    const importResult = this.normalizeImportResponse(response);
                    const rowError = importResult.failed
                        ? (importResult.message || importResult.errorLines[0] || 'Import fallito.')
                        : importResult.errorLines.join(' | ').trim();
                    if (!importResult.success) {
                        const message = rowError || importResult.message || 'Import fallito.';
                        errorLines.push(`${this.describeImportFailure(row.rowReference, row.recName)}: ${message}`);
                        rowStatuses.push({ rowReference: row.rowReference, recName: row.recName, ok: false, message });
                        continue;
                    }

                    ok += 1;
                    rowStatuses.push({ rowReference: row.rowReference, recName: row.recName, ok: true, message: '' });
                } catch (error) {
                    const message = this.errorMessage(error);
                    errorLines.push(`${this.describeImportFailure(row.rowReference, row.recName)}: ${message}`);
                    rowStatuses.push({ rowReference: row.rowReference, recName: row.recName, ok: false, message });
                }
            }

            this.importRowStatuses = rowStatuses;
            this.importResultLines = [...allWarnings, ...errorLines];
            this.setPanelMessage(`Import completato: ${ok} record importati.`, errorLines.length > 0);
        } catch (error) {
            this.importRowStatuses = [];
            this.importResultLines = [];
            this.setPanelMessage(this.errorMessage(error), true);
        } finally {
            this.importBusy = false;
            this.importBusyChange.emit(false);
            this.importFinished.emit();
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
        this.importRowStatuses = [];
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
            }).map((row, index) => this.attachSourceRow(this.flattenPreviewRow(row), index + 2));
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
            .map((row, index) => this.attachSourceRow(this.flattenPreviewRow(row), index + 1));
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

        const sourceRows = withData
            ? await this.fetchSourceRows(model, true)
            : [];

        if (format === 'json') {
            return {
                blob: new Blob([JSON.stringify(sourceRows, null, 2)], { type: 'application/json;charset=utf-8' }),
                fileName: `${model}_${this.buildTimestamp()}.json`
            };
        }

        const rows = sourceRows.map((row) => this.flattenPreviewRow(row));
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

        if (filtered && context?.fastSearchActive && context?.actionName) {
            const rows: Array<Record<string, unknown>> = [];
            const fsPayload: FastSearchPayload = {
                query_fields: [...(context.fastSearchQueryFields ?? [])],
                order,
                skip: 0,
                limit: Math.max(totalCount, 1)
            };
            await this.api.filterFastSearch(
                context.actionName,
                fsPayload,
                (item) => {
                    if (this.isRecord(item)) rows.push(item);
                }
            );
            return rows;
        }

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

    private loadRecordSchemaPayload(model: string): Promise<unknown> {
        const cached = this.modelPayloadCache.get(model);
        if (cached) return cached;
        const loader = this.api.getRecordSchema(model).catch(() => null as unknown);
        this.modelPayloadCache.set(model, loader);
        return loader;
    }

    private async loadFormSchemaForModel(model: string): Promise<Record<string, unknown> | null> {
        const normalizedModel = String(model ?? '').trim();
        if (!normalizedModel) return null;
        const payload = await this.loadRecordSchemaPayload(normalizedModel);
        return this.extractFormSchema(payload);
    }

    private async loadModelFieldDefinitions(model: string): Promise<ModelFieldDefinition[]> {
        const normalizedModel = String(model ?? '').trim();
        if (!normalizedModel) return [];
        const cached = this.modelFieldCache.get(normalizedModel);
        if (cached) return cached;

        const loader = (async () => {
            const recordSchemaPayload = await this.loadRecordSchemaPayload(normalizedModel);

            const schema = this.extractFormSchema(recordSchemaPayload);
            const definitions: ModelFieldDefinition[] = [];
            if (schema) {
                this.collectFieldDefinitions(
                    Array.isArray(schema['components']) ? schema['components'] as unknown[] : [],
                    definitions,
                    new Set<string>()
                );
            }

            this.ensureFieldDefinition(definitions, 'rec_name');
            this.ensureFieldDefinition(definitions, 'owner_uid');
            return definitions;
        })();

        this.modelFieldCache.set(normalizedModel, loader);
        return loader;
    }

    private extractFormSchema(payload: unknown): Record<string, unknown> | null {
        if (!this.isRecord(payload)) return null;
        const content = this.isRecord(payload['content']) ? payload['content'] : null;
        if (content) {
            const contentData = this.isRecord(content['data']) ? content['data'] as Record<string, unknown> : null;
            if (contentData && Array.isArray(contentData['components'])) {
                return { display: 'form', components: contentData['components'] };
            }
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
        formioEachComponent(nodes as any[], (node: Record<string, unknown>) => {
            if (!this.isRecord(node)) return false;
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
            return false;
        }, true);
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
        fieldMap: Map<string, ModelFieldDefinition>,
        model: string
    ): { prepared: Record<string, unknown>; warnings: string[] } {
        const prepared: Record<string, unknown> = {};
        const warnings: string[] = [];

        Object.entries(row).forEach(([key, value]) => {
            const normalizedKey = String(key ?? '').trim();
            if (!normalizedKey || this.importMetadataKeys.has(normalizedKey)) return;
            const definition = fieldMap.get(normalizedKey);
            const structured = this.coerceStructuredFieldValue(normalizedKey, value, model);
            if (structured.handled) {
                if (structured.parseWarning) warnings.push(structured.parseWarning);
                prepared[normalizedKey] = structured.value;
                return;
            }
            const coerced = this.coerceFieldValue(value, definition);
            if (definition) {
                const warn = this.coercionWarning(value, coerced, normalizedKey, definition);
                if (warn) warnings.push(warn);
            }
            prepared[normalizedKey] = coerced;
        });

        if (this.isComponentImportModel(model)) {
            return {
                prepared: this.normalizeComponentImportRow(prepared),
                warnings
            };
        }

        return { prepared, warnings };
    }

    private normalizeImportResponse(response: unknown): {
        failed: boolean;
        success: boolean;
        message: string;
        ok: number;
        errorLines: string[];
    } {
        if (typeof response === 'string') {
            const normalized = response.trim();
            const failed = /^(error|failed?|internal server error)\b/i.test(normalized);
            return {
                failed,
                success: !failed,
                message: failed ? normalized : '',
                ok: failed ? 0 : 1,
                errorLines: failed && normalized ? [normalized] : []
            };
        }
        if (!this.isRecord(response)) {
            return {
                failed: false,
                success: true,
                message: '',
                ok: 1,
                errorLines: []
            };
        }

        const status = String(response['status'] ?? '').trim().toLowerCase();
        const failedFlag = response['fail'] ?? response['failed'];
        const hasFailedFlag = typeof failedFlag === 'boolean';
        const failedByFlag = hasFailedFlag ? failedFlag === true : false;
        const failedByStatus = ['error', 'failed', 'fail', 'ko'].includes(status);
        const failed = failedByFlag || failedByStatus;
        const message = String(response['msg'] ?? response['message'] ?? '').trim();

        const errorLines: string[] = [];
        const errorList = response['error_list'];
        if (Array.isArray(errorList)) {
            errorList
                .map((entry) => this.toImportResultLine(entry))
                .filter(Boolean)
                .forEach((entry) => errorLines.push(entry));
        }
        if (!errorLines.length) {
            const errorText = String(response['error'] ?? '').trim();
            if (errorText) {
                errorText
                    .split('<br/>')
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                    .forEach((entry) => errorLines.push(entry));
            }
        }
        if (!errorLines.length && failed && message) {
            errorLines.push(message);
        }

        const rawOk = response['ok'];
        const normalizedOk = typeof rawOk === 'boolean'
            ? (rawOk ? 1 : 0)
            : Number(rawOk);
        const hasNumericOk = rawOk !== undefined && rawOk !== null && Number.isFinite(normalizedOk);
        const successByStatus = ['ok', 'done', 'success', 'completed'].includes(status);
        const successByFlag = hasFailedFlag && failedFlag === false;
        const success = !failed
            && !errorLines.length
            && (successByFlag || successByStatus || !hasNumericOk || normalizedOk > 0);
        const ok = hasNumericOk ? normalizedOk : (success ? 1 : 0);

        return { failed, success, message, ok, errorLines };
    }

    private toImportResultLine(value: unknown): string {
        if (typeof value === 'string') return value.trim();
        if (this.isRecord(value)) {
            const message = String(value['message'] ?? value['msg'] ?? '').trim();
            if (message) return message;
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }
        return String(value ?? '').trim();
    }

    private isComponentImportModel(model: string): boolean {
        return String(model ?? '').trim().toLowerCase() === 'component';
    }

    private normalizeComponentImportRow(record: Record<string, unknown>): Record<string, unknown> {
        this.normalizeComponentStructuredFields(record);
        this.normalizeComponentBooleanFields(record);
        this.normalizeComponentScalarStringFields(record);
        return record;
    }

    private normalizeComponentStructuredFields(record: Record<string, unknown>): void {
        Object.keys(record).forEach((key) => {
            const value = record[key];
            if (this.componentObjectKeys.has(key)) {
                const normalized = this.normalizeStructuredValue(value, 'object');
                if (normalized.ok) {
                    record[key] = normalized.value;
                }
                return;
            }
            if (this.componentArrayKeys.has(key)) {
                const mode = key === 'components' ? 'array' : 'array_or_csv';
                const normalized = this.normalizeStructuredValue(value, mode);
                if (normalized.ok) {
                    record[key] = normalized.value;
                }
            }
        });
    }

    private normalizeComponentBooleanFields(record: Record<string, unknown>): void {
        Object.keys(record).forEach((key) => {
            if (!this.componentBooleanKeys.has(key)) return;
            const value = record[key];
            if (typeof value === 'boolean') return;
            if (typeof value === 'number') {
                record[key] = value !== 0;
                return;
            }
            if (typeof value !== 'string') return;
            if (!value.trim()) {
                record[key] = false;
                return;
            }
            const parsed = this.parseBooleanString(value);
            if (parsed !== null) record[key] = parsed;
        });
    }

    private normalizeComponentScalarStringFields(record: Record<string, unknown>): void {
        Object.keys(record).forEach((key) => {
            if (!this.componentScalarStringKeys.has(key)) return;
            const value = record[key];
            if (typeof value === 'string') return;
            if (Array.isArray(value)) {
                record[key] = value.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(',');
                return;
            }
            if (value == null) {
                record[key] = '';
                return;
            }
            record[key] = String(value);
        });
    }

    private async normalizeFormioComponents(
        raw: unknown
    ): Promise<{ ok: boolean; value: unknown[]; warning?: string }> {
        const parsed = this.normalizeStructuredValue(raw, 'array');
        const baseArray: unknown[] = parsed.ok && Array.isArray(parsed.value)
            ? (parsed.value as unknown[])
            : [];

        if (!baseArray.length && !parsed.ok) {
            return { ok: false, value: [], warning: `campo "components": impossibile parsare come lista` };
        }

        try {
            const container = document.createElement('div');
            container.style.display = 'none';
            document.body.appendChild(container);
            let formInstance: any;
            try {
                formInstance = await (Formio as any).createForm(container, {
                    display: 'form',
                    components: baseArray,
                });
                const normalized: unknown[] = formInstance.schema?.components ?? baseArray;
                return { ok: true, value: normalized };
            } finally {
                if (formInstance) {
                    try { formInstance.destroy(true); } catch { /* ignore */ }
                }
                container.remove();
            }
        } catch {
            return { ok: baseArray.length > 0, value: baseArray };
        }
    }

    private async createFormInstanceForImport(
        formSchema: Record<string, unknown>
    ): Promise<{ form: any; container: HTMLElement } | null> {
        const container = document.createElement('div');
        container.style.display = 'none';
        document.body.appendChild(container);
        try {
            const form = await (Formio as any).createForm(container, formSchema, { noAlerts: true });
            return { form, container };
        } catch {
            container.remove();
            return null;
        }
    }

    private destroyFormInstance(handle: { form: any; container: HTMLElement }): void {
        try { handle.form.destroy(true); } catch { /* ignore */ }
        handle.container.remove();
    }

    private extractFormioSubmissionData(
        form: any,
        row: Record<string, unknown>
    ): Record<string, unknown> {
        try {
            form.submission = { data: { ...row } };
            const data = form.submission?.data;
            return this.isRecord(data) ? { ...data as Record<string, unknown> } : {};
        } catch {
            return {};
        }
    }

    private mergePreparedWithFormioData(
        prepared: Record<string, unknown>,
        formioData: Record<string, unknown>,
        fieldMap: Map<string, ModelFieldDefinition>
    ): void {
        Object.entries(formioData).forEach(([key, value]) => {
            const definition = fieldMap.get(key);
            if (!definition) return;
            if (this.isScalarStringField(definition)) return;
            if (this.shouldKeepPreparedValue(prepared[key], value, definition)) return;
            prepared[key] = value;
        });
    }

    private shouldKeepPreparedValue(
        currentValue: unknown,
        nextValue: unknown,
        definition: ModelFieldDefinition
    ): boolean {
        if (nextValue === undefined) return true;
        if (this.isEmptyRecord(nextValue)) {
            return currentValue !== undefined;
        }
        if (nextValue === null) {
            return currentValue !== undefined && currentValue !== null && currentValue !== '';
        }
        if (typeof nextValue === 'string' && !nextValue.trim()) {
            if (definition.multiple) return Array.isArray(currentValue);
            return currentValue !== undefined
                && currentValue !== null
                && (typeof currentValue !== 'string' || currentValue.trim() !== '');
        }
        if (Array.isArray(nextValue) && !nextValue.length) {
            if (definition.multiple) {
                return Array.isArray(currentValue) && currentValue.length > 0;
            }
            return currentValue !== undefined && currentValue !== null;
        }
        return false;
    }

    private async preNormalizeComponentRow(
        row: ImportPreviewRow
    ): Promise<{ row: ImportPreviewRow; componentError?: string }> {
        const raw = row['components'];
        if (raw == null || (Array.isArray(raw) && (raw as unknown[]).length === 0)) {
            return { row };
        }
        const result = await this.normalizeFormioComponents(raw);
        if (!result.ok) {
            const error = result.warning ?? 'campo "components": valore non parsabile come schema Formio — riga non importata';
            return { row, componentError: error };
        }
        return { row: { ...row, components: result.value } };
    }

    private normalizeStructuredValue(
        value: unknown,
        expected: 'object' | 'array' | 'array_or_csv'
    ): { ok: boolean; value?: unknown } {
        if (expected === 'object' && this.isRecord(value)) return { ok: true, value };
        if ((expected === 'array' || expected === 'array_or_csv') && Array.isArray(value)) return { ok: true, value };
        if (typeof value !== 'string') return { ok: false };

        const trimmed = value.trim();
        if (!trimmed) {
            if (expected === 'object') return { ok: true, value: {} };
            return { ok: true, value: [] };
        }

        const structured = this.tryParseStructuredValue(trimmed);
        if (structured.parsed) {
            const normalizedStructured = this.normalizeStructuredDataTree(structured.value);
            if (expected === 'object' && this.isRecord(normalizedStructured)) return { ok: true, value: normalizedStructured };
            if ((expected === 'array' || expected === 'array_or_csv') && Array.isArray(normalizedStructured)) {
                return { ok: true, value: normalizedStructured };
            }
        }

        if (expected === 'array_or_csv') {
            return {
                ok: true,
                value: trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
            };
        }
        return { ok: false };
    }

    private normalizeStructuredDataTree(value: unknown): unknown {
        const nested = this.parseNestedStructuredString(value);
        if (nested !== value) return this.normalizeStructuredDataTree(nested);
        if (Array.isArray(value)) {
            return value.map((entry) => this.normalizeStructuredDataTree(this.parseNestedStructuredString(entry)));
        }
        if (!this.isRecord(value)) return value;

        const normalized: Record<string, unknown> = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (Array.isArray(entry) || this.isRecord(entry)) {
                normalized[key] = this.normalizeStructuredDataTree(entry);
                return;
            }
            normalized[key] = entry;
        });
        return normalized;
    }

    private parseNestedStructuredString(value: unknown): unknown {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!trimmed) return value;

        const structured = this.tryParseStructuredValue(trimmed);
        if (!structured.parsed) return value;
        if (typeof structured.value === 'string' && structured.value.trim() === trimmed) return value;
        return structured.value;
    }

    private coerceStructuredFieldValue(
        key: string,
        value: unknown,
        model?: string
    ): { handled: boolean; value?: unknown; parseWarning?: string } {
        if (this.isComponentImportModel(model ?? '') && this.componentObjectKeys.has(key)) {
            const normalized = this.normalizeStructuredValue(value, 'object');
            if (!normalized.ok && typeof value === 'string' && value.trim()) {
                return { handled: true, value, parseWarning: `campo "${key}": impossibile parsare come oggetto` };
            }
            return { handled: true, value: normalized.ok ? normalized.value : value };
        }

        if (this.isComponentImportModel(model ?? '') && this.componentArrayKeys.has(key)) {
            const normalized = this.normalizeStructuredValue(value, key === 'components' ? 'array' : 'array_or_csv');
            if (!normalized.ok && typeof value === 'string' && value.trim()) {
                return { handled: true, value, parseWarning: `campo "${key}": impossibile parsare come lista` };
            }
            return { handled: true, value: normalized.ok ? normalized.value : value };
        }
        return { handled: false };
    }

    private coerceFieldValue(value: unknown, definition?: ModelFieldDefinition): unknown {
        const scalarStringField = this.isScalarStringField(definition);

        if (Array.isArray(value)) {
            if (definition?.multiple) return value;
            if (scalarStringField) return this.joinArrayValuesAsString(value);
            return value;
        }

        if (this.isRecord(value)) {
            if (scalarStringField) return JSON.stringify(value);
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

        const structured = this.tryParseStructuredValue(trimmed);
        if (structured.structured) {
            if (structured.parsed) {
                const parsed = structured.value;
                if (Array.isArray(parsed)) {
                    if (definition?.multiple) return parsed;
                    if (!parsed.length) return '';
                    if (scalarStringField) return this.joinArrayValuesAsString(parsed);
                    return parsed;
                }
                if (this.isRecord(parsed)) {
                    if (scalarStringField) return JSON.stringify(parsed);
                    return parsed;
                }
                if (parsed == null) {
                    if (definition?.multiple) return [];
                    if (definition?.type === 'number') return null;
                    if (definition?.type === 'checkbox') return false;
                    return scalarStringField ? '' : parsed;
                }
                if (definition?.type === 'number' && typeof parsed === 'number') return parsed;
                if (definition?.type === 'checkbox' && typeof parsed === 'boolean') return parsed;
                if (scalarStringField) return String(parsed);
                return parsed;
            }
            return value;
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

    private isScalarStringField(definition?: ModelFieldDefinition): boolean {
        return !!definition?.type
            && !definition.multiple
            && (definition.type === 'textfield' || definition.type === 'textarea');
    }

    private joinArrayValuesAsString(values: unknown[]): string {
        return values
            .map((entry) => String(entry ?? '').trim())
            .filter(Boolean)
            .join(',');
    }

    private tryParseStructuredValue(value: string): { structured: boolean; parsed: boolean; value?: unknown } {
        const candidates = this.buildStructuredParseCandidates(value);
        const pythonCandidates = this.buildPythonStructuredParseCandidates(value);
        if (!candidates.length && !pythonCandidates.length) return { structured: false, parsed: false };
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                if (typeof parsed === 'string') {
                    const nested = this.tryParseStructuredValue(parsed.trim());
                    if (nested.parsed) return nested;
                }
                return { structured: true, parsed: true, value: parsed };
            } catch {
                // Try the next normalization candidate.
            }
        }

        for (const candidate of pythonCandidates) {
            try {
                return { structured: true, parsed: true, value: new PythonLiteralParser(candidate).parse() };
            } catch {
                // Try the next Python-literal candidate.
            }
        }

        return { structured: true, parsed: false };
    }

    private buildStructuredParseCandidates(value: string): string[] {
        const trimmed = value.trim();
        if (!trimmed) return [];

        const candidates = new Set<string>();
        const pushCandidate = (candidate: string): void => {
            const normalized = candidate.trim();
            if (normalized && this.looksLikeStructuredValue(normalized)) {
                candidates.add(normalized);
            }
        };

        pushCandidate(trimmed);
        pushCandidate(this.unescapeStructuredLiteral(trimmed));
        pushCandidate(this.normalizeStructuredLiteral(trimmed));
        pushCandidate(this.normalizeStructuredLiteral(this.unescapeStructuredLiteral(trimmed)));

        const unwrapped = this.unwrapQuotedStructuredLiteral(trimmed);
        if (unwrapped) {
            pushCandidate(unwrapped);
            pushCandidate(this.unescapeStructuredLiteral(unwrapped));
            pushCandidate(this.normalizeStructuredLiteral(unwrapped));
            pushCandidate(this.normalizeStructuredLiteral(this.unescapeStructuredLiteral(unwrapped)));
        }

        return [...candidates];
    }

    private buildPythonStructuredParseCandidates(value: string): string[] {
        const trimmed = value.trim();
        if (!trimmed) return [];

        const candidates = new Set<string>();
        const pushCandidate = (candidate: string | null): void => {
            if (!candidate) return;
            const normalized = candidate.trim();
            if (normalized && this.looksLikeStructuredValue(normalized)) {
                candidates.add(normalized);
            }
        };

        pushCandidate(trimmed);
        pushCandidate(this.unescapeStructuredLiteral(trimmed));
        pushCandidate(this.unwrapQuotedStructuredLiteral(trimmed));
        return [...candidates];
    }

    private looksLikeStructuredValue(value: string): boolean {
        return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'));
    }

    private unwrapQuotedStructuredLiteral(value: string): string | null {
        if (value.length < 2) return null;
        const quote = value[0];
        if ((quote !== '"' && quote !== '\'') || value[value.length - 1] !== quote) return null;

        let inner = value.slice(1, -1).trim();
        if (!inner) return null;
        inner = inner.replace(/""/g, '"');
        inner = inner.replace(/\\(["'])/g, '$1');
        return this.looksLikeStructuredValue(inner) ? inner : null;
    }

    private unescapeStructuredLiteral(value: string): string {
        return value.replace(/\\(['"])/g, '$1');
    }

    private normalizeStructuredLiteral(value: string): string {
        let normalized = this.unescapeStructuredLiteral(value.trim());
        normalized = normalized.replace(/\bNone\b/g, 'null');
        normalized = normalized.replace(/\bTrue\b/g, 'true');
        normalized = normalized.replace(/\bFalse\b/g, 'false');
        normalized = normalized.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
            return `"${this.escapeJsonString(this.decodeSingleQuotedLiteralInner(inner))}"`;
        });
        normalized = normalized.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*:)/g, '$1"$2"$3');
        normalized = normalized.replace(/,\s*([}\]])/g, '$1');
        return normalized;
    }

    private decodeSingleQuotedLiteralInner(value: string): string {
        let decoded = '';
        for (let index = 0; index < value.length; index += 1) {
            const current = value[index];
            const next = value[index + 1];
            if (current !== '\\' || !next) {
                decoded += current;
                continue;
            }

            switch (next) {
                case '\\': decoded += '\\'; break;
                case '\'': decoded += '\''; break;
                case '"': decoded += '"'; break;
                case 'n': decoded += '\n'; break;
                case 'r': decoded += '\r'; break;
                case 't': decoded += '\t'; break;
                case 'b': decoded += '\b'; break;
                case 'f': decoded += '\f'; break;
                default:
                    decoded += next;
                    break;
            }
            index += 1;
        }
        return decoded;
    }

    private escapeJsonString(value: string): string {
        return JSON.stringify(value).slice(1, -1);
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
                if (normalized.startsWith('__')) return;
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
        if (typeof row['__sourceRow'] === 'number' && Number.isFinite(row['__sourceRow'])) {
            normalized['__sourceRow'] = row['__sourceRow'];
        }
        return normalized;
    }

    private attachSourceRow(row: ImportPreviewRow, sourceRow: number): ImportPreviewRow {
        return {
            ...row,
            __sourceRow: sourceRow
        };
    }

    private describeImportRow(row: ImportPreviewRow, index: number, recName = ''): string {
        if (recName) return recName;
        return `Riga ${index + 1}`;
    }

    private describeImportFailure(rowReference: string, recName: string): string {
        if (rowReference && recName && rowReference !== recName) {
            return `${rowReference} (${recName})`;
        }
        return rowReference || recName || 'Record';
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

    private isEmptyRecord(value: unknown): value is Record<string, unknown> {
        return this.isRecord(value) && Object.keys(value).length === 0;
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
