# Piano di Refactoring — Migrazione a React + Form.io + Bootstrap Italia

> Stato: proposta / analisi completa
> Scope: `ozon-app-web` (client web che renderizza form Form.io e viste dati guidate dal backend Ozon)
> Target: **React** + **Form.io** (`@formio/react` + `@formio/js`) + **Bootstrap Italia v2** (`design-react-kit` + `bootstrap-italia`)
> Riferimento design system: https://italia.github.io/bootstrap-italia/docs/come-iniziare/introduzione/

---

## 1. Executive summary

L'app attuale è **Angular 19** (standalone components, no NgModules). Renderizza form e liste **guidate dal backend**: il server risponde con oggetti che hanno `content.mode` (`form | list | list_stream | layout | menu | card | redirect | action`) e il client decide cosa mostrare.

**Tesi centrale del refactoring:** la parte di *valore* di questo codebase — la logica di normalizzazione degli schemi Form.io, l'hydration delle select remote, la gestione query/liste, il modello di routing ad azioni, il layer HTTP con streaming NDJSON — è **TypeScript quasi puro, framework-agnostico**. Il coupling con Angular è sottile (solo `@Injectable`/`inject` e un paio di `Subject` RxJS). Quindi la migrazione a React è **soprattutto la sostituzione del guscio** (componenti, DI, template, change-detection) mantenendo il *core* logico.

Questo abbassa drasticamente rischio ed effort: **non si riscrive la business logic, si ri-incapsula.**

### Obiettivi
- Stessa UX e stesso contratto col backend (nessuna modifica server necessaria).
- Stack React moderno (Vite, React 18/19, hooks/store) più leggero di Angular per questo tipo di app single-view.
- Bootstrap Italia v2 come design system, via `design-react-kit` dove servono componenti, `bootstrap-italia` per CSS/asset.
- Form.io via `@formio/react` mantenendo **tutte** le personalizzazioni già fatte (template file BI, evaluator patch, logica logic/var, cache select, ecc.).

### Non-obiettivi
- Riscrivere il backend o cambiare il modello risposte (`content.mode`).
- Cambiare il comportamento funzionale dei form (logic, azioni, camunda, upload).
- Migrare a una libreria di form diversa da Form.io.

---

## 2. Architettura attuale (mappa)

### 2.1 Guscio Angular
| File | Ruolo | LOC |
|---|---|---:|
| `app.component.ts` + `.html` | Unico componente-vista. Switcha su `viewMode`/`mode`. Routing manuale via History API. | ~417 |
| `app.config.ts`, `app.routes.ts` | Bootstrap standalone; **router con initial navigation disabilitata**. | — |

### 2.2 Manager services (stato + logica) — *il cuore, framework-agnostico al 90%*
| File | Ruolo | LOC | Coupling Angular |
|---|---|---:|---|
| `app-action-manager.service.ts` | Routing ad azioni, esecuzione azioni/pulsanti, POST, redirect, modale conferma, download allegati, camunda. | 2610 | `@Injectable`, 1 `Subject` |
| `app-table-manager.service.ts` | Liste, query builder → Mongo, filtri, fast search, paginazione, export/import, tipi campo. | 2565 | `@Injectable` |
| `app-formio-renderer.service.ts` | Normalizzazione schema Form.io al render (logic/var alias, file, select, wysiwyg, default), hydration select remote + **cache TTL**, loader. | 1304 | `@Injectable` |
| `app-formio-builder.service.ts` | Modalità builder, config palette, draft schema. | 467 | `@Injectable`, 1 `Subject` |
| `app-manager.service.ts` | Stato sessione/utente, `evalContext`, menu, dashboard, runtime. | 526 | `@Injectable` |
| `app-theme.service.ts` | Tema chiaro/scuro. | — | `@Injectable` |

### 2.3 Core (HTTP, config, auth, util)
| File | Ruolo |
|---|---|
| `core/ozon-api.service.ts` | **Tutte** le chiamate HTTP. Streaming NDJSON per liste. Plugin auth Form.io (inietta token). Follow redirect manuale. Download blob autenticato. |
| `core/runtime-config.service.ts` | Risoluzione config: query param → `window.__OZON_APP_CONFIG__` → localStorage → `environment`. |
| `core/backend-auth.service.ts` | Sync sessione + refresh token (Keycloak). |
| `core/main-manager.service.ts` | Guard navigazione cross-origin. |
| `core/websocket-actions.service.ts` | Azioni via WebSocket. |
| `core/global-error-handler.ts` + `global-error-state.service.ts` | Error handling globale. |
| `core/url.service.ts`, `core/utils.ts`, `core/select-option.util.ts` | Utility pure. |

