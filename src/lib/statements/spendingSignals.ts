/**
 * Merchant/text signals for Spending Insights (non-subscription spend buckets).
 */
import type { MerchantCluster, SpendingInsightCategory } from "./types";

export function inferSpendingInsightCategory(
  cluster: MerchantCluster
): SpendingInsightCategory {
  const blob =
    `${cluster.descriptions.join(" ")} ${cluster.key}`.toUpperCase();

  if (
    /\b(PAYROLL|NÓMINA|NOMINA|NET\s+PAY|GROSS\s+PAY|SALARY|HOURLY\s+PAY|WAGE)\b/u.test(
      blob
    )
  ) {
    return "payroll";
  }

  if (
    /\b(DIRECT\s+DEP|DIR\s+DEP)\b/u.test(blob) &&
    /\b(EMPLOY|SALARY|PAYROLL|WAGE)\b/u.test(blob)
  ) {
    return "payroll";
  }

  if (
    /\b(VENMO|ZELLE|PAYPAL|WISE|REVOLUT|CASH\s*APP)\b.*\b(SEND|RECV|TRANSFER|TRANSF|PAGO|SENT)\b/u.test(
      blob
    ) ||
    /\b(TRANSFER|TRANSF|XFER|TRF|IFT|INT\s+PAY|SPEI|IBAN\s+PAY|\bWIRE\s+TRANS\b|\bOUTGOING\s+WIRE\b|\bINCOMING\s+WIRE\b|\bWIRE\s+XFER\b)\b/u.test(
      blob
    )
  ) {
    return "transfers";
  }

  if (
    /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|OD\s+PAY|MAINT(?:ENANCE)?\s+FEE|SERVICE\s+FEE|MONTHLY\s+FEE|ACCOUNT\s+FEE|NSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS)\b/u.test(
      blob
    )
  ) {
    return "fees";
  }

  if (
    /\b(LIQUOR|WINE\s+SPIRITS|SPIRITS\s+SHOP|ABC\s+FINE\s+WINE|TOTAL\s+WINE|BEVMO)\b/ui.test(
      blob
    )
  ) {
    return "liquor";
  }

  if (
    /\b(STARBUCKS|DUNKIN|CARIBOU\s+COFFEE|PEETS|\bCAFE\b|\bCOFFEE\b|ESPRESSO|\bKAFE\b)\b/ui.test(
      blob
    )
  ) {
    return "cafes";
  }

  if (
    /\b(RESTAURANT|\bGRILL\b|\bDINER\b|MCDONALD|CHIPOTLE|TACO\s+BELL|SUBWAY|PANDA\s+EXPRESS|DOORDASH|UBER\s*EATS|GRUBHUB)\b/ui.test(
      blob
    )
  ) {
    return "restaurants";
  }

  if (
    /\b(KROGER|PUBLIX|SAFEWAY|ALDI|WHOLE\s+FOODS|TRADER\s+JOES|\bGIANT\b|FOOD\s+LION|WEIS\s+MARKETS|\bMEIJER\b|\bHY\s*VEE\b)\b/ui.test(
      blob
    ) ||
    /\b(GROCERY|SUPERMARKET|\bMARKET\b).*?\b(STORE|SHOP)\b/ui.test(blob)
  ) {
    return "groceries";
  }

  if (
    /\b(SHELL\b|EXXON|CHEVRON|\bBP\b|\bMOBIL\b|TEXACO|MARATHON|SPEEDWAY|WAWA\b|QT\b|QUIK\s+TRIP|LOVE'?S\b|\bRACETRAC\b|FUEL\b|\bGAS\b.*\b(STATION|PUMP))\b/ui.test(
      blob
    )
  ) {
    return "gas";
  }

  if (
    /\b(TARGET\b|WAL\s*-?\s*MART|WALMART|DOLLAR\s+GENERAL|DOLLAR\s+TREE|FAMILY\s+DOLLAR|CVS\b|WALGREENS|ROSS\b|TJ\s*MAXX|MARSHALLS|HOME\s+DEPOT|LOWE'?S\b|BEST\s+BUY|KOH'?S\b|OLD\s+NAVY|GAP\b|NIKE\b|\bTJMAXX\b)\b/ui.test(
      blob
    )
  ) {
    return "retail";
  }

  if (
    /\b(MORTGAGE|HOME\s+LOAN|MORT\s+PMT|MORTG\s+PMT|ESCROW)\b/ui.test(blob)
  ) {
    return "other";
  }

  const debits = cluster.charges.filter((c) => c.type === "debit");
  if (debits.length <= 1) {
    return "one_time_purchase";
  }

  return "other";
}

export function spendingCategoryDisplay(cat: SpendingInsightCategory): string {
  switch (cat) {
    case "groceries":
      return "Groceries";
    case "liquor":
      return "Liquor";
    case "restaurants":
      return "Food / dining";
    case "cafes":
      return "Food / cafe";
    case "retail":
      return "Retail";
    case "gas":
      return "Gas";
    case "transfers":
      return "Transfers";
    case "fees":
      return "Fees";
    case "payroll":
      return "Payroll / income-related";
    case "one_time_purchase":
      return "Purchase";
    case "other":
    default:
      return "Other";
  }
}
