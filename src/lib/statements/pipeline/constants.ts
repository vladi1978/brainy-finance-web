/** Month names for locale-agnostic parsing */
export const MONTH_WORD =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Amount token: minus, currency, commas, decimals, parentheses, CR/DR */
export const AMOUNT_TOKEN =
  /[\u2212+-]?\(?[\p{Sc}]?\s*\d[\d.,]*(?:\.\d{1,2})?\s*\)?(?:\s*(?:USD|EUR|GBP|MXN|CAD|INR|JPY|AUD|NZD|CHF|CNY|KRW|BRL|CR|DR))?/giu;
