import { Formio } from '@formio/js';
import type { Content, OnChangeStatus, createJSONEditor } from 'vanilla-jsoneditor';

type VanillaJsonEditor = ReturnType<typeof createJSONEditor>;

const COMPONENT_TYPE = 'ozonjsoneditor';
let registered = false;

export function installOzonJsonEditorFormioComponent(): void {
  if (registered) return;
  const components = (Formio as unknown as { Components?: { components?: Record<string, any> } }).Components?.components;
  const TextAreaComponent = components?.['textarea'];
  if (!TextAreaComponent) return;

  class OzonJsonEditorFormioComponent extends TextAreaComponent {
    static schema(...extend: Record<string, unknown>[]) {
      return TextAreaComponent.schema({
        type: COMPONENT_TYPE,
        label: 'JSON Editor',
        key: 'jsonEditor',
        input: true,
        tableView: false,
        rows: 12
      }, ...extend);
    }

    static get builderInfo() {
      return {
        title: 'JSON Editor',
        group: 'advanced',
        icon: 'code',
        weight: 80,
        schema: OzonJsonEditorFormioComponent.schema()
      };
    }

    private ozonJsonEditors: Array<VanillaJsonEditor | null> = [];
    private ozonJsonEditorReady: Array<Promise<void> | null> = [];

    renderElement(_value: unknown, index: number): string {
      const self = this as any;
      const disabled = self['disabled'] || self['options']?.readOnly ? ' data-readonly="true"' : '';
      return `
        <div
          ${self['_referenceAttributeName']}="input"
          class="ozon-formio-json-editor"
          data-index="${index}"
          ${disabled}
        ></div>
      `;
    }

    attachElement(element: HTMLElement, index: number): HTMLElement {
      this.createJsonEditor(element, index);
      return element;
    }

    setValueAt(index: number, value: unknown, flags: Record<string, unknown> = {}): void {
      super.setValueAt(index, value, flags);
      void this.ozonJsonEditorReady[index]?.then(() => {
        if (flags['fromOzonJsonEditor']) return;
        this.ozonJsonEditors[index]?.set(this.contentFromValue(value));
      });
    }

    detach(): void {
      this.destroyJsonEditors();
      return super.detach();
    }

    destroy(all?: boolean): void {
      this.destroyJsonEditors();
      return super.destroy(all);
    }

    private createJsonEditor(element: HTMLElement, index: number): void {
      this.ozonJsonEditors[index]?.destroy();
      this.ozonJsonEditors[index] = null;
      this.ozonJsonEditorReady[index] = import('vanilla-jsoneditor').then(({ createJSONEditor, Mode }) => {
        const editor = createJSONEditor({
          target: element,
          props: {
            content: this.contentFromValue(this.getIndexedValue(index)),
            mode: Mode.tree,
            indentation: 2,
            tabSize: 2,
            mainMenuBar: true,
            navigationBar: true,
            statusBar: true,
            readOnly: Boolean((this as any)['disabled'] || (this as any)['options']?.readOnly),
            askToFormat: true,
            onChange: (updatedContent: Content, _previousContent: Content, status: OnChangeStatus) => {
              if (status.contentErrors) return;
              const nextValue = this.valueFromContent(updatedContent);
              (this as any)['updateValue'](nextValue, {
                modified: true,
                fromOzonJsonEditor: true
              }, index);
            }
          }
        });
        this.ozonJsonEditors[index] = editor;
      });
    }

    private getIndexedValue(index: number): unknown {
      const self = this as any;
      const value = self['dataValue'];
      return self['component']?.multiple && Array.isArray(value) ? value[index] : value;
    }

    private contentFromValue(value: unknown): Content {
      if (value == null || value === '') return { json: {} };
      if (typeof value !== 'string') return { json: value };
      const raw = value.trim();
      if (!raw) return { json: {} };
      try {
        return { json: JSON.parse(raw) };
      } catch {
        return { text: value };
      }
    }

    private valueFromContent(content: Content): string {
      if ('text' in content) {
        const raw = String(content.text ?? '');
        JSON.parse(raw);
        return raw;
      }
      return JSON.stringify(content.json, null, 2);
    }

    private destroyJsonEditors(): void {
      this.ozonJsonEditors.forEach(editor => editor?.destroy());
      this.ozonJsonEditors = [];
      this.ozonJsonEditorReady = [];
    }
  }

  Formio.registerComponent(COMPONENT_TYPE, OzonJsonEditorFormioComponent as any);
  registered = true;
}

export function isOzonJsonEditorComponentType(type: unknown): boolean {
  return String(type ?? '').trim().toLowerCase() === COMPONENT_TYPE;
}
