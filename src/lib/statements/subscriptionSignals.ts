/**
 * Pattern-based signals for subscription-like merchants (generic categories /
 * SaaS-ish words). Not a fixed brand roster — reinforces detection when the LLM is conservative.
 */
import type { MerchantCluster, SubscriptionCategory } from "./types";
import { classifyInsurancePayment } from "./insuranceClassify";

const SUBSCRIPTION_LIKE_PATTERN = new RegExp(
  [
    String.raw`\bAPPLE(\.COM|\/|\s*BILL|\s+PAY)\b`,
    String.raw`\bAPP\s+STORE\b`,
    String.raw`\b(ITUNES|ICLOUD)\b`,
    String.raw`\b(GOOGLE|YOUTUBE(\s+MUSIC|\s+PREMIUM|\s+SUB|\s+PREM)?|ANDROID\b|GOOGLE\s*ONE)\b`,
    String.raw`\bMICROSOFT\b|\bMSFT\b|\bXBOX\b`,
    String.raw`\b(ADBE|ADOBE)\b`,
    String.raw`\bCANVA\b`,
    String.raw`\b(NETFLIX|HULU\b|DISNEY\b|PEACOCK|SHOWTIME|STARZ|HBO\b|APPLE\s+TV)\b`,
    String.raw`\bSPOTIFY\b|\bAPPLE\s+MUSIC\b`,
    String.raw`\bAMAZON\s+(PRIME|VIDEO|DIGITAL|WEB\s*SERV|DIGITAL\s*SERV|AWD|MUSIC)\b|\bPRIME\s+VIDEO\b`,
    String.raw`\b(DROPBOX|DIGITAL\s*OCEAN|HEROKU|VERCEL|SALESFORCE|P\.?\s?AWS\b)\b|\b/AWS\b|\bAWS\.`,
    String.raw`\b(OPEN\s*AI|OPENAI|CHATGPT|CHAT\s*GPT|ANTHROPIC|CLAUDE\.?AI|\bCLAUDE\b|MIDJOURNEY)\b`,
    String.raw`\b(SOFTWARE|SUBSCR(IP)?|SUBSCRIPTION|MEMBERSHIP|RECURRING)\b`,
    String.raw`\b(STORAGE\b|CLOUD\b|FILE\s+HOST\b|GOOGLE\s*DRIVE|ONEDRIVE|BOX\.COM|NOTION\s+AI)\b`,
    String.raw`\b(GYM\b|\bFITNESS\b|PLANET\s+FIT|PRIVATE\s+EQUINO?X|PEL(OT)?ON\b|WHOOP)\b`,
    String.raw`\b(VERIZON|AT\s*&\s*T|\bATT\b|SPRINT|T[-\s]*MOBILE|COMCAST|XFINITY|SPECTRUM|COX\s+CABLE|CENTURY\s*LINK|FRONTIER)\b`,
    String.raw`\b(INTERNET|WIFI|DSL\b|\bISP\b|\bFIBER\b|\bHIGH\s+SPEED\s+CONN)\b`,
    String.raw`\bPHONE\b|\bMOBILE\s+BILL\b|\bWIRELESS\s+SERV(IC)?(ICES)?\b`,
    String.raw`\b(DUOLINGO|HEADSPACE|\bCALM\b|NORDVPN|PASSWORD\s*MANAGER)\b`,
  ].join("|"),
  "iu"
);

export function merchantTextSignals(description: string, keyUpper: string): {
  subscriptionLike: boolean;
  categoryHint: SubscriptionCategory | null;
} {
  const blob = `${description} ${keyUpper}`;
  const insurance = classifyInsurancePayment(blob);

  let categoryHint: SubscriptionCategory | null = null;

  if (insurance.isInsurance) {
    categoryHint = "insurance";
  } else if (
    /\b(NETFLIX|HULU\b|DISNEY|PEACOCK|SHOWTIME|AMAZON\s+PRIME|\bPRIME\b|APPLE\s+TV|STREAM\b)\b/ui.test(
      blob
    )
  ) {
    categoryHint = "streaming";
  } else if (/\bSPOTIFY\b|\bAPPLE\s+MUSIC\b|\bYOUTUBE\s+(PREMIUM|MUSIC)\b/ui.test(blob)) {
    categoryHint = "music";
  } else if (/\bGYM\b|\bFITNESS\b|\bPEL(OT)?ON\b|\bWHOOP\b|EQUINO?X\b/ui.test(blob)) {
    categoryHint = "fitness";
  } else if (
    /\b(ANTHROPIC|CLAUDE\.?AI|\bCLAUDE\b|OPEN\s*AI|OPENAI|CHATGPT|CHAT\s*GPT|MIDJOURNEY)\b/ui.test(blob)
  ) {
    categoryHint = "ai_tools";
  } else if (
    /\b(ICLOUD|GOOGLE\s*DRIVE|ONEDRIVE|BOX\.COM|DROPBOX\b).*\b(PLUS|PRO|STORAGE|CLOUD)\b/ui.test(blob) ||
    /\b(DROPBOX|GOOGLE\s*WORKSPACE|ONEDRIVE|MICROSOFT\s*365\s*BACKUP)\b/ui.test(blob)
  ) {
    categoryHint = "cloud_storage";
  } else if (
    /\b(COMCAST|XFINITY|SPECTRUM|ELECTRIC\b|POWER\b|WATER\b|NATURAL\s+GAS)\b/ui.test(blob)
  ) {
    categoryHint = "utilities";
  } else if (
    /\b(APPLE|ADOBE|MICROSOFT|GOOGLE|CANVA|SAA?S|DROPBOX|MICRO\s*365|WINDOWS\b)\b/ui.test(blob)
  ) {
    categoryHint = "software";
  }

  const subscriptionLike =
    SUBSCRIPTION_LIKE_PATTERN.test(blob) || insurance.isInsurance;

  return { subscriptionLike, categoryHint };
}

export function clusterLooksSubscriptionMerchant(cluster: MerchantCluster): boolean {
  const blob = [...cluster.descriptions.slice(0, 5), cluster.key].join(" ");
  const { subscriptionLike } = merchantTextSignals(blob, cluster.key);
  return subscriptionLike;
}

/** Single charge allowed when narration matches unmistakable SaaS / insurer billing rails. */
export function unmistakableSubscriptionBillingMerchant(
  cluster: MerchantCluster
): boolean {
  const blob =
    [...cluster.descriptions.slice(0, 6), cluster.key].join(" ").toUpperCase();

  if (classifyInsurancePayment(blob).isInsurance) return true;

  return /\b(NETFLIX|PEACOCK|SPOTIFY|HULU|DISNEY\+?|\bHBO\b|APPLE\.COM\/BILL|\bICLOUD\b|\bITUNES\b|GOOGLE\s*ONE|YOUTUBE\s+(PREMIUM|MUSIC)|\bADOBE\b|MICROSOFT\s+365|OFFICE\s+365|MICRO\s*365|AMAZON\s+(PRIME|VIDEO|DIGITAL|MUSIC)|PRIME\s+VIDEO|OPEN\s*AI|OPENAI|CHATGPT|CHAT\s*GPT)\b/ui.test(
    blob
  );
}
