# payment-service

A gRPC service that "processes" payments for the platform-demo e-commerce platform. It validates a credit card (number checksum, brand, expiry) and returns a random transaction ID. **No real payment provider is involved and nothing is persisted** — it is a simulation. It is stateless, has no downstream dependencies, and is called only by `checkout-service`.

Part of the [platform-demo](https://github.com/mladenovskistefan111) platform — microservices, observability (LGTM stack), GitOps (Argo CD), policy enforcement (Kyverno), infrastructure provisioning (Crossplane) and an internal developer portal (Backstage). See the master `README.md` in the platform-demo root for the whole-system view.

## At a glance

| | |
|---|---|
| **Language / runtime** | TypeScript on Node.js 22 (`@grpc/grpc-js`) |
| **Image** | `mladenovskistefan/payment-service` |
| **Protocol / port** | gRPC (HTTP/2, plaintext) on `50051` |
| **Metrics** | Pushed over OTLP/gRPC to Alloy → Mimir every 15 s (no scrape endpoint). Dashboard names: `rpc_server_duration_seconds_{bucket,count,sum}`, `rpc_server_requests_total`, `rpc_server_active_requests` |
| **Health** | `grpc.health.v1.Health/Check` on `50051` — static `SERVING` |
| **State** | None |
| **Depends on** | Nothing (optional: OTLP collector, Pyroscope) |
| **Called by** | `checkout-service` (`Charge`) |
| **gRPC reflection** | Not enabled — pass `-proto` to `grpcurl` |

## API

Package `hipstershop`, service `PaymentService` ([`proto/payment.proto`](proto/payment.proto)); health in [`proto/health.proto`](proto/health.proto).

| Method | Request | Response |
|---|---|---|
| `Charge` | `ChargeRequest{ Money amount, CreditCardInfo credit_card }` | `ChargeResponse{ transaction_id }` (a random UUID v4) |

`CreditCardInfo` = `{ credit_card_number, credit_card_cvv, credit_card_expiration_year, credit_card_expiration_month }`.

Validation rules (any failure → gRPC `INVALID_ARGUMENT` with a message):

1. Number must pass `simple-card-validator` (Luhn + known brand) — "Credit card info is invalid".
2. Brand must be **Visa or MasterCard** — other brands are rejected ("Sorry, we cannot process … credit cards").
3. Expiry month/year must not be in the past — "Your credit card (ending NNNN) expired on M/YYYY".

The CVV and `amount` are **not** validated. Every handler error is mapped to `INVALID_ARGUMENT`.

Test cards that pass: Visa `4111111111111111`, MasterCard `5555555555554444` (any future expiry). Amex `378282246310005` is rejected.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `50051` | gRPC listen port. **Must be set when relying on the Docker `HEALTHCHECK`** (see below) |
| `NODE_ENV` | `production` (set in image) | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP/**gRPC** endpoint for **traces, metrics and logs** (scheme required), e.g. `http://alloy.monitoring.svc.cluster.local:4317`. Legacy fallback: `COLLECTOR_SERVICE_ADDR` (`host:port`) |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Milliseconds between metric pushes |
| `OTEL_SERVICE_NAME` | `payment-service` | `service.name` — becomes the Prometheus `job` and the Loki `service_name`; keep the default, dashboards depend on it |
| `SERVICE_VERSION` | `1.0.0` | `service.version` resource attribute |
| `PYROSCOPE_ADDR` | `http://localhost:4040` | Profiles use the Pyroscope SDK push protocol (**not** OTLP). Point it at Alloy (`http://alloy.monitoring.svc.cluster.local:4040`), which forwards to Pyroscope, or directly at Pyroscope |

Notes:

- There are **no secrets** and no external credentials: the service never talks to a real processor.
- Telemetry is **pushed**, not scraped: traces, metrics and logs share one OTLP/gRPC endpoint (Alloy); profiles go to Pyroscope (via Alloy). `service.instance.id` is the pod hostname, so replicas stay distinct in Mimir.
- The former Prometheus endpoint (`METRICS_PORT`) no longer exists. Logs keep going to stdout and are additionally exported over OTLP with trace ids.
- Telemetry and profiling cannot be switched off with a flag; with no reachable collector the exporters just log errors and the service keeps serving.

## Container image

Multi-stage [`Dockerfile`](Dockerfile):

| Stage | Base | What happens |
|---|---|---|
| builder | `node:22.22.2-alpine3.23` | `npm ci --ignore-scripts`, `npm run build` (tsc → `dist/`), `npm prune --omit=dev` |
| runtime | `node:22.22.2-alpine3.23` | copies `node_modules`, `dist/`, `proto/`; runs as non-root |

- **Entrypoint:** `node dist/server.js` (working dir `/app`).
- **User:** `appuser` — UID `100`, GID `101` (verified). Set `runAsUser: 100` for `runAsNonRoot`.
- **EXPOSE:** `50051` only.
- **Docker `HEALTHCHECK`:** `grpc-js` client to `localhost:$PORT`. It reads `process.env.PORT` with no default, so it **fails if `PORT` is unset**. Kubernetes ignores it, but set `PORT` explicitly.
- **Image size:** ~73 MB.

## Kubernetes deployment notes

**Workload:** stateless `Deployment`; scale freely.

**Ports to declare**

| Name | Port | Protocol | Expose via Service? |
|---|---|---|---|
| `grpc` | `50051` | TCP (HTTP/2) | Yes — `checkout-service` dials `payment-service:50051` |

**Service DNS name expected by callers:** `payment-service` (`checkout-service`: `PAYMENT_SERVICE_ADDR=payment-service:50051`). Note the same port number (`50051`) is also used by `shipping-service` — they are different Services, so no clash.

**Probes**

```yaml
readinessProbe:
  grpc: { port: 50051 }
  initialDelaySeconds: 3
  periodSeconds: 5
livenessProbe:
  grpc: { port: 50051 }
  periodSeconds: 10
  failureThreshold: 3
```

(The Node health handler implements `Check` only; `grpc:` probes only call `Check`.)

**Graceful shutdown:** a `SIGTERM` handler flushes OpenTelemetry/Pyroscope but never exits the process, so Node runs until `SIGKILL`. Set `terminationGracePeriodSeconds: 5`.

**Security context**

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 100
  runAsGroup: 101
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
  readOnlyRootFilesystem: true   # verified (no /tmp needed)
```

**Resources** — requests sized from measured idle usage in the test stack (see the chart's `values.yaml` for limits):

```yaml
resources:
  requests: { cpu: 100m, memory: 64Mi }
  limits:   { cpu: "500m", memory: 192Mi }
```

**Config / secrets:** none. Plain env only.

**Network policy:** only `checkout-service` should be allowed to reach port `50051`; this service handles card data.

**Telemetry:** pushed, not scraped — OTLP/gRPC to Alloy (`global.monitoring.otlpEndpoint`), profiles to Alloy `:4040`. Metrics carry `job="payment-service"` and `instance=<pod>`; no scrape annotations or `ServiceMonitor` are needed.

**Helm chart:** [`platform-demo-helm/payment-service`](../platform-demo-helm/payment-service) (built on the shared `platform-common` library chart). It ships with HA defaults — 2 replicas,
HPA, PodDisruptionBudget, topology spread, NetworkPolicy, restricted pod security context, probes and the full env contract (see Configuration) —
and was verified on a 3-node kind cluster under the `restricted` Pod Security Standard.

## Observability

| Signal | Implementation | Destination |
|---|---|---|
| **Traces** | OpenTelemetry `NodeSDK` + `GrpcInstrumentation`, OTLP/gRPC exporter (`BatchSpanProcessor`) | Alloy `:4317` → Tempo |
| **Metrics** | Hand-rolled RPC instruments (`GrpcInstrumentation` emits traces only) + Node runtime gauges, `PeriodicExportingMetricReader` over OTLP/gRPC every 15 s (replaces the Prometheus exporter) | Alloy → Mimir |
| **Logs** | `pino` JSON to stdout **and** `@opentelemetry/instrumentation-pino` forwarding records over OTLP/gRPC with trace ids | Alloy → Loki |
| **Profiles** | `@pyroscope/nodejs`, tagged with `version` | Alloy `:4040` → Pyroscope |

Metric names: `rpc_server_duration_seconds_{bucket,count,sum}` (buckets 1 ms … 10 s; the unit `s` yields the `_seconds` suffix), `rpc_server_requests_total`, `rpc_server_active_requests` (labels `rpc_system`, `rpc_service`, `rpc_method`, `rpc_grpc_status_code`), plus `nodejs_*` runtime gauges (heap, RSS, CPU, event-loop lag, active handles). The event-loop lag is sampled with Node's `monitorEventLoopDelay` histogram — the earlier self-rescheduling `setTimeout(0)` probe kept an idle pod at ~25 % CPU, which would have kept an HPA scaling out.

Every series carries `job="payment-service"` (from `service.name`) and `instance=<pod name>` (`service.instance.id`), which is what the Grafana dashboards select on. Logs land in Loki with `service_name="payment-service"` and trace/span ids, so a log line links to its trace.

## Running locally

Requirements: Node.js 22 (`.nvmrc`), Docker, [`grpcurl`](https://github.com/fullstorydev/grpcurl).

```bash
npm ci
npm run build && npm start
npm run dev                         # ts-node, no build step
npm test                            # jest unit tests
npm run lint && npm run typecheck

docker build -t payment-service .
docker run --rm -p 50051:50051 -e PORT=50051 payment-service
```

### Manual gRPC testing (no reflection — pass the proto)

```bash
grpcurl -plaintext -proto proto/payment.proto -d '{
  "amount": {"currency_code": "USD", "units": 50, "nanos": 0},
  "credit_card": {"credit_card_number": "4111111111111111", "credit_card_cvv": 123,
                  "credit_card_expiration_year": 2030, "credit_card_expiration_month": 12}
}' localhost:50051 hipstershop.PaymentService/Charge

grpcurl -plaintext -proto proto/health.proto localhost:50051 grpc.health.v1.Health/Check
```

## Project structure

```
├── src/
│   ├── server.ts        # gRPC bootstrap, Charge + Check handlers
│   ├── charge.ts        # card validation and fake charge (CreditCardError classes)
│   ├── telemetry.ts     # OTel SDK, Prometheus exporter, RPC metrics, runtime gauges, Pyroscope
│   └── types/simple-card-validator.d.ts
├── proto/               # payment.proto, health.proto (loaded at runtime by @grpc/proto-loader)
├── package.json / package-lock.json / tsconfig.json
├── Dockerfile
├── .dockerignore / .nvmrc / .eslintrc.cjs / .prettierrc / .trivyignore
└── docs/                # empty placeholder
```

## Known limitations

- Simulation only: no provider integration, no persistence, no idempotency (every call yields a new transaction ID).
- Logs the raw card details (see warning above).
- Every error is returned as `INVALID_ARGUMENT`, including unexpected internal failures.
- `SIGTERM` does not terminate the process; the Docker `HEALTHCHECK` depends on `PORT` being set.
