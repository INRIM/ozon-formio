import { Formio } from '@formio/js';
import { AllCommunityModule, ColDef, createGrid, GridApi, GridOptions, ModuleRegistry } from 'ag-grid-community';
import { OzonApiService } from '../core/ozon-api.service';

ModuleRegistry.registerModules([AllCommunityModule]);

const COMPONENT_TYPE = 'ozon_data_table';
let registered = false;
let apiServiceRef: OzonApiService | null = null;

/** Wires the singleton OzonApiService into the component, once Angular DI is up (main.ts runs before it). */
export function setOzonDataTableApiService(api: OzonApiService): void {
  apiServiceRef = api;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function splitCsvList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
}

export function installOzonDataTableFormioComponent(): void {
  if (registered) return;
  const components = (Formio as unknown as { Components?: { components?: Record<string, any> } }).Components?.components;
  const TextAreaComponent = components?.['textarea'];
  if (!TextAreaComponent) return;

  class OzonDataTableFormioComponent extends TextAreaComponent {
    static schema(...extend: Record<string, unknown>[]) {
      return TextAreaComponent.schema({
        type: COMPONENT_TYPE,
        label: 'Data Table',
        key: 'ozonDataTable',
        input: false,
        tableView: false,
        persistent: false
      }, ...extend);
    }

    static get builderInfo() {
      return {
        title: 'Data Table',
        group: 'advanced',
        icon: 'table',
        weight: 81,
        schema: OzonDataTableFormioComponent.schema()
      };
    }

    private gridApi: GridApi | null = null;
    private gridElement: HTMLElement | null = null;

    renderElement(_value: unknown, index: number): string {
      const self = this as any;
      return `
        <div
          ${self['_referenceAttributeName']}="input"
          class="ozon-data-table-grid ag-theme-quartz"
          data-index="${index}"
        ></div>
      `;
    }

    attachElement(element: HTMLElement, _index: number): HTMLElement {
      this.gridElement = element;
      void this.loadAndRenderGrid();
      return element;
    }

    detach(): void {
      this.destroyGrid();
      return super.detach();
    }

    destroy(all?: boolean): void {
      this.destroyGrid();
      return super.destroy(all);
    }

    private destroyGrid(): void {
      this.gridApi?.destroy();
      this.gridApi = null;
    }

    private get properties(): Record<string, unknown> {
      const props = (this as any)['component']?.properties;
      return isRecord(props) ? props : {};
    }

    private async loadAndRenderGrid(): Promise<void> {
      const element = this.gridElement;
      if (!element) return;
      const actionUrl = String(this.properties['action_url'] ?? '').trim();
      if (!actionUrl) {
        element.textContent = 'Data Table: action_url non configurato';
        return;
      }
      if (!apiServiceRef) {
        element.textContent = 'Data Table: servizio API non disponibile';
        return;
      }
      try {
        const response = await apiServiceRef.postActionPath(actionUrl, {});
        if (this.gridElement !== element) return; // component was re-attached/destroyed meanwhile
        console.log('[ozon_data_table] raw response for', actionUrl, response);
        const content = isRecord(response) && isRecord((response as any)['content'])
          ? (response as any)['content'] as Record<string, unknown>
          : (response as Record<string, unknown>);

        const rows = this.extractRows(response as Record<string, unknown>, content);
        const backendColumns = this.extractColumns(content);
        const allowList = splitCsvList(this.properties['list_metadata_show']);
        const fields = allowList.length
          ? allowList
          : Object.keys(backendColumns).length
            ? Object.keys(backendColumns)
            : Object.keys(rows[0] ?? {});
        const columnDefs: ColDef[] = fields.map(field => ({
          field,
          headerName: backendColumns[field] || field
        }));
        console.log('[ozon_data_table] resolved', { rowCount: rows.length, columnDefs });
        const gridOptions: GridOptions = {
          theme: 'legacy',
          columnDefs,
          rowData: rows,
          domLayout: 'autoHeight',
          suppressCellFocus: true,
          overlayNoRowsTemplate: '<span>Nessuna riga (vedi console per la risposta grezza)</span>'
        };
        this.destroyGrid();
        this.gridApi = createGrid(element, gridOptions);
      } catch (error) {
        if (this.gridElement !== element) return;
        element.textContent = 'Data Table: errore caricamento dati';
        console.error('[ozon_data_table] failed to load action', actionUrl, error);
      }
    }

    /** Tries the shapes seen across Ozon action responses and the legacy DataTables server-side contract. */
    private extractRows(response: Record<string, unknown>, content: Record<string, unknown>): Record<string, unknown>[] {
      const candidates: unknown[] = [
        content['data'],
        content['rows'],
        content['records'],
        content['items'],
        content['list'],
        response['data'],
        response['rows']
      ];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
      }
      return [];
    }

    private extractColumns(content: Record<string, unknown>): Record<string, string> {
      for (const key of ['columns', 'header', 'headers', 'fields']) {
        const candidate = content[key];
        if (isRecord(candidate)) return candidate as Record<string, string>;
        if (Array.isArray(candidate)) {
          return Object.fromEntries(candidate.map(field => [String(field), String(field)]));
        }
      }
      return {};
    }
  }

  Formio.registerComponent(COMPONENT_TYPE, OzonDataTableFormioComponent as any);
  registered = true;
}

export function isOzonDataTableComponentType(type: unknown): boolean {
  return String(type ?? '').trim().toLowerCase() === COMPONENT_TYPE;
}
