import { ApplicationRef, ComponentRef, EnvironmentInjector, Injector, createComponent } from '@angular/core';
import { Formio } from '@formio/js';
import jsonLogic from 'json-logic-js';
import { OzonEmbeddedListComponent } from './ozon-embedded-list.component';

const COMPONENT_TYPE = 'ozon_data_table';
let registered = false;
let environmentInjectorRef: EnvironmentInjector | null = null;
let applicationRefRef: ApplicationRef | null = null;
let elementInjectorRef: Injector | null = null;

/**
 * Wires Angular's environment injector/app ref into the module, once Angular DI is up (main.ts
 * runs before it). `elementInjector` must be AppComponent's own node injector, not just the root
 * environment injector: AppFormioRendererService (used by the embedded list) is registered in
 * AppComponent's `providers` array, not `providedIn: 'root'`, so only that node injector can
 * resolve it.
 */
export function setOzonDataTableAngularRefs(environmentInjector: EnvironmentInjector, applicationRef: ApplicationRef, elementInjector: Injector): void {
  environmentInjectorRef = environmentInjector;
  applicationRefRef = applicationRef;
  elementInjectorRef = elementInjector;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Mirrors AppTableManagerService.parsePythonStyleQuery - the well's static properties.query and
 * the "query=<jsonlogic>" logic-action value are both Python-dict literals (single quotes,
 * True/False/None), not JSON. */
function parseWellPythonStyleQuery(queryStr: string): Record<string, unknown> | null {
  if (!queryStr.trim()) return null;
  try {
    const jsonStr = queryStr
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');
    const parsed = JSON.parse(jsonStr);
    return isRecord(parsed) && Object.keys(parsed).length ? parsed : null;
  } catch { return null; }
}

/** Mirrors AppTableManagerService.evaluateFormioQueryAction - the search_area well's `logic`
 * encodes its dynamic query as a "value" action whose string is "query=<jsonlogic-expr>". */
function evaluateWellQueryAction(action: Record<string, unknown>, context: unknown): Record<string, unknown> | null {
  if (String(action['type'] ?? '').trim().toLowerCase() !== 'value') return null;
  const value = action['value'];
  if (typeof value !== 'string') return null;
  const eqIdx = value.indexOf('=');
  if (eqIdx < 1) return null;
  if (value.slice(0, eqIdx).trim() !== 'query') return null;
  let logicExpr: unknown;
  try { logicExpr = JSON.parse(value.slice(eqIdx + 1).trim()); } catch { return null; }
  let evaluated: unknown;
  try { evaluated = jsonLogic.apply(logicExpr as any, context); } catch { return null; }
  if (typeof evaluated === 'string') return parseWellPythonStyleQuery(evaluated.trim());
  return isRecord(evaluated) && Object.keys(evaluated).length ? evaluated : null;
}

function evaluateWellLogicTrigger(trigger: Record<string, unknown>, context: unknown): boolean {
  if (String(trigger['type'] ?? '').trim().toLowerCase() !== 'json') return false;
  const json = trigger['json'];
  if (json == null) return true;
  try { return Boolean(jsonLogic.apply(json as any, context)); } catch { return false; }
}

/** Resolves the default scoping query a paired search_area well carries (e.g. "only rows whose
 * groups include this record's rec_name"), evaluating its logic the same way the main list view
 * does - so a well that only ever worked (or only ever silently no-op'd) there behaves identically
 * here, rather than a second, possibly-diverging reimplementation. */
function resolveWellQuerySeed(well: Record<string, unknown>, context: unknown): Record<string, unknown> | null {
  const properties = isRecord(well['properties']) ? well['properties'] : {};
  const staticQuery = typeof properties['query'] === 'string' ? parseWellPythonStyleQuery(properties['query']) : null;
  const logicArray = Array.isArray(well['logic']) ? well['logic'] : [];
  for (const logicItem of logicArray) {
    if (!isRecord(logicItem)) continue;
    const trigger = isRecord(logicItem['trigger']) ? logicItem['trigger'] : null;
    if (trigger && !evaluateWellLogicTrigger(trigger, context)) continue;
    const actions = Array.isArray(logicItem['actions']) ? logicItem['actions'] : [];
    for (const action of actions) {
      if (!isRecord(action)) continue;
      const result = evaluateWellQueryAction(action, context);
      if (result !== null) return result;
    }
  }
  return staticQuery;
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

    private componentRef: ComponentRef<OzonEmbeddedListComponent> | null = null;
    private hostElement: HTMLElement | null = null;

    renderElement(_value: unknown, index: number): string {
      const self = this as any;
      return `
        <div
          ${self['_referenceAttributeName']}="input"
          class="ozon-data-table-grid"
          data-index="${index}"
        ></div>
      `;
    }

    attachElement(element: HTMLElement, _index: number): HTMLElement {
      this.hostElement = element;
      this.mountEmbeddedList(element);
      return element;
    }

    detach(): void {
      this.destroyEmbeddedList();
      return super.detach();
    }

    destroy(all?: boolean): void {
      this.destroyEmbeddedList();
      return super.destroy(all);
    }

    private destroyEmbeddedList(): void {
      if (this.componentRef) {
        this.applicationRef?.detachView(this.componentRef.hostView);
        this.componentRef.destroy();
        this.componentRef = null;
      }
    }

    private get properties(): Record<string, unknown> {
      const props = (this as any)['component']?.properties;
      return isRecord(props) ? props : {};
    }

    private get applicationRef(): ApplicationRef | null {
      return applicationRefRef;
    }

    /** action_url historically held a full path (legacy DataTables ajax URL); the bare name is what /action/{name} needs. */
    private resolveActionName(): string {
      const explicit = String(this.properties['action_name'] ?? '').trim();
      if (explicit) return explicit;
      const url = String(this.properties['action_url'] ?? '').trim();
      return url.replace(/^\/?action\//, '').replace(/^\//, '');
    }

    /** Finds the sibling search_area well paired to this table via properties.object_id. */
    private findSearchAreaWell(): Record<string, unknown> | null {
      const self = this as any;
      const root = self.root;
      const ownKey = String(self.key ?? '').trim();
      if (!ownKey || !root || typeof root.everyComponent !== 'function') return null;
      let found: Record<string, unknown> | null = null;
      root.everyComponent((comp: any) => {
        if (found) return;
        const props = isRecord(comp?.component?.properties) ? comp.component.properties : {};
        if (String(props['object_id'] ?? '').trim() === ownKey) found = comp.component;
      });
      return found;
    }

    /** Resolves the default scoping query the well's logic carries, against the current form's
     * submission data. */
    private resolveBaseQuery(well: Record<string, unknown> | null): Record<string, unknown> | null {
      if (!well) return null;
      const root = (this as any).root;
      const submissionData = isRecord(root?.submission?.data) ? root.submission.data : {};
      return resolveWellQuerySeed(well, { form: submissionData, data: submissionData });
    }

    /** Whether the well is visible per the form design. AppFormioRendererService always forces
     * the well's own `hidden` to true before Formio ever builds it (it's replaced by this table's
     * own filter UI, so it would otherwise show as an empty box) - stashing the design's original
     * flag under `properties.__ozon_design_hidden` before doing so, since that forced value would
     * otherwise be the only thing left to read here. */
    private resolveFilterVisible(well: Record<string, unknown> | null): boolean {
      if (!well) return true;
      const props = isRecord(well['properties']) ? well['properties'] : {};
      return !props['__ozon_design_hidden'];
    }

    private mountEmbeddedList(element: HTMLElement): void {
      const actionName = this.resolveActionName();
      if (!actionName) {
        element.textContent = 'Data Table: action_url non configurato';
        return;
      }
      if (!environmentInjectorRef || !applicationRefRef || !elementInjectorRef) {
        element.textContent = 'Data Table: servizio non disponibile';
        return;
      }
      this.destroyEmbeddedList();
      try {
        const ref = createComponent(OzonEmbeddedListComponent, {
          environmentInjector: environmentInjectorRef,
          elementInjector: elementInjectorRef ?? undefined,
          hostElement: element
        });
        ref.instance.actionName = actionName;
        ref.instance.orderDefault = String(this.properties['order'] ?? '').trim();
        ref.instance.model = String(this.properties['model'] ?? '').trim();
        ref.instance.openInModal = String(this.properties['modal'] ?? '').trim().toLowerCase() === 'y';
        const well = this.findSearchAreaWell();
        ref.instance.baseQuery = this.resolveBaseQuery(well);
        ref.instance.filterVisible = this.resolveFilterVisible(well);
        applicationRefRef.attachView(ref.hostView);
        ref.changeDetectorRef.detectChanges();
        this.componentRef = ref;
      } catch (error) {
        element.textContent = 'Data Table: errore montaggio componente';
        console.error('[ozon_data_table] mount failed:', error);
      }
    }
  }

  Formio.registerComponent(COMPONENT_TYPE, OzonDataTableFormioComponent as any);
  registered = true;
}

export function isOzonDataTableComponentType(type: unknown): boolean {
  return String(type ?? '').trim().toLowerCase() === COMPONENT_TYPE;
}
