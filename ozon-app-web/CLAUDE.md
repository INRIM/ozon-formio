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
- `sessionCacheTtlMs` — finestra minima tra due `GET /get_session` consecutive, default `30000`
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
- `installOzonInputmaskCompat()` (`src/app/formio/ozon-inputmask-compat.ts`, called first thing in `installFormioCompatibility()`) patches the **global** `Inputmask` singleton shared by the Form.io renderer and the `@formio/core` mask validator. Without it, a textfield whose `inputMask` is an *alias name* (`"mac"`, `"ip"`, `"email"`, …) renders fine and then rejects every value with "does not match the mask": the renderer does `new Inputmask("mac")`, where a bare string is treated as `options.alias` and resolved, while the validator does `Inputmask.isValid(value, { mask: "mac" })`, and `resolveAlias` only ever runs on `alias`. The patch wraps `isValid` to resolve alias names; literal masks pass through unchanged. It also registers `H` (one hex digit) and redefines the `mac` alias as `HH:HH:HH:HH:HH:HH` — same as the stock `##:##:##:##:##:##` minus `casing: 'upper'`, which is applied while typing but *not* inside `isValid` and so would reject lowercase MACs already stored in the backend. Two consequences: `H` is reserved globally, so any pre-existing mask using it as a literal character changes meaning; and **MAC addresses are no longer uppercased on entry**, so anything comparing them (DHCP / Snipe-IT sync) must be case-insensitive. The tolerant-validation / normalising-input trade-off is forced — `casing` at alias level makes `isValid` reject every value, at definition level `isValid` ignores it — and tolerance was chosen deliberately.
