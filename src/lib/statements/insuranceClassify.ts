/**
 * Deterministic insurance-payment classification from merchant/descriptor text.
 * Does not infer coverage, deductibles, policy quality, or savings.
 */

export type InsuranceProductType =
  | "auto"
  | "home"
  | "renters"
  | "life"
  | "health"
  | "commercial"
  | "unknown";

export type InsuranceClassification = {
  isInsurance: boolean;
  type: InsuranceProductType;
  brand?: string;
  confidence: number;
  evidence: string[];
};

const NOT_INSURANCE: InsuranceClassification = {
  isInsurance: false,
  type: "unknown",
  confidence: 0,
  evidence: [],
};

/** Explicit non-insurance lookalikes (leasing, rent-to-own, etc.). */
const NEGATIVE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\bPROGRESSIVE\s+LEASING\b/u,
    label: "progressive_leasing",
  },
  {
    re: /\b(RENT[\s-]*A[\s-]*CENTER|RENTACENTER|AARON'?S|FLEXSHOPPER|ACIMA\s+LEASING|RENT[\s-]*2[\s-]*OWN)\b/u,
    label: "rent_to_own_leasing",
  },
  {
    re: /\bSELF[\s-]*INSURANCE\b|\bSELF[\s-]*INSURED\b/u,
    label: "self_insurance",
  },
];

type BrandRule = {
  brand: string;
  re: RegExp;
  /** When set, brand alone is strong enough for a product type. */
  defaultType?: InsuranceProductType;
  /** Brand only counts when a generic/type insurance token is also present. */
  requireInsuranceToken?: boolean;
};

const BRAND_RULES: BrandRule[] = [
  { brand: "GEICO", re: /\bGEICO\b/u, defaultType: "auto" },
  { brand: "State Farm", re: /\bSTATE\s+FARM\b/u },
  /**
   * Progressive collides with Progressive Leasing — require an insurance token
   * in the same blob (leasing is also excluded via NEGATIVE_PATTERNS).
   */
  {
    brand: "Progressive",
    re: /\bPROGRESSIVE\b/u,
    defaultType: "auto",
    requireInsuranceToken: true,
  },
  { brand: "Allstate", re: /\bALLSTATE\b/u },
  { brand: "Liberty Mutual", re: /\bLIBERTY\s+MUTUAL\b/u },
  { brand: "USAA", re: /\bUSAA\b/u },
  { brand: "Farmers", re: /\bFARMERS\s+(INS|INSURANCE)\b|\bFARMERS\s+INS\b/u },
  { brand: "Nationwide", re: /\bNATIONWIDE\b/u },
  { brand: "Travelers", re: /\bTRAVELERS\b/u },
  { brand: "Erie", re: /\bERIE\s+INS/u },
  { brand: "American Family", re: /\bAMERICAN\s+FAMILY\b/u },
  { brand: "Humana", re: /\bHUMANA\b/u, defaultType: "health" },
  { brand: "Aetna", re: /\bAETNA\b/u, defaultType: "health" },
  { brand: "Cigna", re: /\bCIGNA\b/u, defaultType: "health" },
  { brand: "Kaiser", re: /\bKAISER\b/u, defaultType: "health" },
  {
    brand: "Blue Cross",
    re: /\bBLUE\s+CROSS\b|\bBCBS\b|\bELEVANCE\b/u,
    defaultType: "health",
  },
];

