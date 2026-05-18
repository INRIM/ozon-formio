import { TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { AppComponent } from './app.component';
import { OzonApiService } from './core/ozon-api.service';
import { MainManagerService } from './core/main-manager.service';
import { BackendAuthService } from './core/backend-auth.service';
import { ListRequestPayload } from './models/ozon.types';

const runtimeConfig = {
  backendUrl: '',
  siteUrl: '',
  allowedOrigins: [] as string[],
  baseToken: '',
  useProxy: true,
  sessionCacheTtlMs: 30000,
  authMode: 'none' as const,
  authLoginPath: '/login',
  authLogoutPath: '/logout',
  authRefreshPath: '/refresh'
};

describe('AppComponent', () => {
  let apiMock: jasmine.SpyObj<OzonApiService>;
  let mainManagerMock: jasmine.SpyObj<MainManagerService>;
  let backendAuthMock: jasmine.SpyObj<BackendAuthService>;

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
    apiMock.getActionLayout.and.resolveTo({ mode: 'layout', data: { layout: 'standard', schema: {}, menu: [] } });
    apiMock.getActionMenu.and.resolveTo({ mode: 'menu', data: [] });
    apiMock.getActionDashboard.and.resolveTo({ mode: 'card', data: [] });
    apiMock.getAction.and.resolveTo({ mode: 'action', data: { status: 'ok' } });
    apiMock.getNextAction.and.resolveTo({ mode: 'action', data: { redirect: 'form_form_demo/rec-1' } });
    apiMock.getExportData.and.resolveTo({ content: { data: [] } });
    apiMock.getSchemaModel.and.resolveTo({ fields: ['rec_name'], schema: { properties: { rec_name: { type: 'string' } } } });
    apiMock.getResourceData.and.resolveTo({ content: { data: [] } });
    apiMock.postAction.and.resolveTo({ mode: 'action', data: { status: 'ok' } });
    apiMock.deleteAction.and.resolveTo({ mode: 'action', data: { status: 'ok' } });
    apiMock.getRecordSchema.and.resolveTo({});
    apiMock.getRecord.and.resolveTo({ content: { data: { rec_name: 'r1' } } });
    apiMock.updateRecord.and.resolveTo({ content: { data: { rec_name: 'r1' } } });
    apiMock.importData.and.resolveTo({ status: 'done', ok: 0 });
    apiMock.postActionPath.and.resolveTo({ mode: 'action', data: { status: 'ok' } });
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
    apiMock.getRecordSchema.and.resolveTo({
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
    });
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
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        mode: 'form',
        schema: [
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
        ]
      }
    });

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
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'select',
          key: 'country',
          properties: {
            url: 'https://remote.example/api/countries'
          }
        }
      ]
    });
    apiMock.getRecord.and.resolveTo({
      content: {
        data: {
          rec_name: 'r1',
          country: 'IT'
        }
      }
    });
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
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'select',
          key: 'customer_id',
          properties: {
            src: 'url',
            model: 'customer',
            domain: { active: true },
            compute_label: 'name'
          }
        }
      ]
    });
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
          id: 'id'
        })
      })
    );
  });

  it('should hydrate resource select values from streamed list endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'select',
          key: 'partner_id',
          dataSrc: 'resource',
          data: {
            resource: 'res.partner'
          }
        }
      ]
    });
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
      jasmine.objectContaining({ label: 'Partner A', value: '1', data: jasmine.objectContaining({ _id: '1', rec_name: 'Partner A' }) }),
      jasmine.objectContaining({ label: 'Partner B', value: '2', data: jasmine.objectContaining({ _id: '2', rec_name: 'Partner B' }) })
    ]);
  });

  it('should map remote select backend kv payload to label/value options', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'select',
          key: 'fornitore',
          properties: {
            url: 'https://remote.example/api/vendors'
          }
        }
      ]
    });
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
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'select',
          key: 'user_id',
          dataSrc: 'resource',
          data: {
            resource: 'auth.user'
          }
        }
      ]
    });
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
        value: '69f48d7c1eaec1bc77c2fcae',
        data: jasmine.objectContaining({
          rec_name: 'a.gerace',
          data_value: jasmine.objectContaining({ rec_name: 'a.gerace' })
        })
      })
    ]);
  });

  it('should defer record form remote select hydration until the viewer ready event', async () => {
    apiMock.getRecordSchema.and.resolveTo({
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
    });
    apiMock.getRecord.and.resolveTo({
      content: {
        data: {
          rec_name: 'REC-1',
          country: 'IT'
        }
      }
    });
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
    apiMock.getActionMenu.and.resolveTo({
      mode: 'menu',
      data: [
        {
          Main: [
            { label: 'Apri Anagrafica', content: '/action/open_anagrafica', action_type: 'window', icon: 'pi pi-folder' }
          ]
        }
      ]
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionMenu();

    expect(app.appManager.dashboardMenu.length).toBe(1);
    expect(app.appManager.dashboardMenu[0].title).toBe('Main');
    expect(app.appManager.dashboardMenu[0].group_id).toBe('Main');
    expect(app.appManager.dashboardMenu[0].buttons[0].url_action).toBe('/action/open_anagrafica');
  });

  it('should group flat menu payload by menu_group', async () => {
    apiMock.getActionMenu.and.resolveTo({
      mode: 'menu',
      data: [
        { menu_group: 'Config', label: 'Utenti', url_action: '/action/list_utenti', action_type: 'window' },
        { menu_group: 'Config', label: 'Ruoli', url_action: '/action/list_ruoli', action_type: 'window' },
        { menu_group: 'Documenti', label: 'Ordini', url_action: '/action/list_ordini', action_type: 'window' }
      ]
    });

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
    apiMock.getActionMenu.and.resolveTo({
      mode: 'menu',
      data: [
        { parent: 'Admin', menu_group: 'Config', label: 'Utenti', url_action: '/action/list_utenti', action_type: 'window' },
        { parent: 'Admin', menu_group: 'Config', label: 'Ruoli', url_action: '/action/list_ruoli', action_type: 'window' },
        { parent: 'Admin', menu_group: 'Documenti', label: 'Ordini', url_action: '/action/list_ordini', action_type: 'window' }
      ]
    });

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
    apiMock.getActionMenu.and.resolveTo({
      mode: 'menu',
      data: {
        Design: [
          { key: 'design', label: 'Design', action_type: 'menu', url_action: '' },
          { key: 'list_form', label: 'Form', action_type: 'menu', url_action: 'list_form' },
          { key: 'list_resource', label: 'Resource', action_type: 'menu', url_action: '/action/list_resource' },
          { key: 'list_layout', label: 'Layout', action_type: 'menu', url_action: '/action/list_layout' }
        ]
      }
    });

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
    apiMock.getAction.and.resolveTo({
      mode: 'action',
      data: {
        redirect: '/action/form_form_doc_bene_servizi/ORDINE132873',
        redirect_status: 307
      }
    });
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
        return Promise.resolve({
          mode: 'action',
          data: {
            redirect: '/action/form_form_doc_bene_servizi/ORDINE132873',
            redirect_status: 302
          }
        });
      }

      if (name === 'form_form_doc_bene_servizi') {
        return Promise.resolve({
          mode: 'form',
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
        });
      }

      return Promise.resolve({ mode: 'action', data: { status: 'ok' } });
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      await app.actionManager["runActionRoute"]('/action/list_doc_beni_servizi/ORDINE132873');
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(mainManagerMock.hardReloadToUrl).not.toHaveBeenCalled();
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
    apiMock.getAction.and.resolveTo({
      mode: 'form',
      data: {
        rec_name: 'ORDINE63423',
        stato: 'bozza'
      }
    });
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'stato', label: 'Stato', input: true }
      ]
    });

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

  it('should parse action form schema/data from payload envelope', async () => {
    apiMock.getAction.and.resolveTo({
      mode: 'form',
      payload: {
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
      }
    } as any);

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

  it('should parse action form schema/data from nested action wrapper payload', async () => {
    apiMock.getAction.and.resolveTo({
      mode: 'action',
      data: {
        payload: {
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
        }
      }
    } as any);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63423');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    expect(app.viewMode).toBe('form');
    expect(app.formSchema).toBeTruthy();
    expect(app.formSubmission?.data?.stato).toBe('bozza');
    expect(app.selectedRecordName).toBe('ORDINE63423');
  });

  it('should prefer payload schema over deep inherited form nodes without schema', async () => {
    apiMock.getAction.and.resolveTo({
      mode: 'action',
      data: {
        payload: {
          schema: [
            { type: 'textfield', key: 'from_payload', label: 'From Payload', input: true }
          ],
          data: {
            rec_name: 'ORDINE63423',
            stato: 'bozza',
            data: {
              data: {
                data: {
                  data: {
                    data: {
                      data: {
                        data: {
                          data: {
                            data: {
                              data: {
                                data: {
                                  data: {
                                    data: {
                                      value: 'deep-node'
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } as any);
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'from_model', label: 'From Model', input: true }
      ]
    });

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
    expect(app.formSchema?.components?.[0]?.key).toBe('from_payload');
  });

  it('should parse action form schema/data when payload fields are JSON strings', async () => {
    const actionResponse = {
      mode: 'form',
      payload: {
        schema: JSON.stringify({
          display: 'form',
          components: [
            { type: 'textfield', key: 'stato', label: 'Stato', input: true }
          ]
        }),
        data: JSON.stringify({
          rec_name: 'ORDINE63423',
          stato: 'bozza'
        })
      }
    } as any;

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

  it('should promote nested data_value fields to root in action form submission', async () => {
    apiMock.getAction.and.resolveTo({
      mode: 'form',
      schema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'document_type', label: 'Tipo Documento', input: true }
        ]
      },
      data: {
        rec_name: 'ORDINE63424',
        data_value: {
          document_type: 'DDT_ENTRATA',
          stato: 'bozza'
        }
      }
    } as any);

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
    expect((app.formSubmission?.data?.data_value as Record<string, unknown>)?.['document_type']).toBe('DDT_ENTRATA');
    expect(app.selectedRecordName).toBe('ORDINE63424');
  });

  it('should expose root form fields under data_value compatibility alias', async () => {
    apiMock.getAction.and.resolveTo({
      mode: 'form',
      schema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'document_type', label: 'Tipo Documento', input: true }
        ]
      },
      data: {
        rec_name: 'ORDINE63425',
        document_type: 'DDT_RESO',
        stato: 'bozza'
      }
    } as any);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const originalPath = window.location.pathname;

    try {
      window.history.replaceState({}, '', '/action/form_form_doc_bene_servizi/ORDINE63425');
      await app.actionManager["handleLocationRoute"](false);
    } finally {
      window.history.replaceState({}, '', originalPath || '/');
    }

    const dataValue = app.formSubmission?.data?.data_value as Record<string, unknown>;
    expect(app.viewMode).toBe('form');
    expect(dataValue?.['document_type']).toBe('DDT_RESO');
    expect(dataValue?.['stato']).toBe('bozza');
  });

  it('should request next_action on table row double click using current action and rec_name', async () => {
    apiMock.getNextAction.and.resolveTo({
      mode: 'action',
      data: {
        redirect: 'form_form_list_posizione/Gov.30459'
      }
    });

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

  it('should resolve next_action redirect through canonical action route even when embedded content is present', async () => {
    apiMock.getAction.and.callFake((name: string) => {
      if (name === 'form_form_list_posizione') {
        return Promise.resolve({
          mode: 'form',
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
        });
      }
      return Promise.resolve({ mode: 'action', data: { status: 'ok' } });
    });

    apiMock.getNextAction.and.resolveTo({
      mode: 'action',
      data: {
        redirect: '/action/form_form_list_posizione/Gov.30459'
      },
      content: {
        mode: 'form',
        data: {
          rec_name: 'Gov.30459',
          stato: 'bozza'
        },
        schema: {
          display: 'form',
          components: [
            { type: 'textfield', key: 'stato', label: 'Stato', input: true }
          ]
        }
      }
    } as any);

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
    apiMock.getNextAction.and.resolveTo({
      mode: 'action',
      data: {
        redirect: 'http://localhost:7999/action/form_form_list_posizione/Gov.30459',
        redirect_status: 307
      }
    });
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
      '/action/form_form_list_posizione/Gov.30459'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });

  it('should ignore next_action path hints and hard reload using 307 redirect path', async () => {
    apiMock.getNextAction.and.resolveTo({
      mode: 'action',
      path: '/action/next_action/list_doc_beni_servizi/ORDINE63417',
      next_action: 'next_action/list_doc_beni_servizi/ORDINE63417',
      data: {
        redirect: '/action/form_form_doc_bene_servizi/ORDINE63417',
        redirect_status: 307
      }
    } as any);
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
    expect(mainManagerMock.hardReloadToUrl).not.toHaveBeenCalledWith(
      '/action/next_action/list_doc_beni_servizi/ORDINE63417'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });

  it('should request next_action without rec_name for nuovo record', async () => {
    apiMock.getNextAction.and.resolveTo({
      mode: 'action',
      data: {
        redirect: 'fom_form_list_posizione/'
      }
    });

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

  it('should show Aggiorna and Abbandona when form config enables cancel button', () => {
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
    expect(labels).toContain('Abbandona');
  });

  it('should hide submit and keep Abbandona when no_submit is enabled', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.viewMode = 'form';
    app.appManager.selectedModel = 'ordine';
    app.actionManager.currentActionName = 'list_ordini';
    app.renderer.formSchema = {
      display: 'form',
      no_cancel: '0',
      no_submit: '1',
      components: []
    };
    app.renderer.rawFormSchema = app.renderer.formSchema;
    app.renderer.formSubmission = { data: { rec_name: 'NEW-1' } };

    const labels = app.currentFormActionButtons.map((button: any) => button.label);

    expect(labels).not.toContain('Salva');
    expect(labels).not.toContain('Aggiorna');
    expect(labels).toContain('Abbandona');
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

  it('should load dashboard cards only from mode card payload', async () => {
    apiMock.getActionDashboard.and.resolveTo({
      mode: 'card',
      data: [
        {
          group_id: 'docs',
          title: 'Documenti',
          buttons: [
            { label: 'Lista', content: '/action/list_documenti', action_type: 'window', icon: 'pi pi-list' }
          ]
        }
      ]
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.actionManager.loadActionDashboard();

    expect(app.appManager.dashboardCards.length).toBe(1);
    expect(app.nonAdminDashboardCards.length).toBe(1);
    expect(app.appManager.dashboardCards[0].title).toBe('Documenti');
  });

  it('should show cards only for non-admin menus and gate admin menus by builder flag', () => {
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
    app.appManager.builderEnabled = false;

    expect(app.showTopMenu).toBeFalse();

    app.onBuilderSwitchChanged(true);
    expect(app.showTopMenu).toBeTrue();
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

    await app.actionManager.applyActionResponse({
      mode: 'list',
      fields: {
        in_form: true,
        enable_copy: true,
        enable_remove: false
      },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    });

    expect(app.showTableRowCopyAction).toBeTrue();
    expect(app.showTableRowRemoveAction).toBeFalse();
    expect(app.tableExtraColumnCount).toBe(3);

    await app.actionManager.applyActionResponse({
      mode: 'list',
      fields: {
        in_form: true,
        enable_copy: true,
        enable_remove: true
      },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    });

    expect(app.showTableRowCopyAction).toBeTrue();
    expect(app.showTableRowRemoveAction).toBeTrue();
    expect(app.tableExtraColumnCount).toBe(4);

    await app.actionManager.applyActionResponse({
      mode: 'list',
      fields: {
        in_form: false,
        enable_copy: true,
        enable_remove: true
      },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    });

    expect(app.showTableRowCopyAction).toBeFalse();
    expect(app.showTableRowRemoveAction).toBeFalse();
    expect(app.tableExtraColumnCount).toBe(2);
  });

  it('should enable table row copy/remove when action urls are provided in table config', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      fields: {
        in_form: true,
        table_action: {
          copy_url: '/action/copy_documento',
          remove_url: '/action/remove_documento'
        }
      },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'rec-1' }]
    });

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

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: {
        items: [{ rec_name: 'rec-1' }],
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
      }
    });

    const query = app.tableManager.parseQueryInput((_m: string, _e: boolean) => {});
    expect(query).toEqual({ stato: 'APERTO' });
  });

  it('should reconstruct import and export tools from list permissions when toolbar schema is absent', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_component';

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'component',
      can_create: true,
      editable: true,
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: {
        items: [{ rec_name: 'rec-1' }]
      }
    });

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
      { mode: 'layout', data: { layout: 'standard', schema: {}, menu: [], settings: { user: 'admin' } } },
      (p: unknown) => p as any,
      (_d: unknown) => [],
      (s: Record<string, unknown>) => ({ ...s }),
      []
    );

    expect(app.appManager.currentUserName).toBe('Mario Rossi');
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

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [
        ['rec_name', 'Record'],
        ['created_at', 'Creato il']
      ],
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
    });

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

  it('should hide builder toggle when session.is_admin is false', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          name: 'Mario Rossi',
          is_admin: false,
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

  it('should open eligible design form actions in viewer mode even when builder is on', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.builderEnabled = true;

    await app.actionManager.applyActionResponse({
      mode: 'form',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    });

    expect(app.builderMode).toBeFalse();
    expect(app.showFormBuilder).toBeFalse();
    expect(app.canEditCurrentForm).toBeTrue();
  });

  it('should enter builder mode only after explicit user action', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.appManager.builderEnabled = true;

    await app.actionManager.applyActionResponse({
      mode: 'form',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    });

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

    await app.actionManager.applyActionResponse({
      mode: 'form',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo' },
      schema: { display: 'form', components: [] }
    });

    app.enableFormBuilderMode();
    expect(app.builderMode).toBeTrue();

    await app.actionManager.applyActionResponse({
      mode: 'form',
      fields: { component_type: 'form', action_name: 'design_form' },
      data: { rec_name: 'component.form.demo.2' },
      schema: { display: 'form', components: [] }
    });

    expect(app.builderMode).toBeTrue();
    expect(app.showFormBuilder).toBeTrue();
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
      {
        mode: 'form',
        fields: { component_type: 'form', action_name: 'design_form' },
        data: { rec_name: 'component.form.demo' },
        schema: { display: 'form', components: [] }
      },
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

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [
        ['rec_name', 'Record'],
        ['stato', 'Stato']
      ],
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
    });

    expect(Array.from((app.tableManager as any).tableCellRenderers.keys())).toContain('stato');
    expect(app.displayCell(app.tableRows[0], 'stato')).toBe('Confermato');
  });

  it('should render remote select labels in list table after schema hydration', async () => {
    apiMock.getRemoteSelect.and.resolveTo([{ label: 'Italia', value: 'IT' }]);

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'anagrafica',
      columns: [
        ['rec_name', 'Record'],
        ['country', 'Country']
      ],
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
    });

    await app.tableManager.warmTableCellRenderers(app.tableManager.allRows);
    expect(apiMock.getRemoteSelect).toHaveBeenCalled();
    expect(app.displayCell(app.tableRows[0], 'country')).toBe('Italia');
  });

  it('should fallback to model schema to render select labels in action lists without inline schema', async () => {
    apiMock.getRecordSchema.and.resolveTo({
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
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'anagrafica',
      columns: [
        ['ruoli_sicurezza', 'Ruoli Sicurezza'],
        ['classificazione', 'Classificazione']
      ],
      total_count: 1,
      data: [
        {
          rec_name: 'ANA-1',
          classificazione: 'personale_tecnico',
          ruoli_sicurezza: ['anti_incendio', 'emergenza_sanitaria', 'emergenza']
        }
      ]
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock.getRecordSchema).toHaveBeenCalledWith('anagrafica');
    expect(app.displayCell(app.tableRows[0], 'classificazione')).toBe('Personale tecnico');
    expect(app.displayCell(app.tableRows[0], 'ruoli_sicurezza')).toBe('Antincendio, Emergenza sanitaria, Emergenza');
  });

  it('should render select labels in list table when schema is nested in data envelope', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [
        ['rec_name', 'Record'],
        ['stato', 'Stato']
      ],
      total_count: 1,
      data: {
        data: [
          {
            rec_name: 'ORD-2',
            stato: 'DRAFT'
          }
        ],
        schema: JSON.stringify({
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
        })
      }
    });

    expect(app.displayCell(app.tableRows[0], 'stato')).toBe('Bozza');
  });

  it('should render datetime values in list table using form component metadata', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [
        ['rec_name', 'Record'],
        ['created_at', 'Creato il']
      ],
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
    });

    const rendered = app.displayCell(app.tableRows[0], 'created_at');
    expect(rendered).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(rendered).toContain(':');
  });

  it('should fallback to record data_value when root field is missing in list rows', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'ordine',
      columns: [
        ['rec_name', 'Record'],
        ['stato', 'Stato']
      ],
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
          data_value: {
            stato: 'CONF'
          }
        }
      ]
    });

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

  it('should ignore deprecated table filter text when building server-side query payload', async () => {
    apiMock.streamList.and.callFake(async (_model, payload, _onItem, _onMeta) => {
      expect(payload.query).toEqual({
        stato: 'APERTO'
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

  it('should render fast search config from list action response and keep action reload as default', async () => {
    const fastSearchConfig = {
      schema: [
        { type: 'textfield', key: 'name', label: 'Nome' },
        { type: 'button', action: 'submit', label: 'Submit', key: 'submit' }
      ]
    };
    const listResponse = {
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      fast_search: fastSearchConfig,
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    };

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

    apiMock.getAction.and.resolveTo({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    });

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: [['rec_name', 'Record']],
      total_count: 0,
      data: { meta: true }
    });
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
        return {
          mode: 'list',
          model: 'customer',
          fields: { action_name: 'list_customers' },
          columns: [['rec_name', 'Record']],
          total_count: 2,
          data: [{ rec_name: 'PRIME-ROW' }]
        };
      }
      if (options.limit === 20) {
        return {
          mode: 'list',
          model: 'customer',
          fields: { action_name: 'list_customers' },
          columns: [['rec_name', 'Record']],
          total_count: 2,
          data: [{ rec_name: 'CUST-1' }, { rec_name: 'CUST-2' }]
        };
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

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    });

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

    await app.actionManager.applyActionResponse({
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
      columns: [['rec_name', 'Record']],
      total_count: 1,
      data: [{ rec_name: 'CUST-1' }]
    });

    expect(app.viewMode).toBe('list');
    expect(app.tableRows.length).toBe(1);
    expect(tableWarmupSpy).toHaveBeenCalled();
  });

  it('should resolve list navigation without waiting for background record bootstrap', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const pendingLoad = new Promise<void>(() => undefined);

    spyOn(app.actionManager, 'loadRecords').and.returnValue(pendingLoad);

    await app.actionManager.applyActionResponse({
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      columns: [['rec_name', 'Record']],
      total_count: 0,
      data: { meta: true }
    });

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
    const listResponse = {
      mode: 'list',
      model: 'customer',
      fields: { action_name: 'list_customers' },
      fast_search: {
        schema: [{ type: 'textfield', key: 'name', label: 'Nome' }]
      },
      columns: null,
      total_count: 1,
      data: [{ rec_name: 'CUST-BASE', name: 'Base' }]
    };

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
    expect(app.tableColumns.map((column: any) => column.field)).toEqual(['__rec_name', 'name']);
  });

  it('should normalize formio table components in schema', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        {
          type: 'table',
          key: 'tabella1'
        }
      ]
    });

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

    await expectAsync(app.actionManager['applyActionResponse']({
      fail: true,
      message: 'Errore business',
      content: {
        mode: 'action',
        data: {}
      }
    })).toBeRejectedWithError('Errore business');
  });

  it('should load form schema from canonical response envelope content', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      fail: false,
      message: '',
      content: {
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
      }
    });

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
    apiMock.getRecord.and.resolveTo({
      content: {
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
      }
    });

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.appManager.isAdminUser = true;
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
});
