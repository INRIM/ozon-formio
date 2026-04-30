import { TestBed } from '@angular/core/testing';
import { BackendAuthService } from './backend-auth.service';
import { OzonApiService } from './ozon-api.service';
import { RuntimeConfigService } from './runtime-config.service';

describe('BackendAuthService', () => {
  let service: BackendAuthService;
  let apiMock: jasmine.SpyObj<OzonApiService>;
  let runtimeConfig: RuntimeConfigService;

  beforeEach(() => {
    window.localStorage.clear();
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getSession',
      'resolveApiUrl'
    ]);
    apiMock.resolveApiUrl.and.callFake((path: string) => `/api${String(path ?? '').replace(/^\/api/, '')}`);

    TestBed.configureTestingModule({
      providers: [
        RuntimeConfigService,
        { provide: OzonApiService, useValue: apiMock }
      ]
    });

    runtimeConfig = TestBed.inject(RuntimeConfigService);
    runtimeConfig.updateConfig({
      authLoginPath: '/login',
      authLogoutPath: '/logout',
      authRefreshPath: '/refresh',
      baseToken: ''
    });
    service = TestBed.inject(BackendAuthService);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should sync internal session token from get_session in keycloak mode', async () => {
    apiMock.getSession.and.resolveTo({
      uid: 'alice',
      token: 'kc-token',
      user: {
        uid: 'alice'
      }
    });

    const result = await service.bootstrap();
    const updated = runtimeConfig.getConfig();

    expect(result.authenticated).toBeTrue();
    expect(result.loginRequired).toBeFalse();
    expect(result.remoteUser).toBe('alice');
    expect(updated.baseToken).toBe('kc-token');
    expect(service.consumeSessionPayload()).toEqual({
      uid: 'alice',
      token: 'kc-token',
      user: {
        uid: 'alice'
      }
    });
    expect(service.consumeSessionPayload()).toBeNull();
  });

  it('should unwrap ozon-style session envelopes before storing token', async () => {
    apiMock.getSession.and.resolveTo({
      content: {
        data: {
          uid: 'bob',
          token: 'session-2'
        }
      }
    });

    const result = await service.bootstrap();

    expect(result.authenticated).toBeTrue();
    expect(result.remoteUser).toBe('bob');
    expect(runtimeConfig.getConfig().baseToken).toBe('session-2');
  });

  it('should ask for login when get_session returns unauthorized', async () => {
    apiMock.getSession.and.rejectWith(Object.assign(new Error('unauthorized'), { status: 401 }));

    const result = await service.bootstrap();

    expect(result.authenticated).toBeFalse();
    expect(result.loginRequired).toBeTrue();
    expect(result.redirectUrl).toBe('/api/login');
    expect(runtimeConfig.getConfig().baseToken).toBe('');
  });

  it('should clear token and expose logout navigation url', () => {
    runtimeConfig.updateConfig({ baseToken: 'kc-token' });

    const result = service.logout();

    expect(result.redirectUrl).toBe('/api/logout');
    expect(runtimeConfig.getConfig().baseToken).toBe('');
  });
});
