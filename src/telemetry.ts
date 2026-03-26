import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import * as api from '@opentelemetry/api';
import Pyroscope from '@pyroscope/nodejs';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'payment-service';
const SERVICE_VERSION = process.env.SERVICE_VERSION ?? '1.0.0';
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
const PYROSCOPE_ENDPOINT = process.env.PYROSCOPE_ADDR ?? 'http://localhost:4040';
const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? '9464', 10);

const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
});

// --- Trace exporter (OTLP HTTP → Alloy → Tempo) ---
const traceExporter = new OTLPTraceExporter({
  url: `${OTEL_ENDPOINT}/v1/traces`,
});

// --- Log exporter (OTLP HTTP → Alloy → Loki) ---
const logExporter = new OTLPLogExporter({
  url: `${OTEL_ENDPOINT}/v1/logs`,
});

// --- Prometheus metrics exporter (Alloy scrapes this endpoint) ---
const prometheusExporter = new PrometheusExporter({
  port: METRICS_PORT,
  host: '0.0.0.0',
});

const sdk = new NodeSDK({
  resource,
  spanProcessor: new SimpleSpanProcessor(traceExporter),
  metricReader: prometheusExporter,
  logRecordProcessor: new BatchLogRecordProcessor(logExporter),
  instrumentations: [new GrpcInstrumentation()],
});

// Start the SDK immediately on import — server.ts does `import './telemetry'`
// so this runs before any gRPC server/client code loads, ensuring instrumentation
// patches @grpc/grpc-js before it's used.
sdk.start();

// The PrometheusExporter HTTP server is not auto-started by NodeSDK —
// we must start it explicitly so Alloy can scrape /metrics.
prometheusExporter.startServer().then(() => {
  console.log(`Prometheus metrics server listening on :${METRICS_PORT}/metrics`);
}).catch((err: unknown) => {
  console.error('Failed to start Prometheus metrics server:', err);
});

// ---------------------------------------------------------------------------
// Custom gRPC server metrics
// The Node.js GrpcInstrumentation only produces traces, not metrics.
// We create manual instruments that match the OTel RPC semantic conventions
// so the Grafana dashboard can query them.
// ---------------------------------------------------------------------------

const meter = api.metrics.getMeter('payment-service-grpc');
const runtimeMeter = api.metrics.getMeter('payment-service-runtime');

const rpcServerDuration = meter.createHistogram('rpc_server_duration', {
  description: 'Duration of inbound gRPC calls in seconds',
  unit: 's',
  advice: {
    explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});

const rpcServerRequestsTotal = meter.createCounter('rpc_server_requests_total', {
  description: 'Total number of inbound gRPC calls',
});

const rpcServerActiveRequests = meter.createUpDownCounter('rpc_server_active_requests', {
  description: 'Number of in-flight gRPC calls',
});

// ---------------------------------------------------------------------------
// Node.js runtime metrics (observable gauges scraped on each /metrics request)
// ---------------------------------------------------------------------------

runtimeMeter.createObservableGauge('nodejs_process_resident_memory_bytes', {
  description: 'Resident memory size in bytes',
  unit: 'By',
}).addCallback((obs) => {
  obs.observe(process.memoryUsage().rss);
});

runtimeMeter.createObservableGauge('nodejs_heap_size_total_bytes', {
  description: 'V8 heap total size in bytes',
  unit: 'By',
}).addCallback((obs) => {
  obs.observe(process.memoryUsage().heapTotal);
});

runtimeMeter.createObservableGauge('nodejs_heap_size_used_bytes', {
  description: 'V8 heap used size in bytes',
  unit: 'By',
}).addCallback((obs) => {
  obs.observe(process.memoryUsage().heapUsed);
});

runtimeMeter.createObservableGauge('nodejs_external_memory_bytes', {
  description: 'V8 external memory in bytes',
  unit: 'By',
}).addCallback((obs) => {
  obs.observe(process.memoryUsage().external);
});

runtimeMeter.createObservableGauge('nodejs_array_buffers_bytes', {
  description: 'Memory allocated for ArrayBuffers and SharedArrayBuffers',
  unit: 'By',
}).addCallback((obs) => {
  obs.observe(process.memoryUsage().arrayBuffers);
});

runtimeMeter.createObservableGauge('nodejs_process_cpu_user_seconds', {
  description: 'CPU user time in seconds',
  unit: 's',
}).addCallback((obs) => {
  obs.observe(process.cpuUsage().user / 1e6);
});

runtimeMeter.createObservableGauge('nodejs_process_cpu_system_seconds', {
  description: 'CPU system time in seconds',
  unit: 's',
}).addCallback((obs) => {
  obs.observe(process.cpuUsage().system / 1e6);
});

runtimeMeter.createObservableGauge('nodejs_process_uptime_seconds', {
  description: 'Process uptime in seconds',
  unit: 's',
}).addCallback((obs) => {
  obs.observe(process.uptime());
});

// Event loop lag — measures delay between setTimeout(0) scheduling and execution
let eventLoopLagMs = 0;
function measureEventLoopLag(): void {
  const start = process.hrtime.bigint();
  setTimeout(() => {
    eventLoopLagMs = Number(process.hrtime.bigint() - start) / 1e6; // ms
    measureEventLoopLag();
  }, 0);
}
measureEventLoopLag();

runtimeMeter.createObservableGauge('nodejs_eventloop_lag_seconds', {
  description: 'Event loop lag in seconds',
  unit: 's',
}).addCallback((obs) => {
  obs.observe(eventLoopLagMs / 1000);
});

// Active handles and requests
runtimeMeter.createObservableGauge('nodejs_active_handles_total', {
  description: 'Number of active handles',
}).addCallback((obs) => {
  obs.observe((process as any)._getActiveHandles?.().length ?? 0);
});

runtimeMeter.createObservableGauge('nodejs_active_requests_total', {
  description: 'Number of active requests',
}).addCallback((obs) => {
  obs.observe((process as any)._getActiveRequests?.().length ?? 0);
});

/**
 * Call this at the start of each gRPC handler. Returns a function to call
 * when the handler finishes (pass the gRPC status code).
 */
export function startRpcMetrics(method: string): (grpcStatusCode: number) => void {
  const startTime = process.hrtime.bigint();
  const attrs = {
    rpc_system: 'grpc',
    rpc_service: 'hipstershop.PaymentService',
    rpc_method: method,
  };

  rpcServerActiveRequests.add(1, attrs);

  return (grpcStatusCode: number) => {
    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9; // seconds
    const finalAttrs = { ...attrs, rpc_grpc_status_code: String(grpcStatusCode) };

    rpcServerDuration.record(elapsed, finalAttrs);
    rpcServerRequestsTotal.add(1, finalAttrs);
    rpcServerActiveRequests.add(-1, attrs);
  };
}

// --- Pyroscope continuous profiling ---
Pyroscope.init({
  serverAddress: PYROSCOPE_ENDPOINT,
  appName: SERVICE_NAME,
  tags: { version: SERVICE_VERSION },
});
Pyroscope.start();

process.on('SIGTERM', async () => {
  await sdk.shutdown();
  Pyroscope.stop();
});

export { sdk };