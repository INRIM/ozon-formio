# ozon-app-web

Angular 19 frontend that renders Form.io forms and data views driven by the Ozon backend API.

## Stack

- **Angular 19** (standalone components, no NgModules)
- **@formio/angular + @formio/js 5.3** — form rendering
- **PrimeNG 19** — table, button, input components
- **design-angular-kit / bootstrap-italia** — PA design system
- **ngx-angular-query-builder** — filter/query builder UI
- **@ngx-translate** — i18n
- TypeScript 5.6, Karma/Jasmine tests

## Dev commands

```bash
npm start        # serve on :4200, proxies /api → :7999
npm run build    # production build → dist/
npm test         # Karma, ChromeHeadless, single run
```

## Architecture

Single-component app. All rendering logic lives in `src/app/app.component.ts` (~4400 lines).  
Angular Router is **disabled** for initial navigation (`withDisabledInitialNavigation`) — routing is handled manually inside AppComponent via history API and the action-router response model.

### Core services (`src/app/core/`)

| Service | Role |
|---|---|
| `RuntimeConfigService` | Loads/persists config from `window.__OZON_APP_CONFIG__`, URL query params, localStorage, then `environment.ts`. Persists to `localStorage` key `ozon-app-web.runtime`. |
| `OzonApiService` | All HTTP calls to the backend. Configures Formio SDK base URL. Handles NDJSON streaming for list endpoints. Registers a Formio auth plugin to inject token headers. |
| `BackendAuthService` | Session sync + token refresh. Only active when `authMode === 'keycloak'`. |
| `MainManagerService` | Safe cross-origin navigation guard for `window.location.href` redirects. |

### Runtime config (`RuntimeConfig`)

Config is resolved in priority order: query param → `window.__OZON_APP_CONFIG__` → localStorage → `environment.ts` default.

Key fields:
- `backendUrl` — backend base URL
- `useProxy` — when `true`, all API calls go through `/api` (proxied to `backendUrl` by the dev server)
- `authMode` — `'none'` | `'keycloak'`
- `baseToken` / `tokenHeader` / `tokenPrefix` — bearer token config
- `authLoginPath` / `authLogoutPath` / `authRefreshPath` — auth endpoints

### API response model (`ResponseMode`)

Backend returns objects with `content.mode`:
`form` | `list` | `list_stream` | `layout` | `menu` | `card` | `redirect` | `action`

AppComponent switches rendering based on this mode.

### Proxy

Dev proxy (`proxy.conf.json`): `/api/*` → `http://localhost:7999/*` (strips `/api` prefix).  
Written at startup by `scripts/write-proxy-config.mjs` from env vars.

### Known quirks

- `getNextAction` has a fallback to `/actoin/` (typo path) for backend compatibility — do not fix.
- `OzonApiService.formioAuthPluginRegistered` is a static flag; plugin registers once per app lifetime.
- `streamList` retries with alternate payloads on HTTP 422.
- `fetchRaw` manually follows redirects for GET/HEAD (up to 6 hops); POST/DELETE get `redirect: manual`.