### 2.4 Integrazione Form.io
| File | Ruolo |
|---|---|
| `formio/ozon-form-builder.ts` | `OzonFormBuilder extends FormBuilder`; plugin "projectless". |
| `formio/ozon-form-builder-host.component.ts` | Wrapper Angular che monta/distrugge il builder imperativo. |
| `formio/formio-compat.ts` | Patch evaluator (legacy args), `window.Quill`, **override template `file` (BI v2)**. |
| `formio/ozon-file-template.ts` | Template Bootstrap Italia v2 per il componente file. |
| `formio/ozon-json-editor-formio.ts` | Componente JSON editor custom. |
| `formio/formio-builder-config.ts` | Palette builder (basic/advanced/data/process/layout…). |

### 2.5 Liste
`list/record-list.component.ts` (+ cards, table CDK, datasource, transfer-tools): tabella PrimeNG, filtri, fast search, export/import.

### 2.6 UI / dipendenze rilevanti
`@formio/angular ^9` + `@formio/js 5.3`, **PrimeNG 19** (table, dialog, editor, inputswitch, datepicker), **design-angular-kit 19** + **bootstrap-italia 2.13**, ngx-bootstrap, `@ngx-translate`, `@angular/cdk`, `json-logic-js`, `quill`.

---

## 3. Stack target (React)

| Layer | Angular oggi | React target | Note |
|---|---|---|---|
| Build | Angular CLI (esbuild) | **Vite** | HMR veloce, config semplice, proxy `/api` nativo. |
| Componenti | Standalone components + template HTML | Componenti funzionali + JSX | — |
| DI / servizi | `@Injectable` + `inject()` | **Context + hook** o store (**Zustand**) | I manager diventano store/moduli TS. |
| Stato reattivo | Campi mutabili + change detection | **Zustand** (store) / `useSyncExternalStore` | I manager tengono stato: mapparli su store è naturale. |
| RxJS `Subject` | 2 punti (`formBuilderRebuild$`, `unauthorized$`) | Event emitter leggero / callback / store event | Coupling minimo. |
| Routing | Router disabilitato + History API manuale | **Stessa logica manuale** (già framework-agnostic) o `react-router` per l'URL bar | Il modello action-router resta. |
| Form | `@formio/angular` | **`@formio/react`** (`<Form>`, `<FormBuilder>`) | ⚠️ Riuso personalizzazioni **da verificare** (vedi Gate G1): dipende dal fatto che `@formio/react` usi lo stesso `@formio/js` globale che le patch modificano. |
| Design system | `design-angular-kit` + bootstrap-italia | **`design-react-kit`** + bootstrap-italia | Port React ufficiale Italia. Stesso CSS/asset. |
| Tabella | PrimeNG Table | **PrimeReact** DataTable (o TanStack Table) | PrimeReact = stesso ecosistema, meno riscrittura mentale. Valutare TanStack se si vuole meno peso. |
| Dialog/inputs | PrimeNG | PrimeReact / design-react-kit | — |
| i18n | `@ngx-translate` | **react-i18next** | Riuso file di traduzione. |
| WYSIWYG | Quill (via Form.io) | Quill (via Form.io) | Invariato: gestito da Form.io. |

> **design-react-kit** è il corrispettivo React di `design-angular-kit` (stesso team Designers Italia), quindi la parità di componenti BI è alta. `bootstrap-italia` (CSS + sprite SVG) resta identico e già lo usiamo direttamente.

---

## 4. Mappatura Angular → React, layer per layer

### 4.1 Manager services → store/moduli TS
I manager sono classi con stato + metodi su oggetti puri. Due strade:

**A) Store Zustand per-dominio** (consigliata). Un file `store/*.ts` per manager. I metodi diventano azioni dello store; i campi diventano stato. La logica interna (pura) si copia quasi verbatim.

**B) Classi TS + Context.** Si tengono le classi così come sono, si istanziano una volta e si passano via React Context; i componenti si ri-renderizzano tramite un `useSyncExternalStore` che osserva un "version counter". Meno idiomatico ma **conversione quasi meccanica** (zero riscrittura logica).

