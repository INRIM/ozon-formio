<h2 align="center">Formio Ozon Frontend Base</h2>

Base frontend viewer per Ozon, pronto per evolvere in `ozon-app-web`.

## Frontend Angular

È disponibile un nuovo frontend in `ozon-app-web` basato su Angular + `@formio/angular`.

Comandi:
- `npm --prefix ozon-app-web install`
- `npm run start:angular`

Compilazione Angular consigliata via Docker (Node LTS):
- `npm run install:angular:docker`
- `npm run build:angular:docker`
- `npm run test:angular:docker`
- `npm run start:angular:docker`
- `./angular-docker.sh start`

`start` usa `docker-compose.angular.yml`, esegue la build dell'immagine frontend e serve gli asset statici con `nginx`. Non usa `ng serve`. Passa automaticamente `.env` e collega il frontend alla rete esterna `${BACKEND_DOCKER_NETWORK}` (default `backend_default`).

## Setup

```bash
npm install
cp .env.example .env
```

Config `.env`:
- `backendurl`
- `BACKENDURL` (consigliato per healthcheck compose Angular)
- `basetocken`
- `TOKEN_HEADER`
- `TOKEN_PREFIX` (opzionale, es. `Bearer`)
- `BACKEND_DOCKER_NETWORK` (rete esterna backend, es. `ozn-network`)

## Verifica automatica

```bash
npm test
```

`npm test` esegue build completa e smoke test sui file di output.

## Sviluppo

```bash
npm run dev
```

## Build produzione

```bash
npm run dist
```

## Avvio locale (dist)

```bash
npm start
```

Apre una web app statica su `http://localhost:8080`.

## Tema UI

- Tema attivo: **Bootstrap Italia**
- CSS: `https://cdn.jsdelivr.net/npm/bootstrap-italia@2.16.0/dist/css/bootstrap-italia.min.css`
- JS: `https://cdn.jsdelivr.net/npm/bootstrap-italia@2.16.0/dist/js/bootstrap-italia.bundle.min.js`
- Bootstrap locale resta come fallback base.
- Componente tabella record: tabella nativa Angular + classi Bootstrap Italia

## Endpoint integrati

- `GET /models/distinct` lista modelli
- `GET /record/{model}` schema Formio del model
  - supportato schema Form.io standard (`components`)
  - supportato formato Ozon `formio` sia come array componenti sia come oggetto campi
- `POST /list/{model}` lista record
  - payload base: `query`, `skip`, `limit`, `order`
  - supportato output stream `application/x-ndjson` (record caricati in tabella progressivamente)
  - il frontend prova automaticamente vari formati compatibili per `order/query` se riceve `422`
- `GET /record/{model}/{rec_name}` record specifico
  - apertura record in frontend con una sola chiamata: payload atteso con `data` + `schema` (+ `rec_name`)

Header usato per tutte le chiamate API:
- `<TOKEN_HEADER>: <valore basetocken>` (default `Authorization`)
- se imposti `TOKEN_PREFIX`, il valore inviato diventa `"<TOKEN_PREFIX> <basetocken>"`

Nota CORS:
- se `backendurl` ha origine diversa dal frontend, il client usa automaticamente il proxy locale `"/__ozon_proxy"` per evitare preflight `OPTIONS` sul backend.
