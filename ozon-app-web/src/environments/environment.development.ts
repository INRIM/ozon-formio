export const environment = {
  production: false,
  backendUrl: 'http://localhost:7999',
  siteUrl: '',
  allowedOrigins: [],
  baseToken: '',
  useProxy: true,
  sessionCacheTtlMs: 30000,
  authMode: 'keycloak',
  authLoginPath: '/api/login',
  authLogoutPath: '/api/logout',
  authRefreshPath: '/refresh'
};