> Raccomandazione: **A (Zustand) per i manager con stato che guida la UI** (`renderer`, `table`, `app-manager`, `action`) — vedi R8: il port meccanico con version-counter è fragile proprio perché oggi le mutazioni sono in-place e implicite. **B (classi + Context)** solo per moduli *read-mostly* / logica pura senza stato reattivo. La logica interna (pura) si copia verbatim in entrambi i casi; cambia solo *come si notifica* il cambiamento.

Punti di attenzione:
- `inject()` → parametri di costruttore/factory espliciti (grafo dipendenze già chiaro: api ← managers ← app).
- 2 `Subject` RxJS → mini event-emitter (`type Listener`) o callback nello store.
- Nessun uso di operatori RxJS complessi → nessuna dipendenza da RxJS in React.

### 4.2 `app.component` → albero React
`AppComponent` è uno switch su `mode`/`viewMode`. Diventa:
- `<AppShell>` (brand, topnav, user menu, tema).
- `<DashboardView>`, `<ListView>`, `<FormView>`, `<MenuView>`, `<RedirectHandler>` — selezionati dal `mode`.
- Il grande `app.component.html` (~600 righe) si spezza in questi sotto-componenti. Buona occasione per ridurre il "god component".

### 4.3 Form.io wrapper
- `@formio/react` fornisce `<Form form={schema} submission={sub} onChange onCustomEvent onSubmit />` e `<FormBuilder>`.
- Le patch attuali sono a livello `@formio/js`/`Formio` globale (evaluator via `Formio.use`, template file via `Formio.Templates.addTemplates`, plugin projectless via `Formio.registerPlugin`, `window.Quill`). **Si applicano identiche in `formio-setup.ts` SOLO SE `@formio/react` renderizza attraverso lo stesso singleton `@formio/js`** — vedi **Gate G1** in §7. Questa è l'assunzione portante dell'intero piano.
- `ozon-form-builder-host.component.ts` (montaggio imperativo del builder) → hook `useOzonFormBuilder(ref, form, options)` con `useEffect` per create/destroy. Logica identica.
- `app-formio-renderer.service.ts` (normalizzazione schema, hydration, cache TTL): **è TS puro** → si porta as-is, chiamato dentro un hook `usePreparedSchema(schema, submission)`.

### 4.4 HTTP layer
`OzonApiService` è fetch puro (no `HttpClient` Angular) → si porta **verbatim** come modulo/singleton. Lo streaming NDJSON e il follow-redirect manuale restano identici. Il plugin auth Form.io idem (è API `Formio.registerPlugin`).

### 4.5 Routing manuale
La logica `handleLocationRoute` / History API / `popstate` in `app-action-manager` è agnostica → si porta. Opzionale: avvolgere in `react-router` solo per sincronizzare la URL bar, mantenendo il dispatch ad azioni interno.

### 4.6 Liste / tabella
`record-list` (PrimeNG Table + filtri + fast search) → `<RecordList>` con **PrimeReact DataTable**. Il pannello filtri, il query-builder→Mongo, i tipi campo datetime, la preview show/hide: logica in `app-table-manager` (pura) resta; solo il markup passa a JSX.

### 4.7 Bootstrap Italia
- `bootstrap-italia` CSS + sprite SVG: import identico (già `bootstrap-italia/dist/...`).
- Componenti BI (dropdown, accordion, upload, ecc.): `design-react-kit` dove esiste; altrimenti markup BI + classi (come già facciamo per il template file).
- ⚠️ **Il JS imperativo di `bootstrap-italia` auto-inizializza sul DOM-ready e NON ri-parte** sul mount/re-render dinamico di React (dropdown, tooltip, accordion, upload interattivo restano "morti"). `design-react-kit` incapsula quel comportamento; il markup BI grezzo rende ma senza i suoi behavior JS. Prova già presente nel codebase: il commento in `styles.scss` sul fix della floating-label "without bootstrap-italia's JS initialisation". **Regola: usare `design-react-kit` per ogni componente BI con comportamento JS; markup BI grezzo solo per componenti puramente CSS.**

---

## 5. Le parti difficili (rischi) e come mitigarle

