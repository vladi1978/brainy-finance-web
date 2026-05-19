# Product compare — architecture & legacy paths

This document describes the **current** compare pipeline (Phase 1 cleanup — documentation only).
It marks dead or legacy code **without** removing it. See [Forbidden removals](#phase-2-not-yet) for planned later work.

**Public entry:** `@/lib/product/engine` → `compareProduct()` implemented in `compareEngine.ts`.

---

## Active compare flow

```
UI  /compare  (src/app/compare/page.tsx)
  →  POST /api/compare-product  (src/app/api/compare-product/route.ts)
  →  compareProduct()  (engine.ts → compareEngine.ts)
  →  parseProductInput()  (inputParse.ts + urlProductQuery.ts)
  →  [optional] PDP extraction when input is a URL
        registry.findProductProviderForUrl() → provider.extractSourceProduct()
        OR generic scrapeProduct() fallback
  →  normalize + criticalAttributes + AI metadata/enrichment
  →  build shopping query plan(s)
  →  fetchGoogleShoppingCandidatesWithDiagnostics()  (googleShoppingSearch.ts)
        requires SERPER_API_KEY and/or SERPAPI_API_KEY (unless demo mode)
  →  dedupe → scoreAttributeMatch() → scoreProductIdentity()
  →  productUrlResolver + affiliateUrl → API response → UI
```

`/dashboard` redirects to `/compare` (`src/app/dashboard/page.tsx`).

### Discovery (important)

**Cross-store candidate discovery uses Google Shopping** via Serper (`SERPER_API_KEY`) or SerpAPI (`SERPAPI_API_KEY`), not per-retailer HTML SERP modules.

Set `PRODUCT_COMPARE_DEMO_MODE=true` to skip live shopping API and return synthetic listings.

Optional: `OPENAI_API_KEY` for `aiProductMetadata` / `aiCompareEnrichment` (skipped in demo mode).

### Providers (important)

Registered retailers in `registry.ts` are used in the **live** flow primarily for **PDP extraction** when the user pastes a product URL:

- `findProductProviderForUrl(url)` → `extractSourceProduct(url)`
- If no provider matches, `compareEngine` falls back to generic `scrapeProduct(url)`.

`ProductProvider.searchCandidates` exists on the interface but is **not called** by `compareProduct` today. Implementations in `searchParse.ts` / individual providers are **legacy**.

### Matching (live)

| Layer | Module | Role |
|-------|--------|------|
| Hard gates + structured score + query overlap | `attributeMatch.ts` → `matching/universalMatchEngine.ts` | Reject / score candidates |
| UI tier (`exact_match`, `close_match`, `alternative`) | `matching/productIdentity.ts` | Badges and ordering input |

`match.ts` re-exports universal helpers and deprecated APIs; the API path does **not** call `evaluateCandidate`.

### Category-specific rules (technical debt)

TV display tech, Samsung-style SKU compaction, pool phrases, and similar logic are spread across `compareEngine.ts`, `normalize.ts`, `criticalAttributes.ts`, and `matching/*`.

**Goal for a later phase:** move these into **category plugins** (data-driven profiles) instead of inline regex in the orchestrator. Do not add new hardcoded TV/pool branches in `compareEngine` without a migration plan.

---

## Active files (production path)

### App & API

| File | Role |
|------|------|
| `src/app/compare/page.tsx` | Compare UI |
| `src/app/api/compare-product/route.ts` | Compare API |
| `src/app/dashboard/page.tsx` | Redirect to `/compare` |

### Orchestration & input

| File | Role |
|------|------|
| `engine.ts` | Public barrel; exports `compareProduct` |
| `compareEngine.ts` | Main orchestrator |
| `types.ts` | Shared types |
| `inputParse.ts` | URL vs text input |
| `urlProductQuery.ts` | Slug / ASIN / short URL helpers |
| `manualProductInput.ts` | Manual form → query pack |

### Source product (PDP)

| File | Role |
|------|------|
| `registry.ts` | Provider registry |
| `providers/*.provider.ts` | Per-store `extractSourceProduct` |
| `providers/retailProviderFactory.ts` | Factory for basic retailers |
| `scrapeProduct.ts` | Generic HTML PDP scrape |
| `usablePdpTitle.ts` | Validates scraped title |

### Discovery & candidates

| File | Role |
|------|------|
| `googleShoppingSearch.ts` | **Active** shopping search |
| `candidateDedupe.ts` | URL dedupe for shopping rows |
| `productDetailUrl.ts` | PDP vs search URL validation |
| `productUrlResolver.ts` | Outbound product/search URLs |
| `affiliateUrl.ts` | Affiliate formatting (e.g. Amazon tag) |

### Normalization & AI

| File | Role |
|------|------|
| `normalize.ts` | Structured product / brand / size |
| `criticalAttributes.ts` | Critical shopping phrases |
| `aiExtractor.ts` | Reference understanding |
| `aiProductMetadata.ts` | LLM metadata + search queries |
| `aiCompareEnrichment.ts` | LLM shopping queries / exclusions |

### Matching

| File | Role |
|------|------|
| `attributeMatch.ts` | Live attribute scoring |
| `searchRelevance.ts` | Query ↔ title token overlap |
| `matching/universalMatchEngine.ts` | Universal gates & similarity |
| `matching/snapshot.ts` | Match snapshots |
| `matching/weightProfiles.ts` | Category weights |
| `matching/attributeKeys.ts` | Attribute key union |
| `matching/productIdentity.ts` | UI identity tier |

### Post-process (called, mostly no-op)

| File | Role |
|------|------|
| `searchPdpResolve.ts` | `resolveDisplayedSearchPdps` — currently passthrough (SERP second-pass disabled) |

### Premium (UI)

| File | Role |
|------|------|
| `src/lib/premium/couponOffers.ts` | Simulated coupons on candidates |
| `src/lib/premium/storeBranding.ts` | Store labels/logos in UI |

---

## Legacy / dead paths (do not use for new features)

These modules remain in the repo for reference or a future Phase 2 removal. **Nothing in the live `compareProduct` path depends on them.**

### `src/lib/price-engine.ts` (outside `product/`)

| Status | Detail |
|--------|--------|
| **Dead** | No imports anywhere in the app |
| Replaced by | `@/lib/product/engine` → `compareProduct` |
| Notes | Stub with fixed `$60` price; `comparePrices()` throws |

### `src/lib/product/searchParse.ts`

| Status | Detail |
|--------|--------|
| **Dead in live compare** | Only used from `provider.searchCandidates` and disabled PDP-resolve code |
| Contains | Per-retailer HTML SERP fetch/parse (Amazon, Walmart, Target, Temu, Best Buy, …) |
| Replaced by | `googleShoppingSearch.ts` for discovery |

### `ProductProvider.searchCandidates`

| Status | Detail |
|--------|--------|
| **Dead in live compare** | No `.searchCandidates(` call sites in the codebase |
| Implementations | Amazon/Walmart/Target/Temu (real SERP); `retailProviderFactory` returns empty candidates + diagnostic hint `retailer_compare_uses_google_shopping_pipeline` |
| Live method | `extractSourceProduct` only |

### `match.evaluateCandidate` (and related exports)

| Status | Detail |
|--------|--------|
| **Dead in live API** | Re-exported from `engine.ts` for backward compatibility |
| Replaced by | `scoreAttributeMatch` + `scoreProductIdentity` |
| Also legacy | `MIN_COMPARABLE_SCORE_TV`, `MIN_COMPARABLE_SCORE_OTHER` (unused by universal scorer), `scoreTvStructured` facade |

### Other legacy / removed (git history)

The following were removed during migration to this pipeline; do not reintroduce without reading git history:

- `src/lib/product/comparison/*` (`runCompareProduct`, `rankSerp`, …)
- `src/lib/product/extractors/*`
- `src/lib/product/normalization/*`
- `detectInputType.ts`, `detectStore.ts`, `stores.ts`, `normalizeQuery.ts`
- `providers/base.ts`, `providers/search-result.ts`

---

## UI vs backend note

The compare page may describe store-direct listings. **Server-side discovery still goes through Google Shopping** (Serper/SerpAPI) unless demo mode is enabled. Outbound links are resolved per retailer via `productUrlResolver` (product PDP vs store search URL).

---

## Environment variables (compare)

| Variable | Purpose |
|----------|---------|
| `SERPER_API_KEY` | Google Shopping via Serper |
| `SERPAPI_API_KEY` | Google Shopping via SerpAPI (fallback) |
| `PRODUCT_COMPARE_DEMO_MODE` | Synthetic candidates, no SERP |
| `OPENAI_API_KEY` | Optional AI metadata/enrichment |
| `OPENAI_COMPARE_MODEL`, `OPENAI_COMPARE_TIMEOUT_MS` | AI compare tuning |
| `AMAZON_ASSOCIATE_TAG` | Amazon affiliate tag on outbound URLs |
| `PRODUCT_SHOPPING_DEBUG`, `PRODUCT_SERP_DEBUG` | Verbose logging (dev only) |

---

## Phase 2 (not yet)

Planned later — **do not do in Phase 1:**

- Delete `price-engine.ts`, `searchParse.ts`, unused `searchCandidates` implementations
- Remove `evaluateCandidate` and deprecated `engine.ts` exports
- Commit / finalize removal of old `comparison/`, `extractors/`, `normalization/` trees
- Refactor TV/pool rules into category plugins

Until Phase 2, treat this file as the source of truth for what is active vs legacy.
