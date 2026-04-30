# ozon-app-web

Frontend Angular (`@formio/angular`) per Ozon:
- lista modelli (`GET /models/distinct`)
- schema model (`GET /record/{model}`)
- lista record in streaming NDJSON (`POST /list/{model}`)
- apertura record con singola chiamata (`GET /record/{model}/{rec_name}` con `data + schema`)

## Setup

```bash
cd ozon-app-web
npm install
npm start
```

Build/Test in container Docker Node LTS (dal root progetto):

```bash
npm run install:angular:docker
npm run build:angular:docker
npm run test:angular:docker
```

Nota: nei container Angular le dipendenze vengono installate solo quando necessario
(`package-lock` cambiato o `node_modules` assente), quindi non vedrai warning npm ad ogni riavvio.

Per avvio integrato in rete backend Docker:

```bash
cd ..
BACKEND_DOCKER_NETWORK=nome_rete_backend ./angular-docker.sh start
```

Il compose usa e passa automaticamente il file `.env` del progetto root.

## Tema UI

L'app usa [design-angular-kit](https://github.com/italia/design-angular-kit/) con Bootstrap Italia:
- provider globale `provideDesignAngularKit()` in `src/app/app.config.ts`
- asset statici (`fonts`, `svg`, `i18n`) in `angular.json`
- stile base importato in `src/styles.scss` (`bootstrap-italia`)

## Config runtime

La UI non espone piu' la configurazione manuale in pagina.
Il runtime viene letto da:
- query string
- `window.__OZON_APP_CONFIG__`
- `localStorage` (`ozon-app-web.runtime`)

Per layout/menu action router e compatibilita' remote select vedi:
- `docs/ACTION_ROUTER_LAYOUT_MENU.md`
- `docs/REMOTE_SELECT_REQUEST.md`

Builder mode:
- toggle nel menu utente (header)
- abilita menu `admin`
- abilita editing schema con `form-builder` per azioni Design/Form|Resource

Auth Keycloak:
- `authMode=keycloak` abilita il bootstrap sessione tramite `GET /get_session`
- `ozon-formio` non costruisce mai `x-remote-user`: l'header trusted deve arrivare dal reverse proxy
- il token interno ritornato da `get_session` viene solo riallineato nel runtime locale
- login/logout restano endpoint configurabili del boundary proxy (`authLoginPath`, `authLogoutPath`)
- nessun polling continuo: la risincronizzazione avviene al bootstrap per non intasare il backend

Action router alignment:
- header menu letto da `layout.data.menu` (fallback `GET /action/menu`)
- click menu usa `url_action` come sorgente prioritaria del link
- grouping header per `menu_group` (anche con payload flat)
- card dashboard lette solo da `mode=card` (`GET /action/dashboard`)
- branding header letto da `layout.data.settings` (`module_name`, `app_version|version`, `logo|logo_img_url`)
- sessione utente da `GET /get_session` (nome/avatar/admin, gating builder toggle)
- URL pagina:
  - `/dashboard` dashboard card
  - `/action/list_*` tabella
  - `/action/form_*` form
  - `/action/next_action/{current_action}/{rec_name}` inviato al backend; in URL resta solo il redirect finale
    - risposta consigliata: `{"mode":"redirect","data":{"next_page":"/action/form_*/*"}}` con hard reload su `next_page`
  - `/action/next_action/{current_action}` idem per nuovo record (senza `rec_name`)

## Note API

`POST /list/{model}`: il client gestisce sia JSON sia `application/x-ndjson` a stream.
Per evitare CORS durante sviluppo Angular, il client usa `/api/*` e `ng serve` lo inoltra verso `backendurl` (generato in `proxy.conf.json` all'avvio).
