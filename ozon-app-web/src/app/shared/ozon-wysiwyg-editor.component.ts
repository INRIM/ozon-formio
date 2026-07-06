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
import Quill from 'quill';

@Component({
  selector: 'app-ozon-wysiwyg-editor',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ozon-wysiwyg-editor">
      <label class="control-label" [attr.for]="editorId">{{ label }}</label>
      <div #editorHost class="ozon-wysiwyg-host" [attr.id]="editorId"></div>
      <small>{{ hint }}</small>
    </div>
  `,
  styles: [`
    .ozon-wysiwyg-host {
      background: #fff;
      border-bottom-left-radius: 4px;
      border-bottom-right-radius: 4px;
    }

    :host-context(:root[data-theme='dark']) .ozon-wysiwyg-host {
      background: #fff;
      color: #17324d;
    }
  `]
})
export class OzonWysiwygEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() label = '';
  @Input() value = '';
  @Input() hint = '';
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('editorHost', { static: true }) private editorHost?: ElementRef<HTMLDivElement>;

  readonly editorId = `ozon-wysiwyg-editor-${Math.random().toString(36).slice(2)}`;
  private editor?: Quill;
  private lastEditorValue = '';
  private destroyed = false;

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    const target = this.editorHost?.nativeElement;
    if (!target || this.destroyed) return;
    this.zone.runOutsideAngular(() => {
      this.editor = new Quill(target, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            ['clean']
          ]
        }
      });
      this.lastEditorValue = String(this.value ?? '');
      this.editor.clipboard.dangerouslyPasteHTML(this.lastEditorValue);
      this.editor.on('text-change', () => {
        const nextValue = this.editor?.root.innerHTML ?? '';
        if (nextValue === this.lastEditorValue) return;
        this.lastEditorValue = nextValue;
        this.zone.run(() => this.valueChange.emit(nextValue));
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value'] || !this.editor) return;
    const nextValue = String(this.value ?? '');
    if (nextValue === this.lastEditorValue) return;
    this.lastEditorValue = nextValue;
    this.editor.clipboard.dangerouslyPasteHTML(nextValue);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.editor = undefined;
  }
}
