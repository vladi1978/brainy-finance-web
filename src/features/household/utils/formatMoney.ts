export function formatUsdFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(dollars);
}
