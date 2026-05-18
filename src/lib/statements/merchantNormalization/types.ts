export type MerchantNormalizationSource = "rules" | "openai";

export type MerchantNormalizationResult = {
  normalizedName: string;
  rawExamples: string[];
  confidence: number;
  reason: string;
  source: MerchantNormalizationSource;
};

export type MerchantNormalizationDiagnostic = MerchantNormalizationResult & {
  clusterId: string;
  rawMerchant: string;
};

