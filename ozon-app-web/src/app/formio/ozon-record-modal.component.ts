import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output,
  Renderer2, SimpleChanges, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormioComponent, FormioModule } from '@formio/angular';
import { AppActionManagerService } from '../managers/app-action-manager.service';
import { AppManagerService } from '../managers/app-manager.service';

/**
 * Opens a single record's own form in a modal on top of the current page, for ozon_data_table
 * instances configured with properties.modal === 'y'. Loads/saves through
 * AppActionManagerService's explicit-args, read-only-state methods (loadRecordForModal /
 * saveRecordForModal) rather than the app-wide navigation path, so it never touches the shared
 * viewMode/selectedModel/tableManager state the main list->form flow depends on.
 */
@Component({
  selector: 'app-ozon-record-modal',
  standalone: true,
  imports: [CommonModule, FormioModule],
  templateUrl: './ozon-record-modal.component.html',
  styleUrl: './ozon-record-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OzonRecordModalComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() model = '';
  @Input() actionName = '';
  @Input() recName = '';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  @ViewChild('formioViewer') formioViewer?: FormioComponent;

  schema: Record<string, unknown> | null = null;
  submission: { data: Record<string, unknown> } | null = null;
  title = '';
  loading = false;
  saving = false;
  statusText = '';
  statusError = false;

  private submitActionPath = '';
  private resolvedModel = '';
  private currentData: Record<string, unknown> = {};

  constructor(
    private readonly actionManager: AppActionManagerService,
    private readonly appManager: AppManagerService,
    private readonly cdr: ChangeDetectorRef,
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly renderer: Renderer2
  ) {}

  get renderOptions(): Record<string, unknown> {
    return this.appManager.formioRenderOptions;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['recName'] && this.recName) void this.load();
  }

  ngAfterViewInit(): void {
    // This component renders wherever ozon_data_table happened to place <app-ozon-record-modal>
    // in the DOM - nested inside the parent record's own form, which sits inside Formio/Bootstrap
    // Italia containers that set their own background and, in at least one case observed, a CSS
    // stacking context (transform/overflow) that traps position:fixed descendants instead of
    // letting them cover the viewport. Re-parenting to <body> escapes both: the modal now paints
    // on top of everything using its own background, at the intended full-viewport z-index.
    this.renderer.appendChild(document.body, this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.elementRef.nativeElement.remove();
  }

  onFormChange(event: unknown): void {
    const eventRecord = this.asRecord(event);
    const submissionRecord = eventRecord ? this.asRecord(eventRecord['submission']) : null;
    const data = submissionRecord ? this.asRecord(submissionRecord['data']) : (eventRecord ? this.asRecord(eventRecord['data']) : null);
    if (data) this.currentData = { ...this.currentData, ...data };
  }

  async save(): Promise<void> {
    if (this.saving || this.loading) return;
    if (!this.isFormValid()) {
      this.statusText = 'Compila i campi obbligatori prima di salvare';
      this.statusError = true;
      this.cdr.markForCheck();
      return;
    }
    this.saving = true;
    this.cdr.markForCheck();
    const result = await this.actionManager.saveRecordForModal(
      this.resolvedModel || this.model, this.recName, this.submitActionPath, this.currentData
    );
    this.saving = false;
    this.statusText = result.message;
    this.statusError = !result.success;
    this.cdr.markForCheck();
    if (result.success) this.saved.emit();
  }

  close(): void {
    this.closed.emit();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.statusText = '';
    this.statusError = false;
    this.schema = null;
    this.cdr.markForCheck();
    try {
      const result = await this.actionManager.loadRecordForModal(this.actionName, this.recName);
      if (!result) throw new Error('Impossibile caricare il record');
      this.schema = result.schema;
      this.submission = result.submission;
      this.currentData = { ...result.submission.data };
      this.submitActionPath = result.submitActionPath;
      this.resolvedModel = result.model;
      this.title = result.title;
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : String(error);
      this.statusError = true;
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private isFormValid(): boolean {
    const formio = this.formioViewer?.formio as unknown as {
      validate?: (data: unknown, opts: unknown) => unknown;
      checkValidity?: (data: unknown, dirty: boolean, row: unknown) => boolean;
    } | undefined;
    if (!formio) return true;
    if (typeof formio.validate === 'function') {
      const errors = formio.validate(this.currentData, { dirty: true, silentCheck: false, process: 'submit' });
      return Array.isArray(errors) ? errors.length === 0 : true;
    }
    return typeof formio.checkValidity === 'function' ? formio.checkValidity(this.currentData, true, null) : true;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }
}
