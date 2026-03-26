declare module 'simple-card-validator' {
  interface CardDetails {
    card_type: string;
    valid: boolean;
  }

  interface CardInfo {
    getCardDetails(): CardDetails;
  }

  function cardValidator(cardNumber: string): CardInfo;
  export = cardValidator;
}