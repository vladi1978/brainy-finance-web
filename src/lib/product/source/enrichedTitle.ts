import type { CandidateProduct, NormalizedProduct } from "../types";

/** Enrich listing title with brand/model/size for organic PDP site: queries. */
export function buildEnrichedTitleForOutbound(ctx: {
  title: string;
  normalized?: NormalizedProduct;
}): string {
  const parts = [ctx.title.replace(/\s+/g, " ").trim()];
  const brand =
    ctx.normalized?.brand ?? ctx.normalized?.structured?.brand ?? null;
  if (brand) {
    const b = brand.trim();
    if (b.length >= 2 && !ctx.title.toLowerCase().includes(b.toLowerCase())) {
      parts.push(b);
    }
  }
  const models = ctx.normalized?.modelTokens ?? [];
  for (const m of models.slice(0, 2)) {
    const tok = m.trim();
    if (tok.length >= 2 && !ctx.title.toLowerCase().includes(tok.toLowerCase())) {
      parts.push(tok);
    }
  }
  const size =
    ctx.normalized?.sizeInches ?? ctx.normalized?.structured?.sizeInches ?? null;
  if (size != null && Number.isFinite(size)) {
    const sizeStr = `${size}"`;
    if (!ctx.title.includes(String(size))) parts.push(sizeStr);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function enrichedTitleFromCandidate(c: CandidateProduct): string {
  return buildEnrichedTitleForOutbound({
    title: c.title,
    normalized: c.normalized,
  });
}
