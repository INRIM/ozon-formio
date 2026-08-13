import { RuntimeConfigService } from './runtime-config.service';

describe('RuntimeConfigService', () => {
  const storageKey = 'ozon-app-web.runtime';
  const originalAppConfig = window.__OZON_APP_CONFIG__;
  const originalUrl = `${window.location.pathname}${window.location.search}`;
  const defaultLogoUrl = 'https://www.inrim.it/sites/default/files/2022-04/logoinrimhp%20%281%29.svg';

  function seedStoredRuntime(appCode: string): void {
    window.localStorage.setItem(storageKey, JSON.stringify({
      backendUrl: '',
      siteUrl: '',
      allowedOrigins: [],
      useProxy: true,
      sessionCacheTtlMs: 30000,
      authMode: 'keycloak',
      authLoginPath: '/login',
      authLogoutPath: '/logout',
      authRefreshPath: '/refresh',
      appCode,
      appLogoUrl: ''
    }));
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.__OZON_APP_CONFIG__ = {};
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.localStorage.clear();
    window.__OZON_APP_CONFIG__ = originalAppConfig;
    window.history.replaceState({}, '', originalUrl || '/');
  });

  it('should prefer runtime app_code over a stored appCode', () => {
    seedStoredRuntime('stored-code');
    window.__OZON_APP_CONFIG__ = { app_code: 'runtime-code' };

    const service = new RuntimeConfigService();

    expect(service.getConfig().appCode).toBe('runtime-code');
  });

  it('should treat an empty runtime app_code as authoritative and clear a stored appCode', () => {
    seedStoredRuntime('stored-code');
    window.__OZON_APP_CONFIG__ = { app_code: '' };

    const service = new RuntimeConfigService();

    expect(service.getConfig().appCode).toBe('');
    expect(JSON.parse(window.localStorage.getItem(storageKey) || '{}').appCode).toBe('');
  });

  it('should use the INRiM logo as default app logo url', () => {
    const service = new RuntimeConfigService();

    expect(service.getConfig().appLogoUrl).toBe(defaultLogoUrl);
  });

  it('should prefer runtime APP_LOGO_URL over the default app logo url', () => {
    window.__OZON_APP_CONFIG__ = { APP_LOGO_URL: 'https://example.test/logo.svg' };

    const service = new RuntimeConfigService();

    expect(service.getConfig().appLogoUrl).toBe('https://example.test/logo.svg');
  });
});
