# API

Package `hipstershop`, service `PaymentService` ([`proto/payment.proto`](https://github.com/platform-boutique/app-payment-service/blob/main/proto/payment.proto)); health in [`proto/health.proto`](https://github.com/platform-boutique/app-payment-service/blob/main/proto/health.proto).

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
