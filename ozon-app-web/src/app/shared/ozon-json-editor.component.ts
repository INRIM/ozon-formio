import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Content, OnChangeStatus, createJSONEditor } from 'vanilla-jsoneditor';

type VanillaJsonEditor = ReturnType<typeof createJSONEditor>;

@Component({
  selector: 'app-ozon-json-editor',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ozon-json-editor-field">
      <label class="control-label" [attr.for]="editorId">{{ label }}</label>
      <div
        #editorHost
        class="ozon-json-editor-host"
        [class.is-invalid]="invalid"
        [attr.id]="editorId"
      ></div>
      <small>{{ hint }}</small>
    </div>
  `,
  styles: [`
    .ozon-json-editor-host {
      height: 20rem;
      min-height: 16rem;
      border: 1px solid var(--ozon-border);
      border-radius: 4px;
      overflow: hidden;
      background: #fff;
    }

    .ozon-json-editor-host.is-invalid {
      border-color: #dc3545;
    }

    :host-context(:root[data-theme='dark']) .ozon-json-editor-host {
      background: #fff;
      color: #17324d;
    }
  `]
})
export class OzonJsonEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() label = '';
  @Input() value = '';
  @Input() hint = 'Lista JSON delle regole';
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('editorHost', { static: true }) private editorHost?: ElementRef<HTMLDivElement>;

  readonly editorId = `ozon-json-editor-${Math.random().toString(36).slice(2)}`;
  invalid = false;
  private editor?: VanillaJsonEditor;
  private lastEditorValue = '';
  private destroyed = false;

  constructor(private readonly zone: NgZone) {}

  async ngAfterViewInit(): Promise<void> {
    const target = this.editorHost?.nativeElement;
    if (!target) return;
    const content = this.contentFromValue(this.value);
    this.lastEditorValue = this.valueFromContent(content);
    const { createJSONEditor, Mode } = await import('vanilla-jsoneditor');
    if (this.destroyed) return;
    this.zone.runOutsideAngular(() => {
      this.editor = createJSONEditor({
        target,
        props: {
          content,
          mode: Mode.tree,
          indentation: 2,
          tabSize: 2,
          mainMenuBar: true,
          navigationBar: true,
          statusBar: true,
          askToFormat: true,
          onChange: (updatedContent: Content, _previousContent: Content, status: OnChangeStatus) => {
            const nextValue = this.valueFromContent(updatedContent);
            this.zone.run(() => {
              this.invalid = Boolean(status.contentErrors);
              if (this.invalid || nextValue === this.lastEditorValue) return;
              this.lastEditorValue = nextValue;
              this.valueChange.emit(nextValue);
            });
          }
        }
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value'] || !this.editor) return;
    const nextValue = String(this.value ?? '');
    if (nextValue === this.lastEditorValue) return;
    const content = this.contentFromValue(nextValue);
    this.lastEditorValue = this.valueFromContent(content);
    this.invalid = false;
    this.editor.set(content);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.editor?.destroy();
    this.editor = undefined;
  }

  private contentFromValue(value: unknown): Content {
    const raw = String(value ?? '').trim();
    if (!raw) return { json: [] };
    try {
      return { json: JSON.parse(raw) };
    } catch {
      this.invalid = true;
      return { text: String(value ?? '') };
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
}
