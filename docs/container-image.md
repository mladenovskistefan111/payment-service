# Container image

Multi-stage [`Dockerfile`](https://github.com/platform-boutique/app-payment-service/tree/main/Dockerfile):

| Stage | Base | What happens |
|---|---|---|
| builder | `node:22.22.2-alpine3.23` | `npm ci --ignore-scripts`, `npm run build` (tsc → `dist/`), `npm prune --omit=dev` |
| runtime | `node:22.22.2-alpine3.23` | copies `node_modules`, `dist/`, `proto/`; runs as non-root |

- **Entrypoint:** `node dist/server.js` (working dir `/app`).
- **User:** `appuser` — UID `100`, GID `101` (verified). Set `runAsUser: 100` for `runAsNonRoot`.
- **EXPOSE:** `50051` only.
- **Docker `HEALTHCHECK`:** `grpc-js` client to `localhost:$PORT`. It reads `process.env.PORT` with no default, so it **fails if `PORT` is unset**. Kubernetes ignores it, but set `PORT` explicitly.
- **Image size:** ~73 MB.
