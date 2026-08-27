<h2 align="center">Formio Ozon Frontend Base</h2>

Base frontend viewer for Ozon, `ozon-app-web`.

*Versione italiana: [README.IT.md](README.IT.md)*

## Angular frontend

A frontend lives in `ozon-app-web`, based on Angular + `@formio/angular`.

Commands:
- `npm --prefix ozon-app-web install`
- `npm run start:angular`

Recommended Angular build via Docker (Node LTS):
- `npm run install:angular:docker`
- `npm run build:angular:docker`
- `npm run test:angular:docker`
- `npm run start:angular:docker`
- `./angular-docker.sh start`

`start` uses `docker-compose.angular.yml`, builds the frontend image from source and serves the static assets with `nginx`. It does not use `ng serve`. It automatically loads `.env` and connects the frontend to the external network `${BACKEND_DOCKER_NETWORK}` (default `backend_default`).

Each Compose instance has an isolated project namespace. By default it is derived from
`OZON_ANGULAR_PORT` (for example `ozon-formio-4200`). To run multiple instances, assign a
different port to each one or set an explicit unique name:

```dotenv
OZON_FORMIO_COMPOSE_PROJECT=ozon-formio-customer-a
OZON_ANGULAR_PORT=4201
```

The same namespace rule applies to `docker-compose.registry.yml`. Do not add a static
`container_name`: Compose generates isolated container names from the project namespace.

## Setup

```bash
cp .env.example .env
```

`.env` config:
- `backendurl`
- `BACKENDURL` (recommended for the Angular compose healthcheck)
- `BACKEND_DOCKER_NETWORK` (backend external network, e.g. `ozn-network`)
- `OZON_FORMIO_COMPOSE_PROJECT` (optional unique Compose namespace for parallel instances)
- `OZON_ANGULAR_PORT` (host port; also used by the default Compose namespace)

Auth is cookie-based (`ozon_session` httponly + `ozon_csrf`); no token is
handled client-side. See `docAnalisi/SECURITY_KEYCLOAK_TOKEN_BRIEF_FRONTEND.it.md`.

## UI theme

- Active theme: **Bootstrap Italia**
- CSS: `https://cdn.jsdelivr.net/npm/bootstrap-italia@2.16.0/dist/css/bootstrap-italia.min.css`
- JS: `https://cdn.jsdelivr.net/npm/bootstrap-italia@2.16.0/dist/js/bootstrap-italia.bundle.min.js`
- Local Bootstrap remains as a base fallback.
- Record table component: native Angular table + Bootstrap Italia classes

## Integrated endpoints

- `GET /models/distinct` list of models
- `GET /record/{model}` Form.io schema for the model
  - standard Form.io schema supported (`components`)
  - Ozon `formio` format supported, both as a component array and as a fields object
- `POST /list/{model}` record list
  - base payload: `query`, `skip`, `limit`, `order`
  - `application/x-ndjson` streaming output supported (records loaded into the table progressively)
  - the frontend automatically retries with alternate `order`/`query` formats on `422`
- `GET /record/{model}/{rec_name}` a specific record
  - opens the record in the frontend with a single call: expected payload with `data` + `schema` (+ `rec_name`)

## Container image & registries

### GitLab CI (this project's registry)

`.gitlab-ci.yml` builds the `ozon-app-web` Docker image and pushes it to this project's built-in GitLab Container Registry on push to `main` or `1.0`. It uses GitLab's auto-injected `CI_REGISTRY*` variables — no manual credentials to configure.

Image: `${CI_REGISTRY_IMAGE}:latest` and `${CI_REGISTRY_IMAGE}:<commit-sha>`.

### Run the published image with Docker Compose

`docker-compose.registry.yml` runs `ozon-app-web` by pulling the built image instead of building from source (unlike `docker-compose.angular.yml`, which builds locally).

```bash
cp .env.example .env
# fill in REGISTRY_USER / REGISTRY_PASSWORD (GitLab personal access token or deploy token,
# scopes read_registry/write_registry — not your account password)
./scripts/registry-up.sh
```

`scripts/registry-up.sh` reads `.env`, logs in to the registry non-interactively, then runs `docker compose -f docker-compose.registry.yml up -d`.

Override the pulled image/tag with `OZON_APP_WEB_IMAGE` in `.env`.

Note: images built by the GitLab CI runner are `linux/amd64`. On Apple Silicon Macs, `docker-compose.registry.yml` sets `platform: linux/amd64` so Docker Desktop runs it under emulation.

### GitHub Actions (ghcr.io)

`.github/workflows/docker-publish.yml` builds and pushes the same image to GitHub Container Registry (`ghcr.io/<owner>/<repo>`) on push to `main`, using the built-in `GITHUB_TOKEN` — no extra secrets needed.