const TYPE_RULES: Array<{ type: InsuranceProductType; re: RegExp; label: string }> =
  [
    {
      type: "auto",
      re: /\b(AUTO\s+INS|AUTOMOBILE\s+INS|CAR\s+INS|VEHICLE\s+INS|MOTOR\s+VEHICLE)\b/u,
      label: "auto_token",
    },
    {
      type: "home",
      re: /\b(HOMEOWNERS?\s+INS|HOME\s+INS|HOI\b|HAZARD\s+INS|DWELLING\s+INS)\b/u,
      label: "home_token",
    },
    {
      type: "renters",
      re: /\b(RENTERS?\s+INS|RENTAL\s+INS)\b/u,
      label: "renters_token",
    },
    {
      type: "life",
      re: /\b(LIFE\s+INS|TERM\s+LIFE|WHOLE\s+LIFE)\b/u,
      label: "life_token",
    },
    {
      type: "health",
      re: /\b(HEALTH\s+INS|MEDICAL\s+INS|DENTAL\s+PREM|DENTAL\s+INS|VISION\s+INS)\b/u,
      label: "health_token",
    },
    {
      type: "commercial",
      re: /\b(COMMERCIAL\s+INS|BUSINESS\s+INS|BOP\b|LIABILITY\s+INS)\b/u,
      label: "commercial_token",
    },
  ];

const GENERIC_INSURANCE_RE =
  /\b(INSURANCE|INS\s+PREM|INS\s+PREMIUM|INS\s+PYMT|INS\s+PAYMENT|PREMIUM\s+INS)\b/u;

function normalizeBlob(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim().toUpperCase();
}

/**
 * Classify a merchant / statement descriptor as an insurance-related payment.
 */
export function classifyInsurancePayment(
  text: string | null | undefined
): InsuranceClassification {
  if (!text || !String(text).trim()) return NOT_INSURANCE;
  const blob = normalizeBlob(text);
  const evidence: string[] = [];

  for (const neg of NEGATIVE_PATTERNS) {
    if (neg.re.test(blob)) {
      return {
        isInsurance: false,
        type: "unknown",
        confidence: 0.95,
        evidence: [`exclude:${neg.label}`],
      };
    }
  }

  let type: InsuranceProductType = "unknown";
  for (const rule of TYPE_RULES) {
    if (rule.re.test(blob)) {
      type = rule.type;
      evidence.push(rule.label);
      break;
    }
  }

  const generic = GENERIC_INSURANCE_RE.test(blob);
  if (generic) evidence.push("generic_insurance_token");

  const hasInsuranceToken = generic || type !== "unknown";

  let brand: string | undefined;
  let brandDefaultType: InsuranceProductType | undefined;
  for (const rule of BRAND_RULES) {
    if (!rule.re.test(blob)) continue;
    if (rule.requireInsuranceToken && !hasInsuranceToken) continue;
    brand = rule.brand;
    brandDefaultType = rule.defaultType;
    evidence.push(`brand:${rule.brand}`);
    break;
  }

  const isInsurance = Boolean(brand) || generic || type !== "unknown";
  if (!isInsurance) return NOT_INSURANCE;

  if (type === "unknown" && brandDefaultType) {
    type = brandDefaultType;
    evidence.push(`brand_default_type:${brandDefaultType}`);
  }

  let confidence = 0.55;
  if (brand && type !== "unknown") confidence = 0.92;
  else if (brand) confidence = 0.85;
  else if (type !== "unknown") confidence = 0.8;
  else if (generic) confidence = 0.7;

  return {
    isInsurance: true,
    type,
    brand,
    confidence,
    evidence,
  };
}

/** Display label when subtype is unknown. */
export const INSURANCE_TYPE_NOT_CONFIRMED = "Insurance — type not confirmed";

export function insuranceTypeDisplayLabel(
  classification: InsuranceClassification
): string {
  if (!classification.isInsurance) return "";
  switch (classification.type) {
    case "auto":
      return "Auto insurance";
    case "home":
      return "Homeowners insurance";
    case "renters":
      return "Renters insurance";
    case "life":
      return "Life insurance";
    case "health":
      return "Health insurance";
    case "commercial":
      return "Commercial insurance";
    default:
      return INSURANCE_TYPE_NOT_CONFIRMED;
  }
}

/** Neutral copy — no savings claims. */
export const INSURANCE_OBSERVED_NEUTRAL =
  "An insurance-related payment was observed in this statement. Comparison options may be available, but no savings estimate has been calculated.";

export function isInsuranceRelatedText(text: string | null | undefined): boolean {
  return classifyInsurancePayment(text).isInsurance;
}
