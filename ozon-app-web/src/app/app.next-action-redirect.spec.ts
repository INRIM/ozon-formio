import { TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { AppComponent } from './app.component';
import { OzonApiService } from './core/ozon-api.service';
import { MainManagerService } from './core/main-manager.service';
import { BackendAuthService } from './core/backend-auth.service';
import { ResponseObject, ResponseObjectData } from './models/ozon.types';
import { GlobalErrorStateService } from './core/global-error-state.service';

const makeResponse = (content: Partial<ResponseObjectData>, fail = false, message = ''): ResponseObject => ({
  content: {
    mode: 'action',
    data: {},
    readable: true,
    editable: true,
    can_create: false,
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

describe('AppComponent next_action redirect mode', () => {
  let apiMock: jasmine.SpyObj<OzonApiService>;
  let mainManagerMock: jasmine.SpyObj<MainManagerService>;
  let backendAuthMock: jasmine.SpyObj<BackendAuthService>;

  beforeEach(async () => {
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getRuntimeConfig',
      'updateRuntimeConfig',
      'getNextAction',
      'getAction',
      'getActionLayout',
      'getActionMenu',
      'getActionDashboard',
      'getSession'
    ]);
    apiMock.getRuntimeConfig.and.returnValue({
      backendUrl: '',
      siteUrl: '',
      allowedOrigins: [],
      baseToken: '',
      useProxy: true,
      sessionCacheTtlMs: 30000,
      authMode: 'none' as const,
      authLoginPath: '/login',
      authLogoutPath: '/logout',
      authRefreshPath: '/refresh',
      appCode: ''
    });
    apiMock.updateRuntimeConfig.and.callFake(patch => ({ ...apiMock.getRuntimeConfig(), ...patch }));
    apiMock.getNextAction.and.resolveTo(makeResponse({
      mode: 'redirect',
      next_action_url: '/action/form_form_list_posizione/Gov.30459'
    }));
    apiMock.getAction.and.resolveTo(makeResponse({ mode: 'action', data: { status: 'ok' } }));
    apiMock.getActionLayout.and.resolveTo(makeResponse({ mode: 'layout', data: { layout: 'standard', schema: {}, menu: [] } }));
    apiMock.getActionMenu.and.resolveTo(makeResponse({ mode: 'menu', data: [] }));
    apiMock.getActionDashboard.and.resolveTo(makeResponse({ mode: 'card', data: [] }));
    apiMock.getSession.and.resolveTo([]);
    (apiMock as any).unauthorized$ = EMPTY;

    mainManagerMock = jasmine.createSpyObj<MainManagerService>('MainManagerService', [
      'hardReloadToUrl'
    ]);
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: '/action/form_form_list_posizione/Gov.30459'
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
    backendAuthMock.isEnabled.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: OzonApiService, useValue: apiMock },
        { provide: MainManagerService, useValue: mainManagerMock },
        { provide: BackendAuthService, useValue: backendAuthMock },
        GlobalErrorStateService
      ]
    }).compileComponents();
  });

  it('should hard reload using next_action_url when next_action returns mode redirect', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_posizione';

    await app.actionManager['runNextActionRoute'](['list_posizione', 'Gov.30459']);

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith(
      '/action/form_form_list_posizione/Gov.30459'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });
});
