import { v4 as uuidv4 } from 'uuid';
import cardValidator from 'simple-card-validator';
import { pino } from 'pino';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'payment-service-charge',
  messageKey: 'message',
  formatters: {
    level(label) {
      return { severity: label };
    },
  },
});

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
// Error classes
// ---------------------------------------------------------------------------

class CreditCardError extends Error {
  code: number;
  constructor(message: string) {
    super(message);
    this.code = 400;
  }
}

class InvalidCreditCard extends CreditCardError {
  constructor() {
    super('Credit card info is invalid');
  }
}

class UnacceptedCreditCard extends CreditCardError {
  constructor(cardType: string) {
    super(`Sorry, we cannot process ${cardType} credit cards. Only VISA or MasterCard is accepted.`);
  }
}

class ExpiredCreditCard extends CreditCardError {
  constructor(number: string, month: number, year: number) {
    super(`Your credit card (ending ${number.slice(-4)}) expired on ${month}/${year}`);
  }
}

// ---------------------------------------------------------------------------
// Charge logic
// ---------------------------------------------------------------------------

/**
 * Verifies the credit card number and (pretend) charges the card.
 * Returns a transaction_id (random uuid).
 */
export function charge(request: ChargeRequest): ChargeResponse {
  const { amount, credit_card: creditCard } = request;
  const cardNumber = creditCard.credit_card_number;
  const cardInfo = cardValidator(cardNumber);
  const { card_type: cardType, valid } = cardInfo.getCardDetails();

  if (!valid) {
    throw new InvalidCreditCard();
  }

  // Only VISA and MasterCard accepted
  if (!(cardType === 'visa' || cardType === 'mastercard')) {
    throw new UnacceptedCreditCard(cardType);
  }

  // Validate expiration is > today
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const { credit_card_expiration_year: year, credit_card_expiration_month: month } = creditCard;

  if (currentYear * 12 + currentMonth > year * 12 + month) {
    throw new ExpiredCreditCard(cardNumber.replace('-', ''), month, year);
  }

  logger.info(
    { cardType, lastFour: cardNumber.slice(-4), currency: amount.currency_code, units: amount.units, nanos: amount.nanos },
    'Transaction processed',
  );

  return { transaction_id: uuidv4() };
}