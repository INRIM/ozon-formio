import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { OzonFormBuilder } from './ozon-form-builder';

@Component({
  selector: 'ozon-form-builder-host',
  standalone: true,
  template: '<div #builderHost></div>'
})
export class OzonFormBuilderHostComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() form?: unknown;
  @Input() options?: Record<string, unknown>;
  @Input() builderClass: typeof OzonFormBuilder = OzonFormBuilder;
  @Input() rebuild?: Observable<Record<string, unknown>>;
  @Output() change = new EventEmitter<unknown>();

  @ViewChild('builderHost', { static: true }) builderHost?: ElementRef<HTMLElement>;

  builder: OzonFormBuilder | null = null;
  instance: any = null;
  ready: Promise<unknown>;

  private readyResolve: (value: unknown) => void = () => undefined;
  private rebuildSubscription?: Subscription;
  private viewReady = false;
  private componentAdding = false;

  constructor(private readonly ngZone: NgZone) {
    this.ready = this.makeReadyPromise();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.bindRebuildStream();
    void this.rebuildBuilder();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rebuild'] && this.viewReady) {
      this.bindRebuildStream();
    }
    if (!this.viewReady) return;

    if (changes['form'] || changes['builderClass'] || (changes['options'] && !this.rebuild)) {
      void this.rebuildBuilder();
    }
  }

  ngOnDestroy(): void {
    this.rebuildSubscription?.unsubscribe();
    void this.destroyBuilder();
  }

  private bindRebuildStream(): void {
    this.rebuildSubscription?.unsubscribe();
    if (!this.rebuild) return;

    this.rebuildSubscription = this.rebuild.subscribe((nextOptions) => {
      if (nextOptions) {
        this.options = nextOptions;
      }
      void this.rebuildBuilder(nextOptions);
    });
  }

  private async rebuildBuilder(overrideOptions?: Record<string, unknown>): Promise<void> {
    const host = this.builderHost?.nativeElement;
    if (!host) return;

    await this.destroyBuilder();
    this.ready = this.makeReadyPromise();
    this.componentAdding = false;
    host.innerHTML = '';

    const BuilderClass = this.builderClass ?? OzonFormBuilder;
    const form = this.cloneForm(this.form);
    const options = this.cloneOptions(overrideOptions ?? this.options);

    await this.ngZone.runOutsideAngular(async () => {
      const builder = new BuilderClass(host, form as any, options as any);
      this.builder = builder;
      const instance = await builder.ready;
      this.attachInstance(instance);
    });
  }

  private attachInstance(instance: any): void {
    this.instance = instance;
    instance.off?.('addComponent');
    instance.off?.('saveComponent');
    instance.off?.('updateComponent');
    instance.off?.('removeComponent');

    instance.on?.('addComponent', (component: unknown, parent: unknown, path: unknown, index: unknown, isNew: boolean) => {
      this.ngZone.run(() => {
        if (isNew) {
          this.componentAdding = true;
          return;
        }

        this.change.emit({
          type: 'addComponent',
          builder: instance,
          form: instance.schema,
          component,
          parent,
          path,
          index
        });
        this.componentAdding = false;
      });
    });

    instance.on?.('saveComponent', (component: unknown, original: unknown, parent: unknown, path: unknown, index: unknown, isNew: boolean) => {
      this.ngZone.run(() => {
        this.change.emit({
          type: this.componentAdding ? 'addComponent' : 'saveComponent',
          builder: instance,
          form: instance.schema,
          component,
          originalComponent: original,
          parent,
          path,
          index,
          isNew: isNew || false
        });
        this.componentAdding = false;
      });
    });

    instance.on?.('updateComponent', (component: unknown) => {
      this.ngZone.run(() => {
        this.change.emit({
          type: 'updateComponent',
          builder: instance,
          form: instance.schema,
          component
        });
      });
    });

    instance.on?.('removeComponent', (component: unknown, parent: unknown, path: unknown, index: unknown) => {
      this.ngZone.run(() => {
        this.change.emit({
          type: 'deleteComponent',
          builder: instance,
          form: instance.schema,
          component,
          parent,
          path,
          index
        });
      });
    });

    this.ngZone.run(() => {
      this.readyResolve(instance);
    });
  }

  /** Returns the current live schema from the active builder instance, or null if not ready. */
  getLiveSchema(): Record<string, unknown> | null {
    const s: unknown = this.instance?.schema;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s as Record<string, unknown>;
  }

  private async destroyBuilder(): Promise<void> {
    try {
      if (typeof this.instance?.destroy === 'function') {
        await Promise.resolve(this.instance.destroy(true));
      }
      else if (typeof this.builder?.destroy === 'function') {
        await Promise.resolve(this.builder.destroy(true));
      }
    } catch {
      // Ignore builder teardown failures and continue with a clean host element.
    } finally {
      this.instance = null;
      this.builder = null;
    }
  }

  private cloneForm(form: unknown): Record<string, unknown> {
    const next = this.isRecord(form) ? this.cloneRecord(form) : { display: 'form', components: [] };
    if (!Array.isArray(next['components'])) {
      next['components'] = [];
    }
    if (typeof next['display'] !== 'string' || !String(next['display']).trim()) {
      next['display'] = 'form';
    }
    return next;
  }

  private cloneOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
    return options ? this.cloneRecord(options) : {};
  }

  private cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
    return typeof structuredClone === 'function'
      ? structuredClone(record)
      : JSON.parse(JSON.stringify(record));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private makeReadyPromise(): Promise<unknown> {
    return new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }
}
