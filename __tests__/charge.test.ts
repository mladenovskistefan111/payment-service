import { charge } from '../src/charge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_VISA = '4111111111111111';
const VALID_MASTERCARD = '5500005555555559';
const VALID_AMEX = '371449635398431';
const INVALID_CARD = '1234567890123456';

const futureYear = new Date().getFullYear() + 1;
const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// A month guaranteed to be in the past
const pastYear = currentYear - 1;
const pastMonth = 1;

function makeRequest(overrides: {
  cardNumber?: string;
  expirationYear?: number;
  expirationMonth?: number;
  currencyCode?: string;
  units?: number;
  nanos?: number;
}) {
  return {
    amount: {
      currency_code: overrides.currencyCode ?? 'USD',
      units: overrides.units ?? 100,
      nanos: overrides.nanos ?? 0,
    },
    credit_card: {
      credit_card_number: overrides.cardNumber ?? VALID_VISA,
      credit_card_cvv: 123,
      credit_card_expiration_year: overrides.expirationYear ?? futureYear,
      credit_card_expiration_month: overrides.expirationMonth ?? 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('charge() — happy paths', () => {
  it('accepts a valid VISA card and returns a transaction_id', () => {
    const result = charge(makeRequest({ cardNumber: VALID_VISA }));
    expect(result).toHaveProperty('transaction_id');
    expect(typeof result.transaction_id).toBe('string');
    expect(result.transaction_id.length).toBeGreaterThan(0);
  });

  it('accepts a valid MasterCard and returns a transaction_id', () => {
    const result = charge(makeRequest({ cardNumber: VALID_MASTERCARD }));
    expect(result).toHaveProperty('transaction_id');
    expect(typeof result.transaction_id).toBe('string');
  });

  it('generates a unique transaction_id on each call', () => {
    const r1 = charge(makeRequest({ cardNumber: VALID_VISA }));
    const r2 = charge(makeRequest({ cardNumber: VALID_VISA }));
    expect(r1.transaction_id).not.toBe(r2.transaction_id);
  });

  it('accepts a card expiring exactly this month', () => {
    const result = charge(
      makeRequest({
        cardNumber: VALID_VISA,
        expirationYear: currentYear,
        expirationMonth: currentMonth,
      }),
    );
    expect(result).toHaveProperty('transaction_id');
  });

  it('works with any currency code', () => {
    const result = charge(makeRequest({ cardNumber: VALID_VISA, currencyCode: 'EUR' }));
    expect(result).toHaveProperty('transaction_id');
  });

  it('works with zero-unit amounts (nanos only)', () => {
    const result = charge(makeRequest({ cardNumber: VALID_VISA, units: 0, nanos: 500_000_000 }));
    expect(result).toHaveProperty('transaction_id');
  });
});

// ---------------------------------------------------------------------------
// Invalid card number
// ---------------------------------------------------------------------------

describe('charge() — invalid card number', () => {
  it('throws InvalidCreditCard for a Luhn-failing number', () => {
    expect(() => charge(makeRequest({ cardNumber: INVALID_CARD }))).toThrow(
      'Credit card info is invalid',
    );
  });

  it('throws for an empty string', () => {
    expect(() => charge(makeRequest({ cardNumber: '' }))).toThrow();
  });

  it('throws InvalidCreditCard for a number that is all zeros', () => {
    expect(() => charge(makeRequest({ cardNumber: '0000000000000000' }))).toThrow(
      'Credit card info is invalid',
    );
  });
});

// ---------------------------------------------------------------------------
// Unaccepted card type
// ---------------------------------------------------------------------------

describe('charge() — unaccepted card type', () => {
  it('throws UnacceptedCreditCard for an AMEX card', () => {
    expect(() => charge(makeRequest({ cardNumber: VALID_AMEX }))).toThrow(
      'Sorry, we cannot process',
    );
  });

  it('error message names the rejected card type', () => {
    try {
      charge(makeRequest({ cardNumber: VALID_AMEX }));
      fail('expected to throw');
    } catch (err: any) {
      expect(err.message).toMatch(/american.express|amex/i);
    }
  });

  it('error message mentions VISA or MasterCard as accepted types', () => {
    try {
      charge(makeRequest({ cardNumber: VALID_AMEX }));
    } catch (err: any) {
      expect(err.message).toMatch(/VISA|MasterCard/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Expired card
// ---------------------------------------------------------------------------

describe('charge() — expired card', () => {
  it('throws ExpiredCreditCard for a card expired last year', () => {
    expect(() =>
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: pastYear,
          expirationMonth: pastMonth,
        }),
      ),
    ).toThrow('expired');
  });

  it('throws ExpiredCreditCard for a card that expired last month', () => {
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const yearOfLastMonth = currentMonth === 1 ? currentYear - 1 : currentYear;
    expect(() =>
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: yearOfLastMonth,
          expirationMonth: lastMonth,
        }),
      ),
    ).toThrow('expired');
  });

  it('error message includes the last four digits of the card', () => {
    try {
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: pastYear,
          expirationMonth: pastMonth,
        }),
      );
    } catch (err: any) {
      expect(err.message).toContain('1111'); // last 4 of VALID_VISA
    }
  });

  it('error message includes the expiry month and year', () => {
    try {
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: pastYear,
          expirationMonth: 6,
        }),
      );
    } catch (err: any) {
      expect(err.message).toContain(String(pastYear));
      expect(err.message).toContain('6');
    }
  });

  it('does not throw for a card expiring next year', () => {
    expect(() =>
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: futureYear,
          expirationMonth: 1,
        }),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Error code
// ---------------------------------------------------------------------------

describe('charge() — error code', () => {
  it('sets code 400 on InvalidCreditCard', () => {
    try {
      charge(makeRequest({ cardNumber: INVALID_CARD }));
    } catch (err: any) {
      expect(err.code).toBe(400);
    }
  });

  it('sets code 400 on UnacceptedCreditCard', () => {
    try {
      charge(makeRequest({ cardNumber: VALID_AMEX }));
    } catch (err: any) {
      expect(err.code).toBe(400);
    }
  });

  it('sets code 400 on ExpiredCreditCard', () => {
    try {
      charge(
        makeRequest({
          cardNumber: VALID_VISA,
          expirationYear: pastYear,
          expirationMonth: pastMonth,
        }),
      );
    } catch (err: any) {
      expect(err.code).toBe(400);
    }
  });
});