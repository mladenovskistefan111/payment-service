# payment-service

A gRPC service that handles payment processing for the platform-demo e-commerce platform. It validates credit card details and processes charge requests, returning a transaction ID on success. Part of a broader microservices platform built with full observability, GitOps, and internal developer platform tooling.

## Overview

The service exposes one gRPC method:

| Method | Description |
|---|---|
| `Charge` | Validates a credit card and processes a charge for a given amount, returns a transaction ID |

**Port:** `50051` (gRPC)  
**Metrics Port:** `9464` (Prometheus)  
**Protocol:** gRPC  
**Language:** TypeScript (Node.js)  
**Called by:** `checkout-service`

## Requirements

- Node.js 22+
- Docker
- `grpcurl` for manual testing

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | gRPC server port (default: `50051`) |
| `METRICS_PORT` | No | Prometheus metrics port (default: `9464`) |
| `OTEL_SERVICE_NAME` | No | Service name reported to OTel (default: `payment-service`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OTLP HTTP endpoint (default: `http://localhost:4318`) |
| `PYROSCOPE_ADDR` | No | Pyroscope profiling endpoint (default: `http://localhost:4040`) |
| `SERVICE_VERSION` | No | Service version tag (default: `1.0.0`) |

## Running Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Build and run

```bash
npm run build
npm start
```

### 3. Run in dev mode (no build step)

```bash
npm run dev
```

### 4. Run with Docker

```bash
docker build -t payment-service .

docker run -p 50051:50051 -p 9464:9464 \
  payment-service
```

## Testing

### Manual gRPC testing

Install `grpcurl` then, from the service root:

```bash
# charge with a valid card
grpcurl -plaintext \
  -proto proto/payment.proto \
  -d '{
    "amount": {"currency_code": "USD", "units": 100, "nanos": 0},
    "credit_card": {
      "credit_card_number": "4432801561520454",
      "credit_card_cvv": 672,
      "credit_card_expiration_year": 2030,
      "credit_card_expiration_month": 1
    }
  }' \
  localhost:50051 \
  hipstershop.PaymentService/Charge

# charge with an invalid card (triggers INVALID_ARGUMENT error)
grpcurl -plaintext \
  -proto proto/payment.proto \
  -d '{
    "amount": {"currency_code": "USD", "units": 100, "nanos": 0},
    "credit_card": {
      "credit_card_number": "0000000000000000",
      "credit_card_cvv": 000,
      "credit_card_expiration_year": 2020,
      "credit_card_expiration_month": 1
    }
  }' \
  localhost:50051 \
  hipstershop.PaymentService/Charge

# health check
grpcurl -plaintext \
  -proto proto/health.proto \
  localhost:50051 \
  grpc.health.v1.Health/Check
```

### Generate traffic

```bash
# valid charges (code=0)
while true; do
  grpcurl -plaintext \
    -proto proto/payment.proto \
    -d '{"amount": {"currency_code": "USD", "units": 100, "nanos": 0}, "credit_card": {"credit_card_number": "4432801561520454", "credit_card_cvv": 672, "credit_card_expiration_year": 2030, "credit_card_expiration_month": 1}}' \
    localhost:50051 hipstershop.PaymentService/Charge
  sleep 1
done
```

## Project Structure

```
├── proto/
│   ├── payment.proto          # Service definition and message types
│   └── health.proto           # gRPC health check
├── src/
│   ├── server.ts              # gRPC server, service handlers, bootstrap
│   ├── telemetry.ts           # OpenTelemetry traces, Prometheus metrics, Pyroscope profiling
│   ├── charge.ts              # Card validation and charge logic
│   └── types/
│       └── simple-card-validator.d.ts  # Type declarations for card validator
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Observability

- **Traces** — OTLP HTTP → Alloy → Tempo. Inbound server spans instrumented automatically via `GrpcInstrumentation`.
- **Metrics** — Prometheus endpoint on `:9464/metrics`, scraped by Alloy → Mimir. Exposes `rpc_server_duration`, `rpc_server_requests_total`, `rpc_server_active_requests`, plus a full set of Node.js runtime metrics: heap usage, RSS, CPU time, event loop lag, active handles.
- **Logs** — Structured JSON logs via `pino`, exported via OTLP HTTP → Alloy → Loki.
- **Profiles** — Continuous CPU profiling via `@pyroscope/nodejs` SDK → Pyroscope.

## Part Of

This service is part of [platform-demo](https://github.com/mladenovskistefan111) — a full platform engineering project featuring microservices, observability (LGTM stack), GitOps (Argo CD), policy enforcement (Kyverno), infrastructure provisioning (Crossplane), and an internal developer portal (Backstage).