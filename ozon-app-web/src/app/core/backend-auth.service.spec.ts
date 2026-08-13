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
      'clearSessionCache',
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
      sessionCacheTtlMs: 30000
    });
    service = TestBed.inject(BackendAuthService);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should authenticate from uid without ever syncing a session token (BE-2/BE-5)', async () => {
    apiMock.getSession.and.resolveTo({
      uid: 'alice',
      // Backend guarantees /get_session never exposes a token (BE-2). Included here
      // defensively: even if a token field showed up, the frontend must not store it.
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
    expect('baseToken' in updated).toBeFalse();
    expect(service.consumeSessionPayload()).toEqual({
      uid: 'alice',
      token: 'kc-token',
      user: {
        uid: 'alice'
      }
    });
    expect(service.consumeSessionPayload()).toBeNull();
  });

  it('should unwrap ozon-style session envelopes without storing any token', async () => {
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
    expect('baseToken' in runtimeConfig.getConfig()).toBeFalse();
  });

  it('should ask for login when get_session returns unauthorized', async () => {
    apiMock.getSession.and.rejectWith(Object.assign(new Error('unauthorized'), { status: 401 }));

    const result = await service.bootstrap();

    expect(result.authenticated).toBeFalse();
    expect(result.loginRequired).toBeTrue();
    expect(result.redirectUrl).toBe(`${window.location.origin}/login`);
    expect('baseToken' in runtimeConfig.getConfig()).toBeFalse();
  });

  it('should ask for login when get_session resolves to non-session payload', async () => {
    apiMock.getSession.and.resolveTo('<html>keycloak login</html>');

    const result = await service.bootstrap();

    expect(result.authenticated).toBeFalse();
    expect(result.loginRequired).toBeTrue();
    expect(result.redirectUrl).toBe(`${window.location.origin}/login`);
    expect(service.consumeSessionPayload()).toBeNull();
  });

  it('should clear session state and expose logout navigation url', () => {
    const result = service.logout();

    expect(result.redirectUrl).toBe(`${window.location.origin}/logout`);
    expect(result.authenticated).toBeFalse();
    expect(apiMock.clearSessionCache).toHaveBeenCalled();
  });

  it('should force get_session on explicit refresh', async () => {
    apiMock.getSession.and.resolveTo({
      uid: 'alice',
      token: 'kc-token'
    });

    const result = await service.refresh();

    expect(result.authenticated).toBeTrue();
    expect(apiMock.getSession).toHaveBeenCalledOnceWith({ force: true });
  });
});
