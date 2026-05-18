/** Lines usually not part of transaction tables */
export const SKIP_LINE =
  /^(?:page\s*\d+|page\s+of|P\.\s*\d+|continued\s+from|statement\s+(?:period|date|coverage|cycle)|routing|total\s+(?:debits|credits)|balance\s+carried|previous\s+balance|new\s+balance)/iu;

export const PAGE_HEADER_SIMPLE = /^(?:PAGE|Pg\.?)\s*\d+/iu;

export const DROP_LINE_METADATA =
  /\b(?:beginning\s+balance|ending\s+balance|opening\s+balance|closing\s+balance|available\s+(?:cash\s+)?balance|daily\s+balance|statement\s+summary(?:\s+totals)?|summary\s+(?:information|balances)|deposits?\s+(?:and|\/)\s+additions|withdrawals?\s+(?:and|\/)\s+subtractions|prior\s+(?:statement\s+)?balance|total\s+(?:debits|credits|payments))\b/ui;

export const ROUTING_ROUTING_IDS =
  /\b(?:routing|aba|iban|bic|swift)(?:\s*(?:number|no\.|#))?[\s:]+[\d\s-]{9,}\b/ui;

export const ACCOUNT_NUM_LIKE_LINE =
  /\b(?:acct|account)\s+(?:number|no\.|#)|\b(?:acct|account)\s*[:\u2013]#?[\s#*xX●•]*\d[\d\s*●•.-]{5,}\b|\b(?:ending\s+in|acct\s+(?:ending|closes))\s+\d{3,}\b|\*{3,}\s*\d{3,}\b|\b\d{17,}\b/ui;

export const PHONE_PRIMARY =
  /(?:\+\d{1,2}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;

export const STREET_PLUS_ZIP =
  /\d{1,5}\s+[A-Za-z0-9'.\-\\/]+\s+(?:HWY|RD|LN|LOOP|SQ|WAY|PKWY|ST|AVE|BLVD)\b[^\n]{0,100}\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/iu;

export const BANK_MARKETING_BLURB =
  /\b(?:limited\s+time|apply\s+today\b|bonus\s+(?:mile|reward|cash)\b|exclusive\s+rates\b|earn\s+rewards\b|switch\s+(?:banks?|financial)\b|visit\s+(?:www|https?:\/\/))\b/ui;

export const OVERDRAFT_NOTICE =
  /\b(?:overdraft|(?:non|nsf)[-\s]*sufficient\s+funds).*?(?:protection|coverage|plans?|explain)|\bo\.?\s*d\.?\s+fee\b.*\bexplain/ui;

export const LEGAL_SENTENCE_GUARD =
  /\b(?:hereinafter|accordingly\s+therefore|arbitration|class\s+action\s+waiver|limitation\s+of\s+liability|\bYOU\s+(?:UNDERSTAND|AGREE))\b/ui;

export const NOISE_DESCRIPTION =
  /\b(?:beginning\s+balance|ending\s+balance|opening\s+balance|closing\s+balance|previous\s+balance|available\s+balance|daily\s+balance|minimum\s+payment|payment\s+due|interest\s+(?:charged|earned)|annual\s+percentage)\b/i;

/** Support, legal, generic banking boilerplate (scoring penalty, not hard drop) */
export const SUPPORT_LEGAL_BOILERPLATE =
  /\b(?:customers?\s+service|important\s+information|privacy\s+(?:notice|policy)|\bbanking\b|\b(?:bank\s+)?statement\b|cust\.?\s*svc|cust\.?\s*care|marketing\s+e-?mail|member\s+(?:FDIC|SIPC)|deposit\s+accounts|online\s+banking)\b/ui;

export const SOFT_BOILERPLATE =
  /\b(?:visit\s+(?:your\s+|our\s+|http|www)|call\s+us|write\s+us|www\.)\b/ui;

/** Account summary / header wording — strong negative for txn classification */
export const ACCOUNT_SUMMARY_WORDING =
  /\b(?:account\s+summary|summary\s+of\s+accounts|checking\s+summary|savings\s+summary|credit\s+card\s+summary|rewards\s+summary|minimum\s+due|credit\s+limit|available\s+credit)\b/ui;
