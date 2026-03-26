import { startRpcMetrics } from './telemetry'; // must be first — instruments before anything else loads
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { pino } from 'pino';
import { charge } from './charge';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'payment-service',
  messageKey: 'message',
  formatters: {
    level(label) {
      return { severity: label };
    },
  },
});

// ---------------------------------------------------------------------------
// Proto loading
// ---------------------------------------------------------------------------

const PAYMENT_PROTO_PATH = path.join(__dirname, '../proto/payment.proto');
const HEALTH_PROTO_PATH = path.join(__dirname, '../proto/health.proto');

function loadProto(protoPath: string) {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDefinition);
}

const paymentProto = (loadProto(PAYMENT_PROTO_PATH) as any).hipstershop;
const healthProto = (loadProto(HEALTH_PROTO_PATH) as any).grpc.health.v1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Money {
  currency_code: string;
  units: number;
  nanos: number;
}

interface CreditCardInfo {
  credit_card_number: string;
  credit_card_cvv: number;
  credit_card_expiration_year: number;
  credit_card_expiration_month: number;
}

interface ChargeRequest {
  amount: Money;
  credit_card: CreditCardInfo;
}

interface ChargeResponse {
  transaction_id: string;
}

// ---------------------------------------------------------------------------
// gRPC handlers
// ---------------------------------------------------------------------------

function chargeHandler(
  call: grpc.ServerUnaryCall<ChargeRequest, ChargeResponse>,
  callback: grpc.sendUnaryData<ChargeResponse>,
): void {
  const endMetrics = startRpcMetrics('Charge');
  try {
    logger.info({ request: call.request }, 'PaymentService#Charge invoked');
    const response = charge(call.request);
    endMetrics(grpc.status.OK);
    callback(null, response);
  } catch (err: any) {
    logger.warn({ err }, 'Charge failed');
    endMetrics(grpc.status.INVALID_ARGUMENT);
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: err.message ?? 'Charge failed',
    });
  }
}

function check(
  _call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<{ status: string }>,
): void {
  callback(null, { status: 'SERVING' });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function main(): void {
  const port = process.env.PORT ?? '50051';

  const server = new grpc.Server();
  server.addService(paymentProto.PaymentService.service, { charge: chargeHandler });
  server.addService(healthProto.Health.service, { check });

  server.bindAsync(
    `[::]:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, boundPort) => {
      if (err) {
        logger.error({ err }, 'Failed to bind gRPC server');
        process.exit(1);
      }
      logger.info({ port: boundPort }, 'PaymentService gRPC server started');
    },
  );
}

main();