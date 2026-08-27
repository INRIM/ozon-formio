import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EMPTY } from 'rxjs';
import { AppComponent } from './app.component';
import { OzonApiService } from './core/ozon-api.service';
import { MainManagerService } from './core/main-manager.service';
import { BackendAuthService } from './core/backend-auth.service';
import { ListRequestPayload, requireResponseObject, ResponseObject, ResponseObjectData } from './models/ozon.types';
import { GlobalErrorStateService } from './core/global-error-state.service';
import { RecordListComponent } from './list/record-list.component';

const makeResponse = (content: Partial<ResponseObjectData>, fail = false, message = ''): ResponseObject => ({
  content: {
    mode: 'action',
    data: {},
    readable: true,
    editable: true,
    can_create: true,
    model: '',
    query: {},
    obfucated_fields: [],
    editable_fields: [],
    schema: null,
    rec_name: '',
    fields: {},
    columns: {},
    filter_kyes: {},
    batch_size: 0,
    total_count: 0,
    context_actions: [],
    title: '',
    next_action_url: '',
    ...content
  },
  fail,
  message
});

const runtimeConfig = {
  backendUrl: '',
  siteUrl: '',
  allowedOrigins: [] as string[],
  useProxy: true,
  sessionCacheTtlMs: 30000,
  authMode: 'none' as const,
  authLoginPath: '/login',
  authLogoutPath: '/logout',
  authRefreshPath: '/refresh',
  appCode: '',
  appModuleName: 'Mci Service',
  appLogoUrl: 'https://www.inrim.it/sites/default/files/2022-04/logoinrimhp%20%281%29.svg'
};