| # | Rischio | Impatto | Mitigazione |
|---|---|---|---|
| R1 | **Form.io + tutte le normalizzazioni custom** (logic/var alias, default-strip, file, select hydration, cache, wysiwyg). | **Basso** | È TS puro **già testato**: portarlo per primo dietro test. Nessuna riscrittura logica. Coperto da `app-formio-renderer.service.spec`. |
| R2 | **God services** (`action-manager` 2610, `table-manager` 2565). | Medio | Port meccanico prima, spezzettamento dopo. Non riscrivere e ristrutturare insieme. |
| R3 | **Routing ad azioni manuale** + `content.mode`. | Medio | Logica agnostica: portare 1:1, test end-to-end sui mode. |
| R4 | **Streaming NDJSON** liste. | Medio | `OzonApiService` già usa `fetch` + reader: invariato in React. |
| R5 | **Builder imperativo** (`FormBuilder` monta DOM proprio). | Medio | `useEffect` create/destroy + `ref`; il wrapper Angular è già "imperativo dentro Angular", stesso pattern in React. |
| R6 | **Parità componenti PrimeNG → PrimeReact / design-react-kit**. | Medio | PrimeReact copre table/dialog/inputs. Verificare datepicker/editor. design-react-kit per BI. |
| R7 | **Auth Keycloak + refresh token**. | Medio | `backend-auth` è logica pura + fetch: portare; il plugin token Form.io idem. |
| R8 | **Change detection → reattività React** (mutazioni in-place). | **Alto** | Il rischio principale. Portare i manager stateful su **store Zustand con `set` immutabile**; evitare il version-counter manuale. |

> **R8 è il vero cambio di paradigma e il rischio più alto del progetto.** Oggi i manager mutano `this.formSchema`, `this.formSubmission`, `this.tableRows` **in place** in migliaia di righe, e si affidano a zone.js per il re-render. In React non c'è zone: **ogni singolo punto di mutazione** deve diventare un update di store esplicito, altrimenti la UI resta stale. Le mutazioni oggi sono *implicite e sparse*, quindi un version-counter "da ricordarsi di incrementare" è fragile per costruzione. I bug affrontati in questa sessione (customDefaultValue che clobbera il valore salvato; il flicker del pulsante elimina; il value perso dopo il fetch delle select) sono **esattamente** questa classe di problema mutate-then-notify: sono la prova che il pattern va sostituito, non replicato. Per i manager stateful → **Zustand (store immutabile) fin da subito**; il version-counter va bene solo per moduli read-mostly.

---

## 6. Strategia di migrazione

**Strangler incrementale** non è banale qui perché è una single-view app fortemente accoppiata a un unico stato. Due opzioni:

### Opzione 1 — Big-bang su branch (consigliata per questa app)
Riscrittura del guscio su un branch React parallelo, **riusando i moduli TS core**. La logica pura (~70% del codice) si copia; si riscrive solo componenti + wiring stato. Un'app single-view si presta al big-bang perché non ci sono decine di route indipendenti da migrare a fette.

### Opzione 2 — Coesistenza via Web Components
Angular espone già `@angular/elements`. Si potrebbe incapsulare React dentro/accanto, ma per una single-view il costo di ponte supera il beneficio. **Sconsigliata** salvo necessità di rilascio graduale.

---

## 7. Piano a fasi

### Fase 0 — Fondamenta (setup)
- Scaffold Vite + React + TS. Proxy `/api` → backend (replica `proxy.conf.json`).
- Import `bootstrap-italia` CSS/sprite; aggiungere `design-react-kit`, `@formio/react`, PrimeReact, `react-i18next`.
- `formio-setup.ts`: portare `installFormioCompatibility` (evaluator, Quill, template file BI, plugin projectless).

> ### 🚧 Gate G1 (BLOCCANTE, da fare per primo) — verifica `@formio/react`
> Prima di procedere oltre, **verificare** che `@formio/react`:
> 1. dipenda/usi lo stesso major di `@formio/js` (5.x) che le patch modificano;
> 2. renderizzi attraverso il **singleton `Formio` globale** (non una copia interna bundlata).
>
> Test minimo: montare un `<Form>` di `@formio/react`, applicare `installFormioCompatibility()` al bootstrap, e verificare che (a) un componente `file` usi il template BI custom, (b) l'evaluator legacy sia attivo, (c) il plugin projectless intercetti. Se `@formio/react` isola il proprio `@formio/js`, **l'intero piano va rivisto** (serve fork del wrapper o rendering manuale via `Formio.createForm`). Questo è l'unico rischio che può invalidare l'approccio: risolverlo prima di investire nel port.

