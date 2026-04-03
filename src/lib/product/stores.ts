import { SupportedStore } from "./types";

export const SUPPORTED_STORES: SupportedStore[] = [
  "amazon",
  "walmart",
  "target",
  "temu",
  "generic",
];

export const STORE_DOMAINS: Record<SupportedStore, string[]> = {
  amazon: ["amazon.com", "amzn.to"],
  walmart: ["walmart.com"],
  target: ["target.com"],
  temu: ["temu.com"],
  generic: [],
  unknown: [],
};

export const STORE_LABELS: Record<SupportedStore, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  target: "Target",
  temu: "Temu",
  generic: "Generic",
  unknown: "Unknown",
};