describe('AppComponent', () => {
  let apiMock: jasmine.SpyObj<OzonApiService>;
  let mainManagerMock: jasmine.SpyObj<MainManagerService>;
  let backendAuthMock: jasmine.SpyObj<BackendAuthService>;
  let globalErrorState: GlobalErrorStateService;

  beforeEach(async () => {
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getRuntimeConfig',
      'updateRuntimeConfig',
      'getModels',
      'getSession',
      'getActionLayout',
      'getActionMenu',
      'getActionDashboard',
      'getAction',
      'getNextAction',
      'getExportData',
      'getSchemaModel',
      'getResourceData',
      'postAction',
      'deleteAction',
      'getRecordSchema',
      'getRecord',
      'updateRecord',
      'importData',
      'postActionPath',
      'getRemoteSelect',
      'storeSearchQuery',
      'persistFastSearchSession',
      'streamList',
      'filterFastSearch'
    ]);
    apiMock.getRuntimeConfig.and.returnValue({ ...runtimeConfig });
    apiMock.updateRuntimeConfig.and.callFake((patch) => ({ ...runtimeConfig, ...patch }));
    apiMock.getModels.and.resolveTo([]);
    apiMock.getSession.and.resolveTo([]);
    apiMock.getActionLayout.and.resolveTo(makeResponse({ mode: 'layout', data: { layout: 'standard', schema: {}, menu: [] } }));
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: [] }));
    apiMock.getActionDashboard.and.resolveTo(makeResponse({ mode: 'card', data: [] }));
    apiMock.getAction.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.getNextAction.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.getExportData.and.resolveTo({ content: { data: [] } });
    apiMock.getSchemaModel.and.resolveTo({ fields: ['rec_name'], schema: { properties: { rec_name: { type: 'string' } } } });
    apiMock.getResourceData.and.resolveTo({ content: { data: [] } });
    apiMock.postAction.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.deleteAction.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: null }));
    apiMock.getRecord.and.resolveTo(makeResponse({ mode: 'form', data: { rec_name: 'r1' } }));
    apiMock.updateRecord.and.resolveTo(makeResponse({ mode: 'form', data: { rec_name: 'r1' } }));
    apiMock.importData.and.resolveTo({ status: 'done', ok: 0 });
    apiMock.postActionPath.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.getRemoteSelect.and.resolveTo([]);
    apiMock.storeSearchQuery.and.resolveTo({ link: '#' });
    apiMock.persistFastSearchSession.and.resolveTo({ content: { data: {} } });
    apiMock.streamList.and.resolveTo({
      result: {
        count: 0,
        totalCount: 0,
        contentType: 'application/x-ndjson',
        order: '',
        skip: '0',
        limit: '20',
        columnsRaw: '',
        columns: null
      },
      payloadLabel: 'default',
      retries: 0
    });
    apiMock.filterFastSearch.and.resolveTo({
      count: 0,
      totalCount: 0,
      contentType: 'application/x-ndjson',
      order: '',
      skip: '0',
      limit: '20',
      columnsRaw: '',
      columns: null
    });
    (apiMock as any).unauthorized$ = EMPTY;
    mainManagerMock = jasmine.createSpyObj<MainManagerService>('MainManagerService', [
      'hardReloadToUrl'
    ]);
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: false,
      blocked: false,
      targetUrl: ''
    });
    backendAuthMock = jasmine.createSpyObj<BackendAuthService>('BackendAuthService', [
      'bootstrap',
      'logout',
      'getLoginUrl',
      'isEnabled',
      'consumeSessionPayload'
    ]);
    backendAuthMock.bootstrap.and.resolveTo({
      authenticated: false,
      loginRequired: false,
      redirectUrl: '',
      remoteUser: '',
      refreshed: false,
      serverError: false
    });
    backendAuthMock.logout.and.returnValue({
      authenticated: false,
      loginRequired: false,
      redirectUrl: '/api/logout',
      remoteUser: '',
      refreshed: false,
      serverError: false
    });
    backendAuthMock.getLoginUrl.and.returnValue('/api/login');
    backendAuthMock.isEnabled.and.returnValue(false);
    backendAuthMock.consumeSessionPayload.and.returnValue(null);

    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.style.colorScheme = '';

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: OzonApiService, useValue: apiMock },
        { provide: MainManagerService, useValue: mainManagerMock },
        { provide: BackendAuthService, useValue: backendAuthMock }
      ]
    }).compileComponents();

    globalErrorState = TestBed.inject(GlobalErrorStateService);
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the home nav button with the Bootstrap Italia PA icon', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    app.appManager.backendSessionReady = true;
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.ozon-home-btn img') as HTMLImageElement | null;
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toBe('bootstrap-italia/src/svg/it-pa.svg');
  });

  it('should adapt the home nav PA icon for dark theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    app.appManager.backendSessionReady = true;
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.ozon-home-btn img') as HTMLImageElement;
    expect(getComputedStyle(icon).filter).toContain('invert');
  });

  it('should keep primary buttons readable in light theme', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.confirmModalVisible = true;
    fixture.detectChanges();

    const primary = fixture.nativeElement.querySelector('.modal .btn-primary') as HTMLButtonElement | null;
    expect(primary).not.toBeNull();
    expect(getComputedStyle(primary as HTMLButtonElement).color).toBe('rgb(255, 255, 255)');
  });

  it('should initialize theme from local storage', () => {
    window.localStorage.setItem('ozon-app-web.theme', 'dark');

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.ngOnInit();

    expect(app.theme.themeMode).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('should toggle theme and persist selection', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    app.onThemeSwitchChanged(true);
    expect(app.theme.themeMode).toBe('dark');
    expect(window.localStorage.getItem('ozon-app-web.theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    app.onThemeSwitchChanged(false);
    expect(app.theme.themeMode).toBe('light');
    expect(window.localStorage.getItem('ozon-app-web.theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should use the global loader for import lifecycle events', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    spyOn(app.actionManager, 'beginExternalTransition').and.callThrough();
    spyOn(app.actionManager, 'endExternalTransition').and.callThrough();

    app.onImportBusyChange(true);
    expect(app.actionManager.beginExternalTransition).toHaveBeenCalledTimes(1);
    expect(app.isTransitionLoading).toBeTrue();

    app.onImportBusyChange(false);
    expect(app.actionManager.endExternalTransition).toHaveBeenCalledTimes(1);
    expect(app.isTransitionLoading).toBeFalse();
  });

  it('should reload the current list after import finishes', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.viewMode = 'list';
    app.appManager.selectedModel = 'demo.model';
    spyOn(app.actionManager, 'loadRecords').and.resolveTo();

    app.onImportFinished();
    await Promise.resolve();

    expect(app.actionManager.loadRecords).toHaveBeenCalledOnceWith(true);
  });

  it('should render a global client error banner and dismiss it', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    globalErrorState.report('Client exploded', 'stack trace');

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Errore client.');
    expect(fixture.nativeElement.textContent).toContain('Client exploded');

    app.dismissFatalClientError();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Client exploded');
  });

  it('should clear fatal client error state and request a reload', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    globalErrorState.report('Client exploded', 'stack trace');
    spyOn(app, 'reloadWindow').and.stub();

    app.reloadAfterFatalClientError();

    expect(globalErrorState.visible).toBeFalse();
    expect(app.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it('should bootstrap backend auth when keycloak mode is enabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    apiMock.getRuntimeConfig.and.returnValue({ ...runtimeConfig, authMode: 'keycloak' });
    backendAuthMock.bootstrap.and.resolveTo({
      authenticated: true,
      loginRequired: false,
      redirectUrl: '',
      remoteUser: 'alice',
      refreshed: true,
      serverError: false
    });

    app.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(backendAuthMock.bootstrap).toHaveBeenCalled();
  });

  it('should redirect to backend login endpoint in keycloak mode', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.authMode = 'keycloak';

    app.login();

    expect(backendAuthMock.getLoginUrl).toHaveBeenCalled();
    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith('/api/login');
  });

  it('should load models without a static token when keycloak mode is enabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.authMode = 'keycloak';
    apiMock.getModels.and.resolveTo(['res.partner']);

    await app.actionManager.loadModels();

    expect(apiMock.getModels).toHaveBeenCalled();
    expect(app.models).toEqual(['res.partner']);
  });

  it('should hydrate remote select values from component properties via backend endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'country',
          properties: {
            url: 'https://remote.example/api/countries',
            path_value: 'data.items',
            header_key: 'X-Token',
            header_value_key: 'REMOTE_TOKEN'
          }
        }
      ]
    }}));
    apiMock.getRemoteSelect.and.resolveTo([
      { label: 'Italia', value: 'IT' },
      { label: 'Francia', value: 'FR' }
    ]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';

    await app.actionManager.loadSchema();
    expect(apiMock.getRemoteSelect).not.toHaveBeenCalled();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    expect(apiMock.getRemoteSelect).toHaveBeenCalledWith(
      jasmine.objectContaining({
        key: '',
        curr_model: '',
        data: jasmine.objectContaining({
          url: 'https://remote.example/api/countries',
          pathValue: 'data.items',
          headerKey: 'X-Token',
          headerValueKey: 'REMOTE_TOKEN'
        }),
        properties: {}
      })
    );

    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const selectComponent = components[0];
    expect(selectComponent['dataSrc']).toBe('values');
    expect((selectComponent['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Italia', value: 'IT', data: jasmine.objectContaining({ label: 'Italia', value: 'IT' }) }),
      jasmine.objectContaining({ label: 'Francia', value: 'FR', data: jasmine.objectContaining({ label: 'Francia', value: 'FR' }) })
    ]);
  });

  it('should keep the form placeholder visible while the form viewer is mounting', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.viewMode = 'form';
    app.renderer.formViewerLoading = true;
    app.renderer.formSchema = { display: 'form', components: [] };

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ozon-form-placeholder')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('formio')).not.toBeNull();
  });

  it('should preserve inline dataSrc values options without calling remote select endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: [
      {
        type: 'select',
        key: 'status',
        dataSrc: 'values',
        data: {
          values: [
            { label: 'Attivo', value: 'active' },
            { label: 'Inattivo', value: 'inactive' }
          ]
        }
      }
    ]}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';

    await app.actionManager.loadSchema();

    expect(apiMock.getRemoteSelect).not.toHaveBeenCalled();
    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const select = components[0];
    expect(select['dataSrc']).toBe('values');
    expect((select['data'] as Record<string, unknown>)['values']).toEqual([
      { label: 'Attivo', value: 'active' },
      { label: 'Inattivo', value: 'inactive' }
    ]);
  });

  it('should cache remote select options and avoid duplicate requests between schema and record load', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'country',
          properties: {
            url: 'https://remote.example/api/countries'
          }
        }
      ]
    }}));
    apiMock.getRecord.and.resolveTo(makeResponse({ mode: 'form', data: {
      rec_name: 'r1',
      country: 'IT'
    }}));
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Italia', value: 'IT' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';

    await app.actionManager.loadSchema();
    app.tableManager.selectedRecordName = 'r1';
    await app.actionManager.openSelectedRecord();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    expect(apiMock.getRemoteSelect.calls.count()).toBe(1);
  });

  it('should send canonical internal RemoteSelectRequest payload for formio source', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'customer_id',
          idPath: 'rec_name',
          properties: {
            src: 'url',
            model: 'customer',
            domain: { active: true },
            compute_label: 'name'
          }
        }
      ]
    }}));
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Mario Rossi', value: 'CUS-1' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'ordine';

    await app.actionManager.loadSchema();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    expect(apiMock.getRemoteSelect).toHaveBeenCalledWith(
      jasmine.objectContaining({
        key: 'customer_id',
        curr_model: 'ordine',
        data: {},
        properties: jasmine.objectContaining({
          src: 'url',
          model: 'customer',
          domain: { active: true },
          compute_label: 'name',
          label: 'customer_id',
          id: 'rec_name'
        })
      })
    );
  });

  it('should hydrate resource select values from streamed list endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'partner_id',
          idPath: 'rec_name',
          dataSrc: 'resource',
          data: {
            resource: 'res.partner'
          }
        }
      ]
    }}));
    apiMock.streamList.and.callFake(async (model: string, payload: ListRequestPayload, onItem: (item: unknown) => void) => {
      expect(model).toBe('res.partner');
      expect(payload).toEqual(jasmine.objectContaining({
        query: {},
        skip: 0,
        limit: 1000,
        order: 'rec_name asc'
      }));
      onItem({ _id: '1', rec_name: 'Partner A' });
      onItem({ _id: '2', rec_name: 'Partner B' });
      return {
        result: {
          count: 2,
          totalCount: 2,
          contentType: 'application/x-ndjson',
          order: '',
          skip: '0',
          limit: '1000',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'ordine';

    await app.actionManager.loadSchema();
    expect(apiMock.streamList).not.toHaveBeenCalled();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    expect(apiMock.streamList).toHaveBeenCalledTimes(1);
    expect(apiMock.streamList.calls.mostRecent().args[4]).toEqual({ stream: false });
    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const selectComponent = components[0];
    expect(selectComponent['dataSrc']).toBe('values');
    expect((selectComponent['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Partner A', value: 'Partner A', rec_name: 'Partner A', data: jasmine.objectContaining({ _id: '1', rec_name: 'Partner A' }) }),
      jasmine.objectContaining({ label: 'Partner B', value: 'Partner B', rec_name: 'Partner B', data: jasmine.objectContaining({ _id: '2', rec_name: 'Partner B' }) })
    ]);
  });

  it('should map remote select backend kv payload to label/value options', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'fornitore',
          properties: {
            url: 'https://remote.example/api/vendors'
          }
        }
      ]
    }}));
    apiMock.getRemoteSelect.and.resolveTo({
      content: {
        mode: 'list',
        data: [
          { k: 'SUP-1', v: 'Fornitore A' },
          { k: 'SUP-2', v: 'Fornitore B' }
        ]
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'ordine';

    await app.actionManager.loadSchema();
    expect(apiMock.getRemoteSelect).not.toHaveBeenCalled();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const selectComponent = components[0];
    expect((selectComponent['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Fornitore A', value: 'SUP-1', data: jasmine.objectContaining({ k: 'SUP-1', v: 'Fornitore A' }) }),
      jasmine.objectContaining({ label: 'Fornitore B', value: 'SUP-2', data: jasmine.objectContaining({ k: 'SUP-2', v: 'Fornitore B' }) })
    ]);
  });

  it('should preserve data_value payload for resource select templates', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'user_id',
          idPath: 'rec_name',
          dataSrc: 'resource',
          data: {
            resource: 'auth.user'
          }
        }
      ]
    }}));
    apiMock.streamList.and.callFake(async (_model: string, _payload: ListRequestPayload, onItem: (item: unknown) => void) => {
      onItem({
        _id: '69f48d7c1eaec1bc77c2fcae',
        rec_name: 'a.gerace',
        data_value: {
          _id: '69f59c48ebe70a3ba8c0ea7b',
          rec_name: 'a.gerace'
        }
      });
      return {
        result: {
          count: 1,
          totalCount: 1,
          contentType: 'application/x-ndjson',
          order: '',
          skip: '0',
          limit: '1000',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'ordine';

    await app.actionManager.loadSchema();
    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const selectComponent = components[0];
    expect((selectComponent['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({
        label: 'a.gerace',
        value: 'a.gerace',
        rec_name: 'a.gerace',
        data: jasmine.objectContaining({
          rec_name: 'a.gerace',
          data_value: jasmine.objectContaining({ rec_name: 'a.gerace' })
        })
      })
    ]);
  });

  it('should defer record form remote select hydration until the viewer ready event', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'country',
          properties: {
            model: 'country',
            src: 'url'
          }
        }
      ]
    }}));
    apiMock.getRecord.and.resolveTo(makeResponse({ mode: 'form', data: {
      rec_name: 'REC-1',
      country: 'IT'
    }}));
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Italia', value: 'IT' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';
    app.tableManager.selectedRecordName = 'REC-1';

    await app.actionManager.openSelectedRecord();

    expect(apiMock.getRemoteSelect).not.toHaveBeenCalled();

    await app.onFormViewerReady();
    await app.renderer.pendingHydrationPromise;

    expect(apiMock.getRemoteSelect).toHaveBeenCalledTimes(1);
    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    expect((components[0]['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Italia', value: 'IT', data: jasmine.objectContaining({ label: 'Italia', value: 'IT' }) })
    ]);
  });

  it('should build header menu groups from dynamic action menu payload', async () => {
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: [
      {
        Main: [
          { label: 'Apri Anagrafica', content: '/action/open_anagrafica', action_type: 'window', icon: 'pi pi-folder' }
        ]
      }
    ]}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionMenu();

    expect(app.appManager.dashboardMenu.length).toBe(1);
    expect(app.appManager.dashboardMenu[0].title).toBe('Main');
    expect(app.appManager.dashboardMenu[0].group_id).toBe('Main');
    expect(app.appManager.dashboardMenu[0].buttons[0].url_action).toBe('/action/open_anagrafica');
  });

  it('should group flat menu payload by menu_group', async () => {
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: [
      { menu_group: 'Config', label: 'Utenti', url_action: '/action/list_utenti', action_type: 'window' },
      { menu_group: 'Config', label: 'Ruoli', url_action: '/action/list_ruoli', action_type: 'window' },
      { menu_group: 'Documenti', label: 'Ordini', url_action: '/action/list_ordini', action_type: 'window' }
    ]}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionMenu();

    expect(app.appManager.dashboardMenu.length).toBe(2);
    const configGroup = app.appManager.dashboardMenu.find((entry) => entry.group_id === 'Config');
    expect(configGroup).toBeTruthy();
    expect(configGroup?.buttons.length).toBe(2);
    expect(configGroup?.buttons.map(button => button.url_action)).toEqual([
      '/action/list_utenti',
      '/action/list_ruoli'
    ]);
  });

  it('should build top menu drill-down by parent and group actions by menu_group', async () => {
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: [
      { parent: 'Admin', menu_group: 'Config', label: 'Utenti', url_action: '/action/list_utenti', action_type: 'window' },
      { parent: 'Admin', menu_group: 'Config', label: 'Ruoli', url_action: '/action/list_ruoli', action_type: 'window' },
      { parent: 'Admin', menu_group: 'Documenti', label: 'Ordini', url_action: '/action/list_ordini', action_type: 'window' }
    ]}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionMenu();

    expect(app.appManager.dashboardMenu.length).toBe(1);
    expect(app.appManager.dashboardMenu[0].group_id).toBe('Admin');
    const drillDownGroups = app.menuDrilldownGroups(app.appManager.dashboardMenu[0]);
    expect(drillDownGroups.length).toBe(2);
    expect(drillDownGroups.map(group => group.group_id)).toEqual(['Config', 'Documenti']);
    expect(drillDownGroups[0].buttons.length).toBe(2);
  });

  it('should keep top menu parent toggle-only and run url_action on children from object payload', async () => {
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: {
      Design: [
        { key: 'design', label: 'Design', action_type: 'menu', url_action: '' },
        { key: 'list_form', label: 'Form', action_type: 'menu', url_action: 'list_form' },
        { key: 'list_resource', label: 'Resource', action_type: 'menu', url_action: '/action/list_resource' },
        { key: 'list_layout', label: 'Layout', action_type: 'menu', url_action: '/action/list_layout' }
      ]
    }}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionMenu();
    app.appManager.builderEnabled = true;
    const originalPath = window.location.pathname;

    try {
      expect(app.appManager.dashboardMenu.length).toBe(1);
      expect(app.appManager.dashboardMenu[0].group_id).toBe('Design');

      app.openTopMenu(app.appManager.dashboardMenu[0]);
      expect(app.openedNavMenuGroup).toBe('Design');
      expect(apiMock.getAction).not.toHaveBeenCalled();

      const drillDownGroups = app.menuDrilldownGroups(app.appManager.dashboardMenu[0]);
      expect(drillDownGroups.length).toBe(1);
      expect(drillDownGroups[0].buttons.map(button => button.label)).toEqual(['Form', 'Resource', 'Layout']);
      expect(drillDownGroups[0].buttons.map(button => button.action_type)).toEqual(['window', 'window', 'window']);
      expect(drillDownGroups[0].buttons.map(button => button.url_action)).toEqual([
        '/action/list_form',
        '/action/list_resource',
        '/action/list_layout'
      ]);

      await app.actionManager.runMenuAction(drillDownGroups[0].buttons[0]);
      expect(apiMock.getAction).toHaveBeenCalledWith(
        'list_form',
        jasmine.objectContaining({ recName: '' })
      );
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should prioritize url_action over content when building action links', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const button = {
      model: 'action',
      key: 'test',
      type: 'button',
      label: 'Test',
      leftIcon: 'pi pi-list',
      authtoken: 'token',
      req_id: 'req',
      btn_action_type: false,
      action_type: 'window',
      url_action: '/action/right_path',
      content: '/action/wrong_path',
      builder: false
    };

    expect(app.menuActionHref(button)).toBe('/action/right_path');

    await app.actionManager.runMenuAction(button);
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'right_path',
      jasmine.objectContaining({ recName: '' })
    );
  });

  it('should resolve Bootstrap Italia icon href from icon id values', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    expect(app.resolveBootstrapItaliaIconSrc({ leftIcon: 'it-folder' })).toBe('bootstrap-italia/src/svg/it-folder.svg');
    expect(app.resolveBootstrapItaliaIconSrc({ leftIcon: '#it-user' })).toBe('bootstrap-italia/src/svg/it-user.svg');
    expect(app.resolveBootstrapItaliaIconSrc({ leftIcon: 'icon icon-sm it-settings' })).toBe('bootstrap-italia/src/svg/it-settings.svg');
    expect(app.resolveBootstrapItaliaIconSrc({ leftIcon: 'folder' })).toBe('bootstrap-italia/src/svg/it-folder.svg');
  });

  it('should preserve explicit Bootstrap Italia sprite references', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    expect(app.actionManager.resolveBootstrapItaliaIconHref({ leftIcon: '/bootstrap-italia/dist/svg/sprites.svg#it-search' })).toBe(
      '/bootstrap-italia/dist/svg/sprites.svg#it-search'
    );
  });

  it('should render action form route when browser path is api-prefixed', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/api/action/form_form_doc_bene_servizi/ORDINE63423');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_doc_bene_servizi',
      jasmine.objectContaining({ recName: 'ORDINE63423' })
    );
  });

  it('should perform hard reload on action route 307 redirect', async () => {
    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/form_form_doc_bene_servizi/ORDINE132873'
    }));
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: '/action/form_form_doc_bene_servizi/ORDINE132873'
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      await app.actionManager["runActionRoute"]('/action/list_doc_beni_servizi/ORDINE132873');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith('/action/form_form_doc_bene_servizi/ORDINE132873');
    expect(apiMock.getAction.calls.count()).toBe(1);
  });

  it('should navigate to redirected action path when action response contains redirect', async () => {
    apiMock.getAction.and.callFake((name: string) => {
      if (name === 'list_doc_beni_servizi') {
        return Promise.resolve(makeResponse({
          mode: 'redirect',
          next_action_url: '/action/form_form_doc_bene_servizi/ORDINE132873'
        }));
      }

      if (name === 'form_form_doc_bene_servizi') {
        return Promise.resolve(makeResponse({
          mode: 'form',
          model: 'doc_bene_servizi',
          rec_name: 'ORDINE132873',
          data: {
            rec_name: 'ORDINE132873',
            stato: 'bozza'
          },
          schema: {
            display: 'form',
            components: [
              { type: 'textfield', key: 'stato', label: 'Stato', input: true }
            ]
          }
        }));
      }

      return Promise.resolve(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      await app.actionManager["runActionRoute"]('/action/list_doc_beni_servizi/ORDINE132873');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith('/action/form_form_doc_bene_servizi/ORDINE132873');
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_doc_bene_servizi',
      jasmine.objectContaining({ recName: 'ORDINE132873' })
    );
    expect(app.viewMode).toBe('form');
  });

  it('should skip dashboard preload when initial url is an action route', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63423');
      await app.actionManager["bootstrapAppData"]();
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(apiMock.getActionLayout).toHaveBeenCalled();
    expect(apiMock.getActionDashboard).not.toHaveBeenCalled();
  });

  it('should fetch model schema when action form response has no schema on direct route', async () => {
    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'doc_bene_servizi',
      data: {
        rec_name: 'ORDINE63423',
        stato: 'bozza'
      }
    }));
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        { type: 'textfield', key: 'stato', label: 'Stato', input: true }
      ]
    }}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63423');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(apiMock.getRecordSchema).toHaveBeenCalledWith('doc_bene_servizi');
    expect(app.selectedModel).toBe('doc_bene_servizi');
    expect(app.viewMode).toBe('form');
    expect(app.formSchema).toBeTruthy();
  });

  it('should parse action form schema/data from canonical content envelope', async () => {
    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'doc_bene_servizi',
      rec_name: 'ORDINE63423',
      schema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'stato', label: 'Stato', input: true }
        ]
      },
      data: {
        rec_name: 'ORDINE63423',
        stato: 'bozza'
      }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63423');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(apiMock.getRecordSchema).not.toHaveBeenCalled();
    expect(app.viewMode).toBe('form');
    expect(app.formSchema).toBeTruthy();
    expect(app.formSubmission?.data?.stato).toBe('bozza');
    expect(app.selectedRecordName).toBe('ORDINE63423');
  });

  it('should open Design Form records in the inline builder editor', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'component',
      rec_name: 'customer_form',
      schema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'title', label: 'Titolo', input: true },
          { type: 'textfield', key: 'rec_name', label: 'Name', input: true }
        ]
      },
      data: {
        rec_name: 'customer_form',
        title: 'Customer Form',
        data_model: 'res.partner',
        formio: {
          display: 'form',
          components: [
            { type: 'textfield', key: 'name', label: 'Nome', input: true }
          ]
        }
      }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'component',
      fields: {
        action_name: 'list_design_forms',
        component_type: 'form'
      } as any,
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'customer_form' }]
    }));

    await app.onTableRowDblClick(
      { __rowid: 1, __rec_name: 'customer_form', rec_name: 'customer_form' } as any,
      new MouseEvent('dblclick')
    );

    expect(apiMock.getNextAction).toHaveBeenCalledWith('list_design_forms', 'customer_form');
    expect(app.viewMode).toBe('form');
    expect(app.selectedRecordName).toBe('customer_form');
    expect(app.builderEligibleCurrentForm).toBeTrue();
    expect(app.formEditorDesignContext).toBeTrue();
    expect(app.isFormEditorPage).toBeTrue();
    expect(app.showFormViewerShell).toBeFalse();
    expect((app.builderSchemaForm?.components as unknown[]).length).toBe(1);
  });

  it('should parse action form schema as JSON string from canonical content envelope', async () => {
    const actionResponse = makeResponse({
      mode: 'form',
      model: 'doc_bene_servizi',
      rec_name: 'ORDINE63423',
      schema: JSON.stringify({
        display: 'form',
        components: [
          { type: 'textfield', key: 'stato', label: 'Stato', input: true }
        ]
      }),
      data: {
        rec_name: 'ORDINE63423',
        stato: 'bozza'
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'form_form_doc_bene_servizi';
    app.tableManager.selectedRecordName = 'ORDINE63423';

    await app.actionManager["applyActionResponse"](actionResponse);

    expect(app.viewMode).toBe('form');
    expect(app.formSchema).toBeTruthy();
    expect(app.formSubmission?.data?.stato).toBe('bozza');
    expect(app.selectedRecordName).toBe('ORDINE63423');
  });

  it('should load form submission data from flat content.data', async () => {
    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'doc_bene_servizi',
      rec_name: 'ORDINE63424',
      schema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'document_type', label: 'Tipo Documento', input: true }
        ]
      },
      data: {
        rec_name: 'ORDINE63424',
        document_type: 'DDT_ENTRATA',
        stato: 'bozza'
      }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63424');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(app.viewMode).toBe('form');
    expect(app.formSubmission?.data?.document_type).toBe('DDT_ENTRATA');
    expect(app.formSubmission?.data?.stato).toBe('bozza');
    expect(app.selectedRecordName).toBe('ORDINE63424');
  });

  it('should request next_action on table row double click using current action and rec_name', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/form_form_list_posizione/Gov.30459'
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_posizione';
    app.appManager.viewMode = 'list';

    const row = { __rowid: 1, __rec_name: 'Gov.30459', rec_name: 'Gov.30459' };
    await app.onTableRowDblClick(row as any, new MouseEvent('dblclick'));

    expect(apiMock.getNextAction).toHaveBeenCalledWith('list_posizione', 'Gov.30459');
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_list_posizione',
      jasmine.objectContaining({ recName: 'Gov.30459' })
    );
  });

  it('should follow next_action redirect when backend returns data.next_page', async () => {
    apiMock.getAction.and.callFake((name: string) => {
      if (name === 'form_form_menu_group') {
        return Promise.resolve(makeResponse({
          mode: 'form',
          model: 'menu_group',
          rec_name: 'mail_template',
          data: {
            rec_name: 'mail_template',
            name: 'Template Mail'
          },
          schema: {
            display: 'form',
            components: [
              { type: 'textfield', key: 'name', label: 'Nome', input: true }
            ]
          }
        }));
      }
      return Promise.resolve(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    });
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      data: {
        next_page: '/action/form_form_menu_group/mail_template'
      } as any,
      next_action_url: ''
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'menu_group';
    app.appManager.viewMode = 'list';

    const row = { __rowid: 1, __rec_name: 'mail_template', rec_name: 'mail_template' };
    await app.onTableRowDblClick(row as any, new MouseEvent('dblclick'));

    expect(apiMock.getNextAction).toHaveBeenCalledWith('menu_group', 'mail_template');
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_menu_group',
      jasmine.objectContaining({ recName: 'mail_template' })
    );
    expect(app.viewMode).toBe('form');
    expect(app.selectedRecordName).toBe('mail_template');
  });

  it('should resolve next_action redirect through canonical action route even when embedded content is present', async () => {
    apiMock.getAction.and.callFake((name: string) => {
      if (name === 'form_form_list_posizione') {
        return Promise.resolve(makeResponse({
          mode: 'form',
          model: 'list_posizione',
          rec_name: 'Gov.30459',
          data: {
            rec_name: 'Gov.30459',
            stato: 'from-route'
          },
          schema: {
            display: 'form',
            components: [
              { type: 'textfield', key: 'stato', label: 'Stato', input: true }
            ]
          }
        }));
      }
      return Promise.resolve(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    });

    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/form_form_list_posizione/Gov.30459'
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      app.actionManager.currentActionName = 'list_posizione';
      await app.actionManager["runNextActionRoute"](['list_posizione', 'Gov.30459']);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_list_posizione',
      jasmine.objectContaining({ recName: 'Gov.30459' })
    );
    expect(app.viewMode).toBe('form');
    expect(app.formSubmission?.data?.rec_name).toBe('Gov.30459');
    expect(app.formSubmission?.data?.stato).toBe('from-route');
  });

  it('should perform hard reload on next_action 307 redirect', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: 'http://localhost:7999/action/form_form_list_posizione/Gov.30459'
    }));
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: 'http://localhost:7999/action/form_form_list_posizione/Gov.30459'
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_posizione';

    await app.actionManager["runNextActionRoute"](['list_posizione', 'Gov.30459']);

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith(
      'http://localhost:7999/action/form_form_list_posizione/Gov.30459'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });

  it('should not fabricate a browser form route when next_action returns direct form content without redirect', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' } as any,
      rec_name: 'component.form.demo',
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/list_component');
      app.actionManager.currentActionName = 'list_component';
      await app.actionManager["runNextActionRoute"](['list_component', 'component.form.demo']);
      expect(window.location.pathname).toBe('/action/list_component');
      expect(app.viewMode).toBe('form');
      expect(app.isFormEditorPage).toBeTrue();
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should resolve post-action redirects from data.next_page', async () => {
    apiMock.postActionPath.and.resolveTo(makeResponse({
      mode: 'redirect',
      data: {
        next_page: '/action/form_form_menu_group/mail_template'
      } as any,
      next_action_url: ''
    }));
    apiMock.getAction.and.callFake((name: string) => {
      if (name === 'form_form_menu_group') {
        return Promise.resolve(makeResponse({
          mode: 'form',
          model: 'menu_group',
          rec_name: 'mail_template',
          data: { rec_name: 'mail_template', name: 'Template Mail' },
          schema: {
            display: 'form',
            components: [
              { type: 'textfield', key: 'name', label: 'Nome', input: true }
            ]
          }
        }));
      }
      return Promise.resolve(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const button = {
      model: 'menu_group',
      key: 'open_manage',
      type: 'button',
      label: 'Gestione',
      leftIcon: 'pi pi-pencil',
      authtoken: 'token',
      req_id: 'req',
      btn_action_type: 'post',
      action_type: 'post',
      url_action: '/action/open_manage',
      builder: false,
      mode: 'form',
      content: '/action/open_manage',
      is_admin: false
    };

    app.appManager.selectedModel = 'menu_group';
    app.renderer.formSubmission = { data: { rec_name: 'mail_template' } };

    await app.actionManager.runTopMenuAction(button);

    expect(apiMock.postActionPath).toHaveBeenCalledWith('/action/open_manage', jasmine.objectContaining({ rec_name: 'mail_template' }));
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'form_form_menu_group',
      jasmine.objectContaining({ recName: 'mail_template' })
    );
    expect(app.viewMode).toBe('form');
    expect(app.selectedRecordName).toBe('mail_template');
  });

  it('should hard reload process post actions to ResponseObject next_action_url when mode is redirect', async () => {
    apiMock.postActionPath.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/list_test_request'
    }));
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: 'http://localhost:4200/action/list_test_request'
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const button = {
      model: 'test_request',
      key: 'process_complete',
      type: 'button',
      label: 'Completa Task',
      leftIcon: 'it-check-circle',
      authtoken: 'token',
      req_id: 'req',
      btn_action_type: 'post',
      action_type: 'post',
      url_action: '/gateway/camunda/complete?update_data=true',
      builder: false,
      mode: 'form',
      content: '/gateway/camunda/complete?update_data=true',
      is_admin: false,
      skip_validation: true
    };

    app.appManager.selectedModel = 'test_request';
    app.renderer.formSubmission = { data: { rec_name: 'test_request.1', process_id: 'PID-1' } };

    await app.actionManager.runTopMenuAction(button);

    expect(apiMock.postActionPath).toHaveBeenCalledWith(
      '/gateway/camunda/complete?update_data=true',
      jasmine.objectContaining({ rec_name: 'test_request.1', process_id: 'PID-1' })
    );
    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith('/action/list_test_request');
    expect(apiMock.getAction).not.toHaveBeenCalledWith('list_test_request', jasmine.anything());
  });

  it('should hard reload the current page when process redirect next_action_url is hash', async () => {
    apiMock.postActionPath.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '#'
    }));
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: 'http://localhost:4200/action/form_test_request/test_request.1'
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = `${window.location.pathname}${window.location.search}`;
    const button = {
      model: 'test_request',
      key: 'process_start',
      type: 'button',
      label: 'Avvia Processo',
      leftIcon: 'it-settings',
      authtoken: 'token',
      req_id: 'req',
      btn_action_type: 'post',
      action_type: 'post',
      url_action: '/gateway/camunda/start/Test_Process?update_data=True',
      builder: false,
      mode: 'form',
      content: '/gateway/camunda/start/Test_Process?update_data=True',
      is_admin: false,
      skip_validation: true
    };

    try {
      window.history.replaceState({}, '', '/action/form_test_request/test_request.1');
      app.appManager.selectedModel = 'test_request';
      app.renderer.formSubmission = { data: { rec_name: 'test_request.1' } };

      await app.actionManager.runTopMenuAction(button);

      expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith('/action/form_test_request/test_request.1');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should post inline Formio action buttons to the resolved url_action', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'calendar';
    const validateSpy = jasmine.createSpy('validate').and.returnValue([{ message: 'required' }]);
    app.actionManager.setFormioViewerGetter(() => ({
      formio: {
        validate: validateSpy,
        checkValidity: jasmine.createSpy('checkValidity'),
        getComponent: jasmine.createSpy('getComponent').and.returnValue({ getValue: () => undefined })
      }
    } as any));

    await app.onFormCustomEvent({
      type: 'ozonInlineAction',
      component: {
        type: 'button',
        key: 'esegui',
        label: 'esegui',
        showValidations: false,
        properties: {
          btn_action_type: 'post',
          url_action: 'url_action'
        },
        logic: [
          {
            name: 'compute delete url',
            trigger: {
              type: 'json',
              json: {
                cat: ['/client/run/calendar_tasks/', { var: 'data.rec_name' }]
              }
            },
            actions: [
              {
                name: 'update value',
                type: 'value',
                value: 'url_action'
              }
            ]
          }
        ]
      },
      data: {
        rec_name: 'TASK-1',
        tipo: 'task',
        deleted: 0
      }
    });

    expect(validateSpy).not.toHaveBeenCalled();
    expect(apiMock.postActionPath).toHaveBeenCalledWith(
      '/client/run/calendar_tasks/TASK-1',
      jasmine.objectContaining({
        rec_name: 'TASK-1',
        tipo: 'task',
        deleted: 0
      })
    );
  });

  it('should ignore next_action path hints and hard reload using canonical redirect path', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/form_form_doc_bene_servizi/ORDINE63417'
    }));
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: '/action/form_form_doc_bene_servizi/ORDINE63417'
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_doc_beni_servizi';

    await app.actionManager["runNextActionRoute"](['list_doc_beni_servizi', 'ORDINE63417']);

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith(
      '/action/form_form_doc_bene_servizi/ORDINE63417'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });

  it('should request next_action without rec_name for nuovo record', async () => {
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/fom_form_list_posizione/'
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_posizione';

    await app.openNewRecord();

    expect(apiMock.getNextAction).toHaveBeenCalledWith('list_posizione', '');
    expect(apiMock.getAction).toHaveBeenCalledWith(
      'fom_form_list_posizione',
      jasmine.objectContaining({ recName: '' })
    );
  });

  it('should block save when Formio validation returns required-field errors', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'ordine';
    app.renderer.formSubmission = { data: { rec_name: 'rec-1' } };
    const validateSpy = jasmine.createSpy('validate').and.returnValue([{ message: 'required' }]);

    await app.actionManager.saveCurrentRecord(undefined, { formio: { validate: validateSpy, checkValidity: jasmine.createSpy('checkValidity') } } as any);

    expect(validateSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ rec_name: 'rec-1' }),
      jasmine.objectContaining({ dirty: true, silentCheck: false, process: 'submit' })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(app.statusError).toBeTrue();
    expect(app.statusText).toContain('Compila i campi obbligatori');
  });

  it('should coerce blank multiple fields to arrays before saving a form', async () => {
    apiMock.updateRecord.and.resolveTo(makeResponse({ mode: 'form', data: {
      rec_name: 'ACT-1',
      delete_cascade: []
    }}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'action';
    app.renderer.formSchema = {
      components: [
        {
          type: 'select',
          key: 'delete_cascade',
          input: true,
          multiple: true
        }
      ]
    };
    app.renderer.rawFormSchema = app.renderer.formSchema;
    app.renderer.formSubmission = {
      data: {
        rec_name: 'ACT-1',
        delete_cascade: ''
      }
    };

    await app.actionManager.saveCurrentRecord();

    expect(apiMock.updateRecord).toHaveBeenCalledWith('action', 'ACT-1', jasmine.objectContaining({
      rec_name: 'ACT-1',
      delete_cascade: []
    }));
    expect(app.formSubmission.data.delete_cascade).toEqual([]);
  });

  it('should run the same post-save tail after a supervised step completes', async () => {
    // Il bottone "Fatto" di supervised_todo scrive il record passando da
    // Service.upsert come il salvataggio: deve finire dove finisce il
    // salvataggio (next_action dell'action corrente), non ri-renderizzare
    // il form.
    apiMock.postActionPath.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'ipa_request',
      rec_name: 'REQ-1',
      data: { rec_name: 'REQ-1', todo: false }
    }));
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/list_ipa_request'
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'ipa_request';
    app.actionManager.currentActionName = 'form_form_ipa_request';
    app.renderer.formSubmission = { data: { rec_name: 'REQ-1', todo: true } };

    await app.onFormCustomEvent({
      type: 'ozonInlineAction',
      component: {
        type: 'button',
        key: 'btn_admin_todo',
        label: 'Fatto',
        showValidations: false,
        properties: {
          btn_action_type: 'post',
          url_action: '/step/ipa_request/supervised_todo_dhcp'
        }
      },
      data: { rec_name: 'REQ-1', todo: true }
    });

    expect(apiMock.postActionPath).toHaveBeenCalledWith(
      '/step/ipa_request/supervised_todo_dhcp',
      jasmine.objectContaining({ rec_name: 'REQ-1' })
    );
    expect(apiMock.getNextAction).toHaveBeenCalledWith('form_form_ipa_request', 'REQ-1');
  });

  it('should honour the form submit_next_action after a supervised step instead of next_action', async () => {
    // Parita' col salvataggio anche sull'altro ramo della coda: se il form
    // dichiara una submit_next_action quella vince, e next_action non viene
    // nemmeno interrogata.
    apiMock.postActionPath.and.resolveTo(makeResponse({
      mode: 'form',
      model: 'ipa_request',
      rec_name: 'REQ-1',
      data: { rec_name: 'REQ-1', todo: false }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'ipa_request';
    app.actionManager.currentActionName = 'form_form_ipa_request';
    app.actionManager.currentFormSubmitNextActionPath = '/action/list_ipa_request';
    app.renderer.formSubmission = { data: { rec_name: 'REQ-1', todo: true } };
    const navigateSpy = spyOn(app.actionManager as any, 'navigateToPath').and.resolveTo();

    await app.onFormCustomEvent({
      type: 'ozonInlineAction',
      component: {
        type: 'button',
        key: 'btn_admin_todo',
        label: 'Fatto',
        showValidations: false,
        properties: {
          btn_action_type: 'post',
          url_action: '/step/ipa_request/supervised_todo_dhcp'
        }
      },
      data: { rec_name: 'REQ-1', todo: true }
    });

    expect(navigateSpy).toHaveBeenCalledWith('/action/list_ipa_request', true);
    expect(apiMock.getNextAction).not.toHaveBeenCalled();
  });

  it('should block post actions when Formio validation returns required-field errors', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'ordine';
    app.renderer.formSubmission = { data: { rec_name: 'rec-1' } };
    const validateSpy = jasmine.createSpy('validate').and.returnValue([{ message: 'required' }]);
    app.actionManager.setFormioViewerGetter(() => ({ formio: { validate: validateSpy, checkValidity: jasmine.createSpy('checkValidity') } } as any));

    await app.runTopMenuAction({
      model: 'ordine',
      key: 'save',
      type: 'button',
      label: 'Salva',
      leftIcon: 'pi pi-save',
      authtoken: '',
      req_id: 'req_1',
      btn_action_type: 'post',
      action_type: 'post',
      url_action: '/action/submit_nullaOstaBandiRequest',
      builder: false
    });

    expect(validateSpy).toHaveBeenCalled();
    expect(apiMock.postActionPath).not.toHaveBeenCalled();
    expect(app.statusError).toBeTrue();
    expect(app.statusText).toContain('Compila i campi obbligatori');
  });

  it('should not show Abbandona when fields.cancel_button is missing', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'ordine';
    app.actionManager.currentActionName = 'list_ordini';
    app.tableManager.selectedRecordName = 'ORD-1';
    app.renderer.formSchema = {
      display: 'form',
      no_cancel: '0',
      no_submit: '0',
      components: []
    };
    app.renderer.rawFormSchema = app.renderer.formSchema;
    app.renderer.formSubmission = { data: { rec_name: 'ORD-1' } };

    const labels = app.currentFormActionButtons.map((button: any) => button.label);

    expect(labels).toContain('Aggiorna');
    expect(labels).not.toContain('Abbandona');
  });

  it('should synthesize Abbandona when fields.cancel_button is true', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/dashboard');
      await app.actionManager.applyActionResponse(makeResponse({
        mode: 'form',
        model: 'ordine',
        fields: {
          action_name: 'new_ordine',
          cancel_button: true,
          abandon_action: 'list_ordini'
        } as any,
        data: { rec_name: 'NEW-1' },
        schema: {
          display: 'form',
          no_submit: '1',
          components: []
        },
        context_actions: []
      }));

      const abandonButton = app.currentFormActionButtons.find((button: any) => button.label === 'Abbandona');

      expect(app.currentFormActionButtons.map((button: any) => button.label)).not.toContain('Salva');
      expect(app.currentFormActionButtons.map((button: any) => button.label)).not.toContain('Aggiorna');
      expect(abandonButton).toEqual(jasmine.objectContaining({
        action_type: 'abandon',
        url_action: '/action/list_ordini'
      }));
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  [
    { name: 'editable is false', editable: false, can_create: true },
    { name: 'can_create is false', editable: true, can_create: false }
  ].forEach(permission => {
    it(`should render the form readonly and hide write actions when ${permission.name}`, async () => {
      const fixture = TestBed.createComponent(AppComponent);
      const app = fixture.componentInstance as any;

      await app.actionManager.applyActionResponse(makeResponse({
        mode: 'form',
        model: 'modulo_dati_persona',
        rec_name: 'PERSONA-1',
        editable: permission.editable,
        can_create: permission.can_create,
        fields: {
          action_name: 'form_form_modulo_dati_persona',
          submit_action: 'submit_modulo_dati_persona',
          cancel_button: true
        } as any,
        data: { rec_name: 'PERSONA-1', nome: 'Mario' },
        schema: {
          display: 'form',
          components: [{ type: 'textfield', key: 'nome', input: true }]
        },
        context_actions: []
      }));

      expect(app.actionManager.currentFormReadOnly).toBeTrue();
      expect(app.formViewerRenderOptions).toEqual(jasmine.objectContaining({ readOnly: true }));
      expect(app.currentFormActionButtons.map((button: any) => button.label)).toEqual(['Abbandona']);
    });
  });

  it('should prefer the origin action over abandon_action for Abbandona', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/list_ordini');
      await app.actionManager.applyActionResponse(makeResponse({
        mode: 'form',
        model: 'ordine',
        fields: {
          action_name: 'new_ordine',
          cancel_button: true,
          abandon_action: 'list_ordini_archivio'
        } as any,
        data: { rec_name: 'NEW-1' },
        schema: {
          display: 'form',
          no_submit: '1',
          components: []
        },
        context_actions: []
      }), undefined, { formOriginPath: '/action/list_ordini' });

      const abandonButton = app.currentFormActionButtons.find((button: any) => button.label === 'Abbandona');

      expect(abandonButton).toEqual(jasmine.objectContaining({
        action_type: 'abandon',
        url_action: '/action/list_ordini'
      }));

      await app.runTopMenuAction(abandonButton);

      expect(window.location.pathname).toBe('/action/list_ordini');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should hide Abbandona from context_actions when fields.cancel_button is false', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'ordine',
      fields: {
        action_name: 'new_ordine',
        cancel_button: false
      } as any,
      data: { rec_name: 'NEW-1' },
      schema: {
        display: 'form',
        no_submit: '1',
        components: []
      },
      context_actions: [
        {
          rec_name: 'abandon',
          action_type: 'window',
          label: 'Abbandona',
          button_icon: 'pi pi-times',
          modal: false,
          context_button_mode: ['form'],
          url_action: ''
        }
      ]
    }));

    expect(app.currentFormActionButtons.map((button: any) => button.label)).not.toContain('Abbandona');
  });

  it('should keep one save button and hide Preview/EditForm actions in the form editor', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'component';
    app.tableManager.selectedRecordName = 'FORM-1';
    app.renderer.formSchema = { display: 'form', components: [] };
    app.renderer.formSubmission = { data: { rec_name: 'FORM-1' } };
    app.actionManager.contextActions = [
      {
        rec_name: 'save',
        action_type: 'save',
        label: 'Salva',
        button_icon: 'pi pi-save',
        modal: false,
        context_button_mode: ['form'],
        url_action: '/action/save_component'
      },
      {
        rec_name: 'update',
        action_type: 'post',
        label: 'Aggiorna',
        button_icon: 'pi pi-save',
        modal: false,
        context_button_mode: ['form'],
        url_action: '/action/update_component'
      },
      {
        rec_name: 'preview',
        action_type: 'window',
        label: 'Preview',
        button_icon: 'pi pi-eye',
        modal: false,
        context_button_mode: ['form'],
        url_action: '/action/preview_component'
      },
      {
        rec_name: 'edit_form',
        action_type: 'window',
        label: 'EditForm',
        button_icon: 'pi pi-pencil',
        modal: false,
        context_button_mode: ['form'],
        url_action: '/action/edit_form_component'
      }
    ];

    const buttons = app.formEditorActionButtons;

    expect(buttons.map((button: any) => button.label)).toEqual(['Aggiorna']);
    expect(buttons[0].action_type).toBe('save');
    expect(buttons[0].url_action).toBe('');
  });

  it('should bind boolean form editor selects for sys and dashboard menu', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'component';
    app.tableManager.selectedRecordName = 'FORM-1';
    app.renderer.formSchema = { display: 'form', components: [] };
    app.renderer.formSubmission = {
      data: {
        rec_name: 'FORM-1',
        title: 'Form 1',
        sys: false,
        create_menu_dashboard: true
      }
    };
    app.builder.builderEligibleCurrentForm = true;
    app.builder.formEditorExplicitlyOpened = true;

    fixture.detectChanges();

    const sysSelect = fixture.nativeElement.querySelector('#fe-sys') as HTMLSelectElement;
    const dashboardSelect = fixture.nativeElement.querySelector('#fe-create_menu_dashboard') as HTMLSelectElement;

    expect(sysSelect.value).toBe('0');
    expect(dashboardSelect.value).toBe('1');

    app.updateFormEditorBooleanField('sys', '1');
    app.updateFormEditorBooleanField('create_menu_dashboard', '0');

    expect(app.formEditorData.sys).toBeTrue();
    expect(app.formEditorData.create_menu_dashboard).toBeFalse();
  });

  it('should expose models JSON rules fields as lightweight JSON editors in form editor settings', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'component';
    app.tableManager.selectedRecordName = 'FORM-1';
    app.renderer.formSchema = { display: 'form', components: [] };
    app.renderer.formSubmission = {
      data: {
        rec_name: 'FORM-1',
        title: 'Form 1',
        properties: {
          models_groups: [{ model: 'request', groups: ['admin'] }]
        }
      }
    };
    app.builder.builderEligibleCurrentForm = true;
    app.builder.formEditorExplicitlyOpened = true;
    app.builder.formEditorActiveTab = 'config';

    fixture.detectChanges();

    const jsonRow = fixture.nativeElement.querySelector('.ozon-models-json-row') as HTMLElement;
    const columns = jsonRow.querySelectorAll('.col-sm-6');
    const editors = jsonRow.querySelectorAll('app-ozon-json-editor');

    expect(jsonRow).not.toBeNull();
    expect(columns.length).toBe(2);
    expect(editors.length).toBe(2);
    expect(app.formEditorJsonPropertyValue('models_groups')).toContain('"model": "request"');
    expect(app.formEditorJsonPropertyInvalid('models_groups')).toBeFalse();

    app.updateFormEditorJsonProperty('models_restricted_fields', '[{"model":"request","fields":["secret"]}]');

    expect(app.formEditorProperties['models_restricted_fields']).toBe('[{"model":"request","fields":["secret"]}]');
    expect(app.formEditorJsonPropertyInvalid('models_restricted_fields')).toBeFalse();

    app.updateFormEditorJsonProperty('models_groups', '[invalid]');

    expect(app.formEditorJsonPropertyInvalid('models_groups')).toBeTrue();
  });

  it('should save the form editor payload and return to the origin list', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'component';
    app.tableManager.selectedRecordName = 'FORM-1';
    app.renderer.formSchema = { display: 'form', components: [] };
    app.renderer.rawFormSchema = app.renderer.formSchema;
    app.renderer.formSubmission = {
      data: {
        rec_name: 'FORM-1',
        title: 'Form 1',
        sys: false,
        create_menu_dashboard: true
      }
    };
    app.renderer.markFormDataReadyForBuilder();
    app.builder.formEditorDesignContext = true;
    app.actionManager.currentFormOriginPath = '/action/list_component';
    const navigateSpy = spyOn(app.actionManager as any, 'navigateToPath').and.resolveTo();

    await app.saveCurrentRecord();

    expect(apiMock.updateRecord).toHaveBeenCalledWith('component', 'FORM-1', jasmine.objectContaining({
      rec_name: 'FORM-1',
      sys: false,
      create_menu_dashboard: true
    }));
    expect(navigateSpy).toHaveBeenCalledWith('/action/list_component', true);
    expect(apiMock.postActionPath).not.toHaveBeenCalled();
  });

  it('should save the form editor payload from draft when Form.io live schema is temporarily unreadable', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'component';
    app.renderer.formSchema = { display: 'form', components: [] };
    app.renderer.rawFormSchema = app.renderer.formSchema;
    app.renderer.formSubmission = {
      data: {
        rec_name: 'FORM-NEW',
        title: 'Form new',
        sys: false,
        create_menu_dashboard: true
      }
    };
    app.renderer.markFormDataReadyForBuilder();
    app.builder.formEditorDesignContext = true;
    app.builder.builderSchemaDraft = {
      display: 'form',
      components: [
        { type: 'textfield', key: 'field_a', label: 'Field A', input: true },
        { type: 'textfield', key: 'field_b', label: 'Field B', input: true }
      ]
    };
    app.actionManager.currentFormOriginPath = '/action/list_component';
    const navigateSpy = spyOn(app.actionManager as any, 'navigateToPath').and.resolveTo();
    const activeBuilderHost = {
      getLiveSchema: () => {
        throw new TypeError(`Cannot read properties of undefined (reading 'element')`);
      }
    };

    await app.actionManager.saveCurrentRecord(activeBuilderHost as any, undefined);

    expect(apiMock.updateRecord).toHaveBeenCalledWith('component', 'FORM-NEW', jasmine.objectContaining({
      rec_name: 'FORM-NEW',
      components: [
        { type: 'textfield', key: 'field_a', label: 'Field A', input: true },
        { type: 'textfield', key: 'field_b', label: 'Field B', input: true }
      ]
    }));
    expect(navigateSpy).toHaveBeenCalledWith('/action/list_component', true);
  });

  it('should load dashboard cards only from mode card payload', async () => {
    apiMock.getActionDashboard.and.resolveTo(makeResponse({ mode: 'card', data: [
      {
        group_id: 'docs',
        title: 'Documenti',
        buttons: [
          { label: 'Lista', content: '/action/list_documenti', action_type: 'window', icon: 'pi pi-list' }
        ]
      }
    ]}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionDashboard();

    expect(app.appManager.dashboardCards.length).toBe(1);
    expect(app.nonAdminDashboardCards.length).toBe(1);
    expect(app.appManager.dashboardCards[0].title).toBe('Documenti');
  });

  it('should render dashboard cards with Bootstrap Italia service card structure', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.viewMode = 'dashboard';
    app.appManager.dashboardCards = [
      {
        model: 'ordine',
        group_id: 'docs',
        title: 'Gestione Documenti',
        menu_type: 'standard',
        is_admin: false,
        buttons: [{
          model: 'ordine',
          key: 'list',
          type: 'button',
          label: 'Lista',
          leftIcon: 'it-list',
          req_id: 'req',
          btn_action_type: false,
          action_type: 'window',
          url_action: '/action/list_docs',
          builder: false
        }]
      }
    ];

    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.ozon-dashboard-card') as HTMLElement;
    expect(card.classList).toContain('it-card');
    expect(card.classList).toContain('it-card-height-full');
    expect(card.querySelector('h4.it-card-title a')?.textContent?.trim()).toBe('Gestione Documenti');
    expect(card.querySelector('.it-card-body .it-card-related')).not.toBeNull();
    expect(card.querySelector('.it-card-footer .list-item')?.textContent?.trim()).toContain('Lista');
  });

  it('should show cards only for non-admin menus and hide the header menu in builder mode', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.appManager.dashboardMenu = [
      {
        model: 'component',
        group_id: 'design',
        title: 'Design',
        menu_type: 'admin',
        is_admin: true,
        buttons: [{ key: 'd', label: 'Design', action_type: 'window', url_action: '/action/design', builder: true, type: 'button' }]
      },
      {
        model: 'ordine',
        group_id: 'docs',
        title: 'Gestione Documenti',
        menu_type: 'standard',
        is_admin: false,
        buttons: [{ key: 'l', label: 'Lista', action_type: 'window', url_action: '/action/list_docs', builder: false, type: 'button' }]
      }
    ];
    app.appManager.dashboardCards = [
      {
        model: 'component',
        group_id: 'design',
        title: 'Design',
        menu_type: 'admin',
        is_admin: true,
        buttons: [{ key: 'd', label: 'Design', action_type: 'window', url_action: '/action/design', builder: true, type: 'button' }]
      },
      {
        model: 'ordine',
        group_id: 'docs',
        title: 'Gestione Documenti',
        menu_type: 'standard',
        is_admin: false,
        buttons: [{ key: 'l', label: 'Lista', action_type: 'window', url_action: '/action/list_docs', builder: false, type: 'button' }]
      }
    ];

    expect(app.nonAdminDashboardCards.length).toBe(1);
    expect(app.topMenuCards.length).toBe(1);

    app.onBuilderSwitchChanged(true);
    expect(app.topMenuCards.length).toBe(2);
    expect(app.nonAdminDashboardCards.length).toBe(1);
  });

  it('should show top menu only when builder toggle is enabled', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.appManager.backendSessionReady = true;
    app.appManager.builderEnabled = false;
    app.appManager.dashboardMenu = [{
      model: 'ordine',
      group_id: 'docs',
      title: 'Documenti',
      menu_type: 'standard',
      is_admin: false,
      buttons: [{ key: 'list', label: 'Lista', action_type: 'window', url_action: '/action/list_docs', builder: false, type: 'button' }]
    }];
    fixture.detectChanges();

    expect(app.showTopMenu).toBeFalse();
    expect(fixture.nativeElement.querySelector('.it-header-navbar-wrapper .ozon-home-btn')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.it-header-navbar-wrapper .menu-wrapper > .navbar-nav:not(.navbar-secondary) > .nav-item.dropdown').length).toBe(0);

    app.onBuilderSwitchChanged(true);
    fixture.detectChanges();
    expect(app.showTopMenu).toBeTrue();
    expect(fixture.nativeElement.querySelector('.it-header-navbar-wrapper .ozon-home-btn')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.it-header-navbar-wrapper .menu-wrapper > .navbar-nav:not(.navbar-secondary) > .nav-item.dropdown').length).toBe(1);
  });

  it('should hide placeholder-only menu cards and avoid empty group labels', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.dashboardMenu = [
      {
        model: 'placeholder',
        group_id: 'group_0',
        title: 'Group 0',
        buttons: [{ key: 'action_0', label: 'Action 0', action_type: 'window', url_action: '/', builder: false, type: 'button' }]
      }
    ];

    expect(app.topMenuCards.length).toBe(0);
    expect(app.menuDrilldownGroups(app.appManager.dashboardMenu[0])).toEqual([]);
  });

  it('should keep table row copy/remove hidden by default', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.showTableRowCopyAction).toBeFalse();
    expect(app.showTableRowRemoveAction).toBeFalse();
    expect(app.tableExtraColumnCount).toBe(2);
  });

  it('should show table row copy/remove only when list is in-form and actions are enabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      fields: {
        in_form: true,
        enable_copy: true,
        enable_remove: false
      },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    }));

    expect(app.showTableRowCopyAction).toBeTrue();
    expect(app.showTableRowRemoveAction).toBeFalse();
    expect(app.tableExtraColumnCount).toBe(3);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      fields: {
        in_form: true,
        enable_copy: true,
        enable_remove: true
      },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    }));

    expect(app.showTableRowCopyAction).toBeTrue();
    expect(app.showTableRowRemoveAction).toBeTrue();
    expect(app.tableExtraColumnCount).toBe(4);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      fields: {
        in_form: false,
        enable_copy: true,
        enable_remove: true
      },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    }));

    expect(app.showTableRowCopyAction).toBeFalse();
    expect(app.showTableRowRemoveAction).toBeFalse();
    expect(app.tableExtraColumnCount).toBe(2);
  });

  it('should enable table row copy/remove when action urls are provided in table config', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      fields: {
        in_form: true,
        table_action: {
          copy_url: '/action/copy_documento',
          remove_url: '/action/remove_documento'
        }
      },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    }));

    expect(app.showTableRowCopyAction).toBeTrue();
    expect(app.showTableRowRemoveAction).toBeTrue();
    expect(app.tableManager.tableCopyActionPath).toBe('/action/copy_documento');
    expect(app.tableManager.tableRemoveActionPath).toBe('/action/remove_documento');
  });

  it('should execute configured server-side row copy action when copy_url is present', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.tableManager.tableCalledInsideForm = true;
    app.tableManager.tableCopyEnabled = true;
    app.tableManager.tableCopyActionPath = '/action/copy_documento';
    const navigateSpy = spyOn(app.actionManager as any, 'navigateToPath').and.resolveTo();
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

    await app.onCopyRow({ __rowid: 1, __rec_name: 'rec-1' }, event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/action/copy_documento/rec-1');
  });

  it('should execute configured server-side row remove action and skip local removal', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.tableManager.tableCalledInsideForm = true;
    app.tableManager.tableRemoveEnabled = true;
    app.tableManager.tableRemoveActionPath = '/action/remove_documento';
    app.tableManager.allRows = [{ __rowid: 1, __rec_name: 'rec-1' }];
    app.tableManager.tableRows = [...app.tableManager.allRows];
    app.tableManager.tableTotalRecords = 1;
    const navigateSpy = spyOn(app.actionManager as any, 'navigateToPath').and.resolveTo();
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

    await app.onRemoveRow(app.tableManager.allRows[0], event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/action/remove_documento/rec-1');
    expect(app.tableManager.allRows.length).toBe(1);
    expect(app.tableManager.tableTotalRecords).toBe(1);
  });

  it('should refresh dependent select options when a watched field changes', async () => {
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Vendor 1', value: 'V1' }]);
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.selectedModel = 'ordine';
    app.renderer.selectedModel = 'ordine';
    app.renderer.formSchema = {
      display: 'form',
      components: [
        {
          type: 'select',
          key: 'cliente',
          data: { values: [{ label: 'Cliente A', value: 'A' }, { label: 'Cliente B', value: 'B' }] }
        },
        {
          type: 'select',
          key: 'fornitore',
          properties: { src: 'url', model: 'fornitore', onChangeFields: 'cliente' }
        }
      ]
    };
    app.renderer.formSubmission = { data: { cliente: 'A', fornitore: 'OLD' } };

    await app.onFormSubmissionChanged({
      data: { cliente: 'B', fornitore: 'OLD' },
      changed: { component: { key: 'cliente' } }
    });

    expect(apiMock.getRemoteSelect).toHaveBeenCalledWith(
      jasmine.objectContaining({
        key: 'fornitore',
        curr_model: 'ordine',
        properties: jasmine.objectContaining({
          src: 'url',
          model: 'fornitore'
        })
      })
    );
    expect(app.formSubmission.data.fornitore).toBeNull();
    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const targetSelect = components.find(component => component['key'] === 'fornitore') as Record<string, unknown>;
    expect(targetSelect['dataSrc']).toBe('values');
    expect((targetSelect['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Vendor 1', value: 'V1', data: jasmine.objectContaining({ label: 'Vendor 1', value: 'V1' }) })
    ]);
  });

  it('should keep existing submission fields when form change event is partial', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.renderer.formSchema = {
      display: 'form',
      components: [
        { type: 'textfield', key: 'cliente' },
        { type: 'textfield', key: 'descrizione' },
        { type: 'textfield', key: 'totale' }
      ]
    };
    app.renderer.formSubmission = {
      data: {
        cliente: 'A',
        descrizione: 'Ordine di prova',
        totale: 99
      }
    };

    await app.onFormSubmissionChanged({
      data: { cliente: 'B' },
      changed: { component: { key: 'cliente' } }
    });

    expect(app.formSubmission.data).toEqual(jasmine.objectContaining({
      cliente: 'B',
      descrizione: 'Ordine di prova',
      totale: 99
    }));
  });

  it('should seed list query from well.search_area query when action response provides it', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }],
      schema: {
        display: 'form',
        components: [
          {
            type: 'well',
            key: 'search_main',
            properties: {
              type: 'search_area',
              query: { stato: 'APERTO' }
            }
          }
        ]
      }
    }));

    const query = app.tableManager.parseQueryInput((_m: string, _e: boolean) => {});
    expect(query).toEqual({ stato: 'APERTO' });
  });

  it('should reconstruct import and export tools from list permissions when toolbar schema is absent', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_component';

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'component',
      can_create: true,
      editable: true,
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    }));

    expect(app.tableManager.listExportConfig.visible).toBeTrue();
    expect(app.tableManager.listExportConfig.model).toBe('component');
    expect(app.tableManager.listImportConfig.visible).toBeTrue();
    expect(app.tableManager.listImportConfig.model).toBe('component');
    expect(app.tableManager.listSearchSessionContext).toEqual(jasmine.objectContaining({
      dataModel: 'component',
      searchModel: 'component',
      actionName: 'list_component'
    }));
  });

  it('should not remove row when table remove action is not enabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.tableManager.tableCalledInsideForm = false;
    app.tableManager.tableRemoveEnabled = true;
    app.tableManager.allRows = [
      { __rowid: 1, __rec_name: 'rec-1' },
      { __rowid: 2, __rec_name: 'rec-2' }
    ];
    app.tableManager.tableRows = [...app.tableManager.allRows];
    app.tableManager.tableTotalRecords = 2;

    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;
    await app.onRemoveRow(app.tableManager.allRows[0], event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(app.tableManager.allRows.length).toBe(2);
    expect(app.tableManager.tableTotalRecords).toBe(2);
    expect(app.statusError).toBeTrue();
  });

  it('should keep session.name in user slot and not override it with layout username', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          user: {
            full_name: 'Mario Rossi',
            user_type: 'admin'
          },
          app: {
            builder: true
          }
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();
    app.appManager.applyLayoutResponse(
      makeResponse({ mode: 'layout', data: { layout: 'standard', schema: {}, menu: [], settings: { user: 'admin' } } }).content,
      (_d: unknown) => [],
      (s: Record<string, unknown>) => ({ ...s }),
      []
    );

    expect(app.appManager.currentUserName).toBe('Mario Rossi');
  });

  it('should keep runtime app logo when layout settings do not provide one', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    app.appManager.applyRuntime(apiMock.getRuntimeConfig());
    app.appManager.applyLayoutResponse(
      makeResponse({ mode: 'layout', data: { layout: 'standard', schema: {}, menu: [], settings: {} } }).content,
      (_d: unknown) => [],
      (s: Record<string, unknown>) => ({ ...s }),
      []
    );

    expect(app.appManager.appLogoUrl).toBe(runtimeConfig.appLogoUrl);
  });

  it('should expose session user and admin flag in Formio evalContext for component jsonLogic', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          is_admin: true,
          user: {
            full_name: 'Mario Rossi',
            user: {
              uid: 'mrossi',
              divisione_code: 'SIR',
              allowed_users: ['mrossi', 'admin']
            }
          }
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();

    expect(app.formioRenderOptions).toEqual(jasmine.objectContaining({
      evalContext: jasmine.objectContaining({
        is_admin: true,
        user: jasmine.objectContaining({
          uid: 'mrossi',
          divisione_code: 'SIR',
          allowed_users: ['mrossi', 'admin'],
          is_admin: true
        }),
        session: jasmine.objectContaining({
          is_admin: true,
          user: jasmine.objectContaining({
            full_name: 'Mario Rossi',
            user: jasmine.objectContaining({
              uid: 'mrossi',
              divisione_code: 'SIR'
            })
          })
        })
      })
    }));
  });

  it('should use locale and timezone from session when rendering datetime table cells', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          locale: 'en-US',
          tz: 'America/New_York'
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    await app.appManager.loadSession();
    app.tableManager.sessionLocale = app.appManager.sessionLocale;
    app.tableManager.sessionTimezone = app.appManager.sessionTimezone;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record', created_at: 'Creato il' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'datetime',
            key: 'created_at',
            format: 'yyyy-MM-dd HH:mm'
          }
        ]
      },
      data: [
        {
          rec_name: 'ORD-5',
          created_at: '2025-01-15T14:30:00Z'
        }
      ]
    }));

    const expected = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York'
    }).format(new Date('2025-01-15T14:30:00Z'));

    expect(app.displayCell(app.tableRows[0], 'created_at')).toBe(expected);
  });

  it('should fallback to locale it when session locale is missing', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          tz: 'Europe/Rome'
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    await app.appManager.loadSession();

    expect(app.appManager.sessionLocale).toBe('it');
    expect(app.appManager.sessionTimezone).toBe('Europe/Rome');
  });

  it('should resolve username from nested session.user when session.name is missing', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          user: {
            full_name: 'Giulia Verdi',
            user_type: 'admin'
          }
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();

    expect(app.appManager.currentUserName).toBe('Giulia Verdi');
  });

  it('should use session user_data avatar_url before the current avatar fallback', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          user: {
            avatar: '/avatar/fallback.png',
            user_data: {
              uid: 'mrossi',
              avatar_url: '/avatar/mario.png'
            }
          }
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();
    expect(app.appManager.userAvatarUrl).toBe('/avatar/mario.png');

    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          user: {
            avatar: '/avatar/fallback.png',
            user_data: {
              uid: 'mrossi'
            }
          }
        }
      }
    });

    await app.appManager.loadSession();

    expect(app.appManager.userAvatarUrl).toBe('/avatar/mario.png');
  });

  it('should enable builder toggle for admin users from session.is_admin', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          is_admin: true
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();

    expect(app.isAdminUser).toBeTrue();
    expect(app.showBuilderToggle).toBeTrue();
  });

  it('should enable builder toggle for tech users from session.is_tech', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          is_admin: false,
          is_tech: true
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();
    app.onBuilderSwitchChanged(true);

    expect(app.isAdminUser).toBeFalse();
    expect(app.isTechUser).toBeTrue();
    expect(app.showBuilderToggle).toBeTrue();
    expect(app.builderEnabled).toBeTrue();
  });

  it('should hide builder toggle when session.is_admin is false', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          is_admin: false,
          is_tech: false,
          user: {
            user_type: 'admin'
          }
        }
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.appManager.loadSession();

    expect(app.isAdminUser).toBeFalse();
    expect(app.showBuilderToggle).toBeFalse();
  });

  it('should disable admin/builder action when builder flag is off', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    const adminButton = {
      key: 'design',
      label: 'Design',
      type: 'button',
      action_type: 'window',
      url_action: '/action/design',
      content: '/action/design',
      builder: true,
      is_admin: true
    };

    app.appManager.builderEnabled = false;
    expect(app.canRunMenuAction(adminButton)).toBeFalse();

    app.onBuilderSwitchChanged(true);
    expect(app.canRunMenuAction(adminButton)).toBeTrue();
  });

  it('should open design form actions in the dedicated form editor context', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.builderEnabled = true;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    }));

    expect(app.formEditorDesignContext).toBeTrue();
    expect(app.isFormEditorPage).toBeTrue();
    expect(app.builderMode).toBeFalse();
    expect(app.showFormBuilder).toBeFalse();
    expect(app.builderSchemaForm).toEqual(jasmine.objectContaining({ display: 'form', components: [] }));
  });

  it('should enter builder mode only after explicit user action', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.builderEnabled = true;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    }));

    app.enableFormBuilderMode();

    expect(app.builderMode).toBeTrue();
    expect(app.showFormBuilder).toBeTrue();
  });

  it('should keep builder mode active across subsequent form loads once enabled', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.onBuilderSwitchChanged(true);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    }));

    app.enableFormBuilderMode();
    expect(app.builderMode).toBeTrue();

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo.2' },
      schema: { display: 'form', components: [] }
    }));

    expect(app.builderMode).toBeTrue();
    expect(app.showFormBuilder).toBeTrue();
  });

  it('should execute list window context actions via url_action and keep ordinary form actions out of builder mode', async () => {
    apiMock.getAction.and.callFake(async (name: string) => {
      if (name === 'new_action') {
        return makeResponse({
          mode: 'form',
          model: 'action',
          rec_name: '',
          readable: true,
          editable: true,
          can_create: true,
          data: {},
          schema: {
            display: 'form',
            components: [
              { type: 'textfield', key: 'label', input: true }
            ]
          },
          fields: {
            action_name: 'new_action',
            action_model: 'action',
            action_type: 'window',
            component_type: 'form',
            action_sequence: {
              current_action: 'new_action',
              submit_action: 'submit_action',
              submit_next_action: 'list_action',
              abandon_action: 'list_action_menu'
            },
            submit_action_name: 'submit_action',
            abandon_action_name: 'list_action_menu',
            next_action_name: 'submit_action'
          },
          context_actions: [
            {
              rec_name: 'submit_action',
              action_type: 'save',
              label: 'Salva',
              button_icon: 'fa-plus',
              modal: false,
              url_action: '/action/submit_action/submit_action',
              context_button_mode: []
            }
          ]
        });
      }
      return makeResponse({ mode: 'action', data: { status: 'ok' } });
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.onBuilderSwitchChanged(true);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'form',
      model: 'component',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    }));

    app.enableFormBuilderMode();
    expect(app.builderMode).toBeTrue();

    app.actionManager.currentActionName = 'list_action';
    app.appManager.viewMode = 'list';

    await app.onContextActionClick({
      rec_name: 'new_action',
      action_type: 'window',
      label: 'Nuovo',
      button_icon: 'it-plus',
      modal: false,
      url_action: '/action/new_action',
      context_button_mode: ['list']
    });

    expect(apiMock.getAction).toHaveBeenCalledWith(
      'new_action',
      jasmine.objectContaining({ recName: '', limit: 1 })
    );
    expect(app.currentActionName).toBe('new_action');
    expect(app.selectedModel).toBe('action');
    expect(app.viewMode).toBe('form');
    expect(app.builderMode).toBeFalse();
    expect(app.showFormBuilder).toBeFalse();
    expect(app.isFormEditorPage).toBeFalse();
    expect(app.formSchema).toEqual(jasmine.objectContaining({ display: 'form' }));
  });

  it('should prefer canonical content payloads for action lists', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      title: 'Customers',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }],
      context_actions: [
        {
          rec_name: 'new_customer',
          action_type: 'window',
          label: 'Nuovo',
          button_icon: 'it-plus',
          modal: false,
          url_action: '/action/new_customer',
          context_button_mode: ['list']
        }
      ]
    }));

    expect(app.viewMode).toBe('list');
    expect(app.currentActionName).toBe('list_customers');
    expect(app.selectedModel).toBe('customer');
    expect(app.dashboardTitle).toBe('Customers');
    expect(app.tableRows.length).toBe(1);
    expect(app.tableRows[0].__rec_name).toBe('CUST-1');
    expect(app.listContextActions).toEqual([
      jasmine.objectContaining({
        rec_name: 'new_customer',
        action_type: 'window',
        url_action: '/action/new_customer'
      })
    ]);
  });

  [
    { name: 'editable is false', editable: false, can_create: true },
    { name: 'can_create is false', editable: true, can_create: false }
  ].forEach(permission => {
    it(`should hide Nuovo record from lists when ${permission.name}`, async () => {
      const fixture = TestBed.createComponent(AppComponent);
      const app = fixture.componentInstance as any;

      await app.actionManager.applyActionResponse(makeResponse({
        mode: 'list',
        model: 'modulo_dati_persona',
        editable: permission.editable,
        can_create: permission.can_create,
        fields: { action_name: 'list_modulo_dati_persona' },
        columns: { rec_name: 'Record' },
        data: [{ rec_name: 'PERSONA-1' }],
        context_actions: []
      }));
      fixture.detectChanges();

      expect(app.canOpenNewRecord).toBeFalse();
      expect(String(fixture.nativeElement.textContent || '')).not.toContain('Nuovo record');
    });
  });

  it('should hide list action buttons when context_button_mode is empty', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      title: 'Customers',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }],
      context_actions: [
        {
          rec_name: 'new_customer',
          action_type: 'window',
          label: 'Nuovo',
          button_icon: 'it-plus',
          modal: false,
          url_action: '/action/new_customer',
          context_button_mode: []
        }
      ]
    }));

    fixture.detectChanges();

    expect(app.listContextActions).toEqual([]);
    expect(app.showListActionButtonsFallback).toBeFalse();
    const pageText = String(fixture.nativeElement.textContent || '');
    expect(pageText).not.toContain('Apri record');
    expect(pageText).not.toContain('Nuovo record');
  });

  it('should return to the origin action url when Abbandona is provided by context_actions', async () => {
    apiMock.getAction.and.callFake(async (name: string) => {
      if (name === 'list_customers') {
        return makeResponse({
          mode: 'list',
          model: 'customer',
          title: 'Customers',
          fields: { action_name: 'list_customers' },
          columns: { rec_name: 'Record' },
          total_count: 1,
          data: [{ rec_name: 'CUST-1' }],
          context_actions: [
            {
              rec_name: 'new_customer',
              action_type: 'window',
              label: 'Nuovo',
              button_icon: 'it-plus',
              modal: false,
              url_action: '/action/new_customer',
              context_button_mode: ['list']
            }
          ]
        });
      }

      if (name === 'new_customer') {
        return makeResponse({
          mode: 'form',
          model: 'customer',
          fields: {
            action_name: 'new_customer',
            cancel_button: true,
            abandon_action: 'list_archived_customers'
          } as any,
          data: { rec_name: 'NEW-1' },
          schema: {
            display: 'form',
            components: [{ type: 'textfield', key: 'name', input: true }]
          },
          context_actions: [
            {
              rec_name: 'abandon',
              action_type: 'window',
              label: 'Abbandona',
              button_icon: 'pi pi-times',
              modal: false,
              url_action: '',
              context_button_mode: ['form']
            }
          ]
        });
      }

      return makeResponse({ mode: 'action', data: { status: 'ok' } });
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/list_customers');
      await app.actionManager["handleLocationRoute"](false);

      expect(app.listContextActions).toEqual([
        jasmine.objectContaining({
          rec_name: 'new_customer',
          url_action: '/action/new_customer'
        })
      ]);

      await app.onContextActionClick(app.listContextActions[0]);

      const abandonButton = app.currentFormActionButtons.find((button: any) => button.label === 'Abbandona');
      expect(abandonButton).toEqual(jasmine.objectContaining({
        url_action: '/action/list_customers'
      }));

      await app.runTopMenuAction(abandonButton);

      expect(apiMock.getAction.calls.mostRecent().args[0]).toBe('list_customers');
      expect(app.viewMode).toBe('list');
      expect(window.location.pathname).toBe('/action/list_customers');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should ignore pending lazy select hydration after Abbandona returns to the origin page', async () => {
    let resolveRemoteSelect!: (value: Array<{ label: string; value: string }>) => void;
    const remoteSelectPromise = new Promise<Array<{ label: string; value: string }>>((resolve) => {
      resolveRemoteSelect = resolve;
    });

    apiMock.getRemoteSelect.and.returnValue(remoteSelectPromise as Promise<any>);
    apiMock.getAction.and.callFake(async (name: string) => {
      if (name === 'list_customers') {
        return makeResponse({
          mode: 'list',
          model: 'customer',
          title: 'Customers',
          fields: { action_name: 'list_customers' },
          columns: { rec_name: 'Record' },
          total_count: 1,
          data: [{ rec_name: 'CUST-1' }],
          context_actions: [
            {
              rec_name: 'new_customer',
              action_type: 'window',
              label: 'Nuovo',
              button_icon: 'it-plus',
              modal: false,
              url_action: '/action/new_customer',
              context_button_mode: ['list']
            }
          ]
        });
      }

      if (name === 'new_customer') {
        return makeResponse({
          mode: 'form',
          model: 'customer',
          fields: {
            action_name: 'new_customer',
            cancel_button: true
          } as any,
          data: { rec_name: 'NEW-1', country: 'IT' },
          schema: {
            display: 'form',
            components: [
              {
                type: 'select',
                key: 'country',
                properties: {
                  model: 'country',
                  src: 'url'
                }
              }
            ]
          },
          context_actions: [
            {
              rec_name: 'abandon',
              action_type: 'window',
              label: 'Abbandona',
              button_icon: 'pi pi-times',
              modal: false,
              url_action: '',
              context_button_mode: ['form']
            }
          ]
        });
      }

      return makeResponse({ mode: 'action', data: { status: 'ok' } });
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/list_customers');
      await app.actionManager["handleLocationRoute"](false);
      await app.onContextActionClick(app.listContextActions[0]);

      const readyPromise = app.onFormViewerReady();
      const abandonButton = app.currentFormActionButtons.find((button: any) => button.label === 'Abbandona');
      await app.runTopMenuAction(abandonButton);

      expect(app.viewMode).toBe('list');
      expect(window.location.pathname).toBe('/action/list_customers');
      expect(app.renderer.formSchema).toBeNull();

      resolveRemoteSelect([{ label: 'Italia', value: 'IT' }]);
      await readyPromise;

      expect(app.viewMode).toBe('list');
      expect(window.location.pathname).toBe('/action/list_customers');
      expect(app.renderer.formSchema).toBeNull();
      expect(app.listContextActions).toEqual([
        jasmine.objectContaining({
          rec_name: 'new_customer',
          url_action: '/action/new_customer'
        })
      ]);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should ignore stale form responses after returning to dashboard', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.onBuilderSwitchChanged(true);

    const actionManager = app.actionManager as any;
    const staleContext = actionManager.pageContextId;
    actionManager.beginPageContext();
    app.appManager.viewMode = 'dashboard';

    await actionManager.applyActionResponse(
      makeResponse({
        mode: 'form',
        fields: { component_type: 'form', action_name: 'design_form' },
        data: { rec_name: 'component.form.demo' },
        schema: { display: 'form', components: [] }
      }),
      staleContext
    );

    expect(app.builderMode).toBeFalse();
    expect(app.isFormEditorPage).toBeFalse();
    expect(app.showFormBuilder).toBeFalse();
  });

  it('should sync selected record when table selection changes', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const row = { __rowid: 1, __rec_name: 'rec-1' } as any;

    app.onTableSelectionChange([row]);

    expect(app.selectedRows.length).toBe(1);
    expect(app.selectedRecordName).toBe('rec-1');
  });

  it('should not reorder table when filter is active', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    app.filterText = 'abc';
    app.tableManager.allRows = [
      { __rowid: 1, __rec_name: 'a' },
      { __rowid: 2, __rec_name: 'b' }
    ];
    app.tableManager.tableRows = [...app.tableManager.allRows];

    app.onRowReorder({ dragIndex: 0, dropIndex: 1 } as any);

    expect(app.tableManager.allRows.map((row: any) => row.__rec_name)).toEqual(['a', 'b']);
    expect(app.statusError).toBeTrue();
  });

  it('should reorder visible rows when filter is not active', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    app.filterText = '';
    app.tableManager.allRows = [
      { __rowid: 1, __rec_name: 'a' },
      { __rowid: 2, __rec_name: 'b' },
      { __rowid: 3, __rec_name: 'c' }
    ];
    app.tableManager.tableRows = [...app.tableManager.allRows];

    app.onRowReorder({ dragIndex: 0, dropIndex: 2 } as any);

    expect(app.tableManager.allRows.map((row: any) => row.__rec_name)).toEqual(['b', 'c', 'a']);
    expect(app.statusError).toBeFalse();
  });

  it('should apply total count and limit from streamed list metadata', async () => {
    apiMock.streamList.and.callFake(async (_model, _payload, onItem, onMeta) => {
      onMeta?.({
        order: 'rec_name asc',
        skip: '0',
        limit: '30',
        totalCount: 240,
        columnsRaw: '',
        columns: null
      } as any);
      onItem({ rec_name: 'r1' });
      onItem({ rec_name: 'r2' });
      return {
        result: {
          count: 2,
          totalCount: 240,
          contentType: 'application/x-ndjson',
          order: 'rec_name asc',
          skip: '0',
          limit: '30',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';
    app.tableManager.limit = 20;
    app.tableManager.queryMode = 'json';
    app.tableManager.queryText = '{}';

    await app.actionManager.loadRecords();

    expect(app.limit).toBe(30);
    expect(app.tableTotalRecords).toBe(240);
    expect(app.tableRows.length).toBe(2);
  });

  it('should keep rec_name on table rows even when source record has no rec_name field', async () => {
    apiMock.streamList.and.callFake(async (_model, _payload, onItem, onMeta) => {
      onMeta?.({
        order: 'rec_name asc',
        skip: '0',
        limit: '20',
        totalCount: 1,
        columnsRaw: JSON.stringify([['title', 'Title']]),
        columns: [['title', 'Title']]
      } as any);
      onItem({ title: 'Posizione A', id: 'Gov.30459' });
      return {
        result: {
          count: 1,
          totalCount: 1,
          contentType: 'application/x-ndjson',
          order: 'rec_name asc',
          skip: '0',
          limit: '20',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'posizione';
    app.tableManager.queryMode = 'json';
    app.tableManager.queryText = '{}';

    await app.actionManager.loadRecords();

    expect(app.tableRows.length).toBe(1);
    expect((app.tableRows[0] as any).rec_name).toBe('Gov.30459');
    expect((app.tableRows[0] as any).__rec_name).toBe('Gov.30459');
  });

  it('should render select labels in list table using schema options', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record', stato: 'Stato' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'select',
            key: 'stato',
            data: {
              values: [
                { label: 'Bozza', value: 'DRAFT' },
                { label: 'Confermato', value: 'CONF' }
              ]
            }
          }
        ]
      },
      data: [
        {
          rec_name: 'ORD-1',
          stato: 'CONF'
        }
      ]
    }));

    expect(Array.from((app.tableManager as any).tableCellRenderers.keys())).toContain('stato');
    expect(app.displayCell(app.tableRows[0], 'stato')).toBe('Confermato');
  });

  it('should render remote select labels in list table after schema hydration', async () => {
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Italia', value: 'IT' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'anagrafica',
      columns: { rec_name: 'Record', country: 'Country' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'select',
            key: 'country',
            properties: {
              url: 'https://remote.example/api/countries'
            }
          }
        ]
      },
      data: [
        {
          rec_name: 'REC-1',
          country: 'IT'
        }
      ]
    }));

    await app.tableManager.warmTableCellRenderers(app.tableManager.allRows);
    expect(apiMock.getRemoteSelect).toHaveBeenCalled();
    expect(app.displayCell(app.tableRows[0], 'country')).toBe('Italia');
  });

  it('should render resource select labels in list table using component template', async () => {
    apiMock.streamList.and.callFake(async (model: string, payload: ListRequestPayload, onItem: (item: unknown) => void, _onMeta, options) => {
      expect(model).toBe('auth.user');
      expect(payload).toEqual(jasmine.objectContaining({
        query: {},
        skip: 0,
        limit: 1000,
        order: 'rec_name asc'
      }));
      expect(options).toEqual({ stream: false });
      onItem({
        rec_name: 'a.gerace',
        data: {
          rec_name: 'a.gerace',
          full_name: 'Antonio Gerace'
        }
      });
      return {
        result: {
          count: 1,
          totalCount: 1,
          contentType: 'application/json',
          order: '',
          skip: '0',
          limit: '1000',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'task',
      columns: { rec_name: 'Record', owner: 'Owner' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'select',
            key: 'owner',
            dataSrc: 'resource',
            data: { resource: 'auth.user' },
            idPath: 'rec_name',
            template: '<span>{{ item.data.full_name }}</span>'
          }
        ]
      },
      data: [
        {
          rec_name: 'TASK-1',
          owner: 'a.gerace'
        }
      ]
    }));

    await app.tableManager.warmTableCellRenderers(app.tableManager.allRows);

    expect(apiMock.streamList).toHaveBeenCalled();
    expect(app.displayCell(app.tableRows[0], 'owner')).toBe('Antonio Gerace');
  });

  it('should fallback to model schema to render select labels in action lists without inline schema', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'select',
          key: 'classificazione',
          data: {
            values: [
              { label: 'Personale tecnico', value: 'personale_tecnico' },
              { label: 'Personale amministrativo', value: 'personale_amministrativo' }
            ]
          }
        },
        {
          type: 'select',
          key: 'ruoli_sicurezza',
          multiple: true,
          data: {
            values: [
              { label: 'Antincendio', value: 'anti_incendio' },
              { label: 'Emergenza sanitaria', value: 'emergenza_sanitaria' },
              { label: 'Emergenza', value: 'emergenza' }
            ]
          }
        }
      ]
    }}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'anagrafica',
      columns: { ruoli_sicurezza: 'Ruoli Sicurezza', classificazione: 'Classificazione' },
      total_count: 1,
      data: [
        {
          rec_name: 'ANA-1',
          classificazione: 'personale_tecnico',
          ruoli_sicurezza: ['anti_incendio', 'emergenza_sanitaria', 'emergenza']
        }
      ]
    }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock.getRecordSchema).toHaveBeenCalledWith('anagrafica');
    expect(app.displayCell(app.tableRows[0], 'classificazione')).toBe('Personale tecnico');
    expect(app.displayCell(app.tableRows[0], 'ruoli_sicurezza')).toBe('Antincendio, Emergenza sanitaria, Emergenza');
  });

  it('should render select labels in list table when schema is provided in content.schema', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record', stato: 'Stato' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'select',
            key: 'stato',
            data: {
              values: [
                { label: 'Bozza', value: 'DRAFT' },
                { label: 'Confermato', value: 'CONF' }
              ]
            }
          }
        ]
      },
      data: [
        {
          rec_name: 'ORD-2',
          stato: 'DRAFT'
        }
      ]
    }));

    expect(app.displayCell(app.tableRows[0], 'stato')).toBe('Bozza');
  });

  it('should render datetime values in list table using form component metadata', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record', created_at: 'Creato il' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'datetime',
            key: 'created_at',
            format: 'yyyy-MM-dd HH:mm'
          }
        ]
      },
      data: [
        {
          rec_name: 'ORD-3',
          created_at: '2025-01-15T14:30:00Z'
        }
      ]
    }));

    const rendered = app.displayCell(app.tableRows[0], 'created_at');
    expect(rendered).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(rendered).toContain(':');
  });

  it('should resolve select label from flat list row data', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'ordine',
      columns: { rec_name: 'Record', stato: 'Stato' },
      total_count: 1,
      schema: {
        components: [
          {
            type: 'select',
            key: 'stato',
            data: {
              values: [
                { label: 'Bozza', value: 'DRAFT' },
                { label: 'Confermato', value: 'CONF' }
              ]
            }
          }
        ]
      },
      data: [
        {
          rec_name: 'ORD-4',
          stato: 'CONF'
        }
      ]
    }));

    expect(app.displayCell(app.tableRows[0], 'stato')).toBe('Confermato');
  });

  it('should convert query builder rules to backend query payload', async () => {
    apiMock.streamList.and.callFake(async (_model, payload, _onItem, _onMeta) => {
      expect(payload.query).toEqual({
        $and: [
          { status: { $regex: 'cons', $options: 'i' } },
          { qty: { $gte: 2 } }
        ]
      });
      return {
        result: {
          count: 0,
          totalCount: 0,
          contentType: 'application/x-ndjson',
          order: '',
          skip: '0',
          limit: '20',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.selectedModel = 'anagrafica';
    app.tableManager.queryMode = 'builder';
    app.tableManager.queryBuilderConfig = {
      fields: {
        status: { name: 'Stato', type: 'string' },
        qty: { name: 'Qty', type: 'number' }
      }
    };
    app.tableManager.queryBuilderRules = {
      condition: 'and',
      rules: [
        { field: 'status', operator: 'contains', value: 'cons' },
        { field: 'qty', operator: '>=', value: 2 }
      ]
    };

    await app.actionManager.loadRecords();

    expect(apiMock.streamList).toHaveBeenCalled();
  });

  it('should merge table search filter text when building server-side query payload', async () => {
    apiMock.streamList.and.callFake(async (_model, payload, _onItem, _onMeta) => {
      expect(payload.query).toEqual({
        $and: [
          { stato: 'APERTO' },
          {
            $or: [
              { rec_name: { $regex: 'alpha', $options: 'i' } },
              { titolo: { $regex: 'alpha', $options: 'i' } }
            ]
          }
        ]
      });
      return {
        result: {
          count: 0,
          totalCount: 0,
          contentType: 'application/x-ndjson',
          order: '',
          skip: '0',
          limit: '20',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.selectedModel = 'anagrafica';
    app.tableManager.queryMode = 'json';
    app.tableManager.queryText = JSON.stringify({ stato: 'APERTO' });
    app.tableManager.tableColumns = [
      { field: '__rec_name', title: 'Record' },
      { field: 'rec_name', title: 'Record name' },
      { field: 'titolo', title: 'Titolo' }
    ];
    app.tableManager.queryBuilderConfig = {
      fields: {
        rec_name: { name: 'Record', type: 'string' },
        titolo: { name: 'Titolo', type: 'string' }
      }
    };
    app.filterText = 'alpha';

    await app.actionManager.loadRecords();

    expect(apiMock.streamList).toHaveBeenCalled();
  });

  it('should apply list filter rules as Mongo-compatible query payload', async () => {
    apiMock.streamList.and.callFake(async (_model, payload, _onItem, _onMeta) => {
      expect(payload.query).toEqual({
        $and: [
          { status: { $regex: 'cons', $options: 'i' } },
          { qty: { $gte: 2 } }
        ]
      });
      return {
        result: {
          count: 0,
          totalCount: 0,
          contentType: 'application/x-ndjson',
          order: '',
          skip: '0',
          limit: '20',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.selectedModel = 'anagrafica';

    app.onListFilterRulesChange({
      condition: 'and',
      rules: [
        { field: 'status', operator: 'contains', value: 'cons' },
        { field: 'qty', operator: '>=', value: 2 }
      ]
    });
    await app.applyListFilters();

    expect(apiMock.streamList).toHaveBeenCalled();
  });

  it('should pass the generated Mongo query preview to the record list', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'list';
    app.tableManager.queryText = JSON.stringify({ status: 'APERTO' }, null, 2);

    fixture.detectChanges();

    const list = fixture.debugElement.query(By.directive(RecordListComponent)).componentInstance as RecordListComponent;
    expect(list.filterPreview).toBe(app.tableManager.queryText);
  });

  it('should render fast search config from list action response and keep action reload as default', async () => {
    const fastSearchConfig = {
      schema: [
        { type: 'textfield', key: 'name', label: 'Nome' },
        { type: 'button', action: 'submit', label: 'Submit', key: 'submit' }
      ]
    };
    const listResponse = makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers', fast_search: fastSearchConfig },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse(listResponse);

    expect(app.fastSearchEnabled).toBeTrue();
    expect(app.fastSearchSchema).toEqual({
      display: 'form',
      components: [{ type: 'textfield', key: 'name', label: 'Nome' }]
    });

    apiMock.getAction.calls.reset();
    apiMock.filterFastSearch.calls.reset();
    apiMock.getAction.and.resolveTo(listResponse);

    await app.actionManager.loadRecords();

    expect(apiMock.filterFastSearch).not.toHaveBeenCalled();
    expect(apiMock.getAction).toHaveBeenCalledWith('list_customers', jasmine.objectContaining({
      query: {},
      skip: 0,
      limit: 20
    }));
  });

  it('should bootstrap action list load when action response has no inline rows payload', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    }));

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 0,
      data: {}
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock.getAction).toHaveBeenCalledWith('list_customers', jasmine.objectContaining({
      query: {},
      skip: 0,
      limit: 20
    }));
    expect(app.tableRows.length).toBe(1);
    expect(app.tableRows[0].__rec_name).toBe('CUST-1');
  });

  it('should prime action list route with limit 1 before loading table data', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    apiMock.getAction.calls.reset();
    apiMock.getAction.and.callFake(async (_name: string, options: any) => {
      if (options.limit === 1) {
        return makeResponse({
          mode: 'list',
          model: 'customer',
          fields: { action_name: 'list_customers' },
          columns: { rec_name: 'Record' },
          total_count: 2,
          data: [{ rec_name: 'PRIME-ROW' }]
        });
      }
      if (options.limit === 20) {
        return makeResponse({
          mode: 'list',
          model: 'customer',
          fields: { action_name: 'list_customers' },
          columns: { rec_name: 'Record' },
          total_count: 2,
          data: [{ rec_name: 'CUST-1' }, { rec_name: 'CUST-2' }]
        });
      }
      throw new Error(`Unexpected limit ${options.limit}`);
    });

    await app.actionManager['runActionRoute']('/action/list_customers');
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock.getAction.calls.argsFor(0)).toEqual([
      'list_customers',
      jasmine.objectContaining({
        recName: '',
        query: {},
        skip: 0,
        limit: 1
      })
    ]);
    expect(apiMock.getAction.calls.argsFor(1)).toEqual([
      'list_customers',
      jasmine.objectContaining({
        query: {},
        skip: 0,
        limit: 20
      })
    ]);
    expect(app.viewMode).toBe('list');
    expect(app.tableRows.map((row: any) => row.__rec_name)).toEqual(['CUST-1', 'CUST-2']);
  });

  it('should not bootstrap action list load when action response already includes inline rows payload', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    apiMock.getAction.calls.reset();

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    }));

    expect(apiMock.getAction).not.toHaveBeenCalled();
    expect(app.tableRows.length).toBe(1);
    expect(app.tableRows[0].__rec_name).toBe('CUST-1');
  });

  it('should open inline action lists without waiting for fast search and table renderer warmup', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const pendingWarmup = new Promise<void>(() => undefined);

    spyOn(app.actionManager, 'applyFastSearchConfig').and.returnValue(pendingWarmup);
    const tableWarmupSpy = spyOn(app.tableManager, 'warmTableCellRenderers').and.returnValue(pendingWarmup);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      fields: {
        action_name: 'list_customers',
        fast_search: {
          schema: {
            components: []
          }
        }
      },
      schema: {
        components: []
      },
      columns: { rec_name: 'Record' },
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    }));

    expect(app.viewMode).toBe('list');
    expect(app.tableRows.length).toBe(1);
    expect(tableWarmupSpy).toHaveBeenCalled();
  });

  it('should resolve list navigation without waiting for background record bootstrap', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const pendingLoad = new Promise<void>(() => undefined);

    spyOn(app.actionManager, 'loadRecords').and.returnValue(pendingLoad);

    await app.actionManager.applyActionResponse(makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: { rec_name: 'Record' },
      total_count: 0,
      data: {}
    }));

    expect(app.viewMode).toBe('list');
    expect(app.actionManager.loadRecords).toHaveBeenCalledWith(true);
  });

  it('should hydrate remote select options for fast search schema', async () => {
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Documento', value: 'documento' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'action';
    app.tableManager.selectedModel = 'action';

    await app.tableManager.setFastSearchConfig('list_actions', {
      display: 'form',
      components: [
        {
          type: 'select',
          key: 'model',
          label: 'Model',
          properties: { src: 'url', model: 'ir.model' }
        }
      ]
    });

    expect(apiMock.getRemoteSelect).toHaveBeenCalledWith(
      jasmine.objectContaining({
        key: 'model',
        curr_model: 'action',
        properties: jasmine.objectContaining({
          src: 'url',
          model: 'ir.model'
        })
      })
    );

    const schema = app.fastSearchSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    const select = components.find(component => component['key'] === 'model') as Record<string, unknown>;
    expect(select['dataSrc']).toBe('values');
    expect((select['data'] as Record<string, unknown>)['values']).toEqual([
      jasmine.objectContaining({ label: 'Documento', value: 'documento', data: jasmine.objectContaining({ label: 'Documento', value: 'documento' }) })
    ]);
  });

  it('should use fast search form model for remote select payloads when provided', async () => {
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Documento', value: 'documento' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.selectedModel = 'action';
    app.tableManager.selectedModel = 'action';

    await app.tableManager.setFastSearchConfig('list_actions', {
      display: 'form',
      components: [
        {
          type: 'select',
          key: 'user_function',
          label: 'User Function',
          properties: { src: 'url', model: 'ir.model' }
        }
      ]
    }, 'fast_search_action');

    expect(apiMock.getRemoteSelect).toHaveBeenCalledWith(
      jasmine.objectContaining({
        key: 'user_function',
        curr_model: 'fast_search_action',
        properties: jasmine.objectContaining({
          src: 'url',
          model: 'ir.model'
        })
      })
    );
  });

  it('should merge partial fast search change events instead of overwriting filters', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.tableManager.setFastSearchConfig('list_customers', {
      display: 'form',
      components: [
        { type: 'textfield', key: 'name', label: 'Nome' },
        { type: 'textfield', key: 'project', label: 'Progetto' }
      ]
    });

    await app.onFastSearchFormChange({
      data: { name: 'mario' },
      changed: { component: { key: 'name', type: 'textfield' } }
    });
    await app.onFastSearchFormChange({
      data: { project: 'ozon' },
      changed: { component: { key: 'project', type: 'textfield' } }
    });

    expect(app.fastSearchSubmission).toEqual({
      data: {
        name: 'mario',
        project: 'ozon'
      }
    });
  });

  it('should restore fast search from temporary local cache without consuming it', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const schema = {
      display: 'form',
      components: [
        { type: 'textfield', key: 'name', label: 'Nome' }
      ]
    };

    await app.tableManager.setFastSearchConfig('list_customers', schema);
    await app.onFastSearchFormChange({
      data: { name: 'mario' },
      changed: { component: { key: 'name', type: 'textfield' } }
    });

    expect(window.localStorage.getItem('ozon.fs.list_customers')).not.toBeNull();

    app.tableManager.beginFastSearchWarmup(true);
    const restored = await app.tableManager.setFastSearchConfig('list_customers', schema);

    expect(restored).toBeTrue();
    expect(app.tableManager.fastSearchActive).toBeTrue();
    expect(app.fastSearchSubmission).toEqual({
      data: {
        name: 'mario'
      }
    });
    expect(window.localStorage.getItem('ozon.fs.list_customers')).not.toBeNull();
  });

  it('should expire stale fast search local cache entries', async () => {
    const nowSpy = spyOn(Date, 'now').and.returnValue(1_000);
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const schema = {
      display: 'form',
      components: [
        { type: 'textfield', key: 'name', label: 'Nome' }
      ]
    };

    await app.tableManager.setFastSearchConfig('list_customers', schema);
    await app.onFastSearchFormChange({
      data: { name: 'mario' },
      changed: { component: { key: 'name', type: 'textfield' } }
    });

    nowSpy.and.returnValue((8 * 60 * 60 * 1000) + 1_001);
    app.tableManager.beginFastSearchWarmup(true);
    const restored = await app.tableManager.setFastSearchConfig('list_customers', schema);

    expect(restored).toBeFalse();
    expect(app.fastSearchSubmission).toEqual({ data: {} });
    expect(window.localStorage.getItem('ozon.fs.list_customers')).toBeNull();
  });

  it('should auto trigger fast search when a select changes', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const searchSpy = spyOn(app, 'doFastSearch').and.resolveTo();

    await app.tableManager.setFastSearchConfig('list_customers', {
      display: 'form',
      components: [
        {
          type: 'select',
          key: 'model',
          label: 'Model',
          data: { values: [{ label: 'Customer', value: 'customer' }] }
        }
      ]
    });

    await app.onFastSearchFormChange({
      submission: { data: { model: 'customer' } },
      changed: { component: { key: 'model', type: 'select' } }
    });

    expect(searchSpy).toHaveBeenCalled();
  });

  it('should ignore fast search change events replayed from submission input', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const searchSpy = spyOn(app, 'doFastSearch').and.resolveTo();

    await app.tableManager.setFastSearchConfig('list_customers', {
      display: 'form',
      components: [
        {
          type: 'select',
          key: 'model',
          label: 'Model',
          data: { values: [{ label: 'Customer', value: 'customer' }] }
        }
      ]
    });

    await app.onFastSearchFormChange({
      submission: { data: { model: 'customer' } },
      changed: { component: { key: 'model', type: 'select' } },
      flags: { fromSubmission: true }
    });

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('should call fast search endpoint only after explicit submit', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'list';
    app.appManager.selectedModel = 'customer';
    app.tableManager.selectedModel = 'customer';
    app.actionManager.currentActionName = 'list_customers';
    app.tableManager.tableColumns = [
      { field: '__rec_name', title: 'Record' },
      { field: 'name', title: 'Nome' }
    ];
    await app.tableManager.setFastSearchConfig('list_customers', {
      display: 'form',
      components: [{ type: 'textfield', key: 'name', label: 'Nome' }]
    });
    await app.onFastSearchFormChange({ data: { name: 'mario' } });

    apiMock.filterFastSearch.and.callFake(async (actionName, payload, onItem, onMeta) => {
      expect(actionName).toBe('list_customers');
      expect(payload.query_fields).toEqual([{ name: { $regex: 'mario', $options: 'i' } }]);
      onMeta?.({
        order: 'rec_name asc',
        skip: '0',
        limit: '20',
        totalCount: 1,
        columnsRaw: '',
        columns: null
      } as any);
      onItem({ rec_name: 'CUST-1', name: 'Mario' });
      return {
        count: 1,
        totalCount: 1,
        contentType: 'application/x-ndjson',
        order: 'rec_name asc',
        skip: '0',
        limit: '20',
        columnsRaw: '',
        columns: null
      };
    });

    await app.doFastSearch();

    expect(apiMock.filterFastSearch).toHaveBeenCalled();
    expect(app.tableRows.length).toBe(1);
    expect(app.tableRows[0].__rec_name).toBe('CUST-1');
    expect(app.tableColumns.map((column: any) => column.field)).toEqual(['__rec_name', 'name']);
  });

  it('should trigger fast search on Enter in desktop mode', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as any);
    const searchSpy = spyOn(app, 'doFastSearch').and.resolveTo();
    const event = {
      key: 'Enter',
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
      target: document.createElement('input')
    } as any;

    app.onFastSearchKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalled();
  });

  it('should block Enter submit in mobile mode', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as any);
    const searchSpy = spyOn(app, 'doFastSearch').and.resolveTo();
    const event = {
      key: 'Enter',
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
      target: document.createElement('input')
    } as any;

    app.onFastSearchKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('should reset fast search back to base action list reload', async () => {
    const listResponse = makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers', fast_search: {
        schema: [{ type: 'textfield', key: 'name', label: 'Nome' }]
      }},
      columns: {},
      total_count: 1,
      data: [{ rec_name: 'CUST-BASE', name: 'Base' }]
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'list';
    app.appManager.selectedModel = 'customer';
    app.tableManager.selectedModel = 'customer';
    app.actionManager.currentActionName = 'list_customers';
    app.tableManager.tableColumns = [
      { field: '__rec_name', title: 'Record' },
      { field: 'name', title: 'Nome' }
    ];
    await app.tableManager.setFastSearchConfig('list_customers', {
      display: 'form',
      components: [{ type: 'textfield', key: 'name', label: 'Nome' }]
    });
    await app.onFastSearchFormChange({ data: { name: 'mario' } });

    await app.doFastSearch();
    expect(window.localStorage.getItem('ozon.fs.list_customers')).not.toBeNull();

    apiMock.filterFastSearch.calls.reset();
    apiMock.getAction.calls.reset();
    apiMock.getAction.and.resolveTo(listResponse);

    await app.resetFastSearch();

    expect(app.tableManager.fastSearchActive).toBeFalse();
    expect(apiMock.filterFastSearch).not.toHaveBeenCalled();
    expect(apiMock.getAction).toHaveBeenCalledWith('list_customers', jasmine.objectContaining({
      query: {},
      skip: 0,
      limit: 20
    }));
    expect(window.localStorage.getItem('ozon.fs.list_customers')).toBeNull();
    expect(app.tableColumns.map((column: any) => column.field)).toEqual(['__rec_name', 'name']);
  });

  it('should clear cached fast search filters when reopening an action from the menu', async () => {
    const listResponse = makeResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers', fast_search: {
        schema: [{ type: 'textfield', key: 'name', label: 'Nome' }]
      }},
      columns: {},
      total_count: 1,
      data: [{ rec_name: 'CUST-BASE', name: 'Base' }]
    });
    const originalPath = window.location.pathname;
    apiMock.getAction.and.resolveTo(listResponse);
    window.localStorage.setItem('ozon.fs.list_customers', JSON.stringify({
      savedAt: Date.now(),
      data: { name: 'mario' }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    try {
      await app.actionManager.onMenuActionAnchorClick({
        model: 'customer',
        key: 'list_customers',
        type: 'button',
        label: 'Clienti',
        leftIcon: 'pi pi-list',
        authtoken: '',
        req_id: 'req_1',
        btn_action_type: false,
        action_type: 'window',
        url_action: '/action/list_customers',
        builder: false,
        menu_group: 'customer',
        menu_type: '',
        is_admin: false
      }, {
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: jasmine.createSpy('preventDefault')
      } as any);

      expect(window.localStorage.getItem('ozon.fs.list_customers')).toBeNull();
      expect(app.tableManager.fastSearchActive).toBeFalse();
      expect(app.fastSearchSubmission).toEqual({ data: {} });
      expect(apiMock.getAction).toHaveBeenCalledWith(
        'list_customers',
        jasmine.objectContaining({ recName: '' })
      );
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }
  });

  it('should normalize formio table components in schema', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({ mode: 'form', schema: {
      components: [
        {
          type: 'table',
          key: 'tabella1'
        }
      ]
    }}));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';

    await app.actionManager.loadSchema();

    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    expect(components[0]['customClass']).toContain('ozon-form-table');
    expect(components[0]['tableView']).toBeTrue();
  });

  it('should reject action response when envelope fail flag is true', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await expectAsync(app.actionManager['applyActionResponse'](
      makeResponse({ mode: 'action', data: {} }, true, 'Errore business')
    )).toBeRejectedWithError('Errore business');
  });

  it('should load form schema from canonical response envelope content', async () => {
    apiMock.getRecordSchema.and.resolveTo(makeResponse({
      mode: 'form',
      data: {},
      schema: {
        display: 'form',
        components: [
          {
            type: 'textfield',
            key: 'nome'
          }
        ]
      }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.selectedModel = 'anagrafica';

    await app.actionManager.loadSchema();

    const schema = app.formSchema as Record<string, unknown>;
    const components = schema['components'] as Array<Record<string, unknown>>;
    expect(components.length).toBe(1);
    expect(components[0]['key']).toBe('nome');
  });

  it('should open the form without waiting for list renderers or builder warmup', async () => {
    apiMock.getRecord.and.resolveTo(makeResponse({
      mode: 'form',
      schema: [
        {
          type: 'textfield',
          key: 'title',
          input: true
        }
      ],
      data: {
        rec_name: 'cmp-1',
        data_model: 'res.partner',
        title: 'Demo'
      }
    }));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.isAdminUser = true;
    app.appManager.builderFeatureEnabled = true;
    app.appManager.setBuilderEnabled(true, false);
    app.appManager.selectedModel = 'component';
    app.tableManager.selectedModel = 'component';
    app.renderer.selectedModel = 'component';
    app.tableManager.selectedRecordName = 'cmp-1';

    const pendingWarmup = new Promise<void>(() => undefined);
    const tableRefreshSpy = spyOn(app.tableManager, 'refreshTableCellRenderers').and.resolveTo();
    const builderRefreshSpy = spyOn(app.builder, 'refreshFormBuilderConfigForCurrentForm').and.returnValue(pendingWarmup);

    await app.actionManager.openSelectedRecord();

    expect(app.viewMode).toBe('form');
    expect(tableRefreshSpy).not.toHaveBeenCalled();
    expect(builderRefreshSpy).toHaveBeenCalled();
    expect(app.formSubmission).toEqual({
      data: jasmine.objectContaining({
        rec_name: 'cmp-1',
        data_model: 'res.partner',
        title: 'Demo'
      })
    });
  });

  it('should fallback to fields.model or action name for selectedModel if content.model is empty', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.selectedModel = 'previous_model';

    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'list',
      model: '',
      title: 'Test Request List',
      fields: { action_name: 'list_test_request', model: 'test_request' },
      columns: { rec_name: 'Record' },
      data: [{ rec_name: 'TR-1' }]
    }));

    await app.actionManager['runActionRoute']('/action/list_test_request');

    expect(app.appManager.selectedModel).toBe('test_request');
    expect(app.tableManager.selectedModel).toBe('test_request');
    expect(app.renderer.selectedModel).toBe('test_request');

    apiMock.getAction.and.resolveTo(makeResponse({
      mode: 'list',
      model: '',
      title: 'Test Request List',
      fields: { action_name: 'list_test_request' },
      columns: { rec_name: 'Record' },
      data: [{ rec_name: 'TR-2' }]
    }));

    await app.actionManager['runActionRoute']('/action/list_test_request');
    expect(app.appManager.selectedModel).toBe('test_request');
  });

  it('should extract fields from row.data inside buildTableRenderSubmission', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const rows = [
      {
        rec_name: 'row-1',
        data: {
          persona: 'Rossi Mario',
          stato: 'nuovo'
        }
      }
    ];
    const result = app.tableManager['buildTableRenderSubmission'](rows);
    expect(result).toEqual(jasmine.objectContaining({
      rec_name: 'row-1',
      persona: 'Rossi Mario',
      stato: 'nuovo'
    }));
  });

  describe('requireResponseObject', () => {
    it('should throw when payload is null', () => {
      expect(() => requireResponseObject(null)).toThrowError('Invalid ResponseObject');
    });

    it('should throw when payload is empty object', () => {
      expect(() => requireResponseObject({})).toThrowError('Invalid ResponseObject');
    });

    it('should throw when payload has no content field', () => {
      expect(() => requireResponseObject({ fail: false, message: '' })).toThrowError('Invalid ResponseObject');
    });

    it('should throw when content is not an object', () => {
      expect(() => requireResponseObject({ content: 'bad', fail: false, message: '' })).toThrowError('Invalid ResponseObject');
    });

    it('should throw when content is empty object (no mode)', () => {
      expect(() => requireResponseObject({ content: {}, fail: false, message: '' })).toThrowError('Invalid ResponseObject');
    });

    it('should throw when content.mode is empty string', () => {
      expect(() => requireResponseObject({ content: { mode: '' }, fail: false, message: '' })).toThrowError('Invalid ResponseObject');
    });

    it('should throw when content.mode is not a string', () => {
      expect(() => requireResponseObject({ content: { mode: 42 }, fail: false, message: '' })).toThrowError('Invalid ResponseObject');
    });

    it('should return the payload when content.mode is a non-empty string', () => {
      const payload = makeResponse({ mode: 'form' });
      expect(requireResponseObject(payload)).toBe(payload);
    });
  });
});