- **Esito:** app vuota che monta Form.io con le patch **confermate attive**.

### Fase 1 — Core logico (port TS puro, zero UI)
- Portare `core/*` (api, runtime-config, auth, url, utils, select-option, websocket, error-state).
- Portare i manager come **moduli/classi** (strategia B) con i loro spec (Karma → **Vitest**).
- **Esito:** business logic compilata e testata fuori da React.

### Fase 2 — Rendering form
- `usePreparedSchema` + `<FormView>` con `@formio/react`.
- Hydration select + cache TTL + loader "fino a fine select" (già implementati: portare).
- Modale conferma pulsanti, download allegati, azioni inline/camunda.
- **Esito:** apertura/salvataggio record + logic + file + azioni funzionanti.

### Fase 3 — Liste
- `<RecordList>` (PrimeReact), filtri, fast search, query→Mongo, export/import, paginazione, streaming NDJSON.
- **Esito:** viste lista complete.

### Fase 4 — Shell, navigazione, menu, dashboard, tema, auth
- `<AppShell>`, topnav/menu/dashboard, routing ad azioni, Keycloak, guard cross-origin.
- **Esito:** parità funzionale.

### Fase 5 — Builder (modalità designer)
- `useOzonFormBuilder` + palette + save schema.
- **Esito:** editing form in-app.

### Fase 6 — Hardening
- Parità test, QA su tutti i `mode`, accessibilità BI, performance, cleanup log di debug residui.

---

## 8. Disposizione file (port / riscrivi / elimina)

| Area | Azione |
|---|---|
| `core/*` | **Port ~1:1** (fetch puro, util). |
| `managers/*` (logica) | **Port ~1:1**; rimuovere `@Injectable`, sostituire `Subject`. |
| `models/*` | **Port 1:1** (tipi TS). |
| `formio/formio-compat`, `ozon-file-template`, `ozon-form-builder`, `ozon-json-editor-formio`, `formio-builder-config` | **Port ~1:1** (API Form.io globale). |
| `formio/ozon-form-builder-host.component.ts` | **Riscrivi** come hook. |
| `app.component.*` | **Riscrivi** in albero di componenti React. |
| `list/*.component.ts` | **Riscrivi** UI (logica in table-manager resta). |
| `*.spec.ts` | **Port** a Vitest (asserzioni identiche, cambia il runner). |
| `app.config.ts`, `app.routes.ts` | **Elimina** (sostituiti da bootstrap Vite/React). |

---

## 9. Testing

- Runner: **Vitest** (rimpiazza Karma/Jasmine); asserzioni portabili quasi verbatim.
- I test **più preziosi** sono quelli su logica pura (renderer, table-manager, action-manager): **portarli per primi** — diventano la rete di sicurezza del port core (Fase 1).
- Component test: **React Testing Library**.
- E2E consigliati sui `content.mode` (form/list/action/redirect) per garantire parità di comportamento col backend.

---

## 10. Stima e sequenziamento (indicativa)

| Fase | Contenuto | Complessità |
|---|---|---|
| 0 | Setup + Form.io patch | Bassa |
| 1 | Port core + manager + test | **Media-alta** (volume, ma meccanico) |
| 2 | Form rendering | Alta (è il cuore) |
| 3 | Liste | Media |
| 4 | Shell/nav/auth | Media |
| 5 | Builder | Media |
| 6 | Hardening/QA | Media |

> Il grosso dell'effort è **volume di port** (Fase 1-2), non complessità algoritmica nuova: la logica esiste già ed è testata.

---

## 11. Raccomandazioni finali

1. **Non riscrivere la logica.** Portare i moduli TS puri as-is; il rischio vero è introdurre regressioni riscrivendo ciò che già funziona (specie tutte le normalizzazioni Form.io faticosamente messe a punto).
2. **Prima il core dietro test (Vitest), poi la UI.** La rete di test rende il big-bang sicuro.
3. **Gestire la reattività con disciplina:** eliminare le mutazioni in-place a favore di store `set`/notify, altrimenti i re-render React non scattano.
4. **design-react-kit + bootstrap-italia** per BI; **@formio/react** per i form; **PrimeReact** per la tabella (minima frizione di transizione da PrimeNG).
5. Fare la migrazione su **branch dedicato**, non incrementale in-place.

---

*Documento di pianificazione. Da validare con il team prima dell'avvio della Fase 0.*
