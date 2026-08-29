# Brainy — first protected Vercel deployment checklist

Do **not** treat this document as permission to deploy. Complete every gate below before creating/linking a Vercel project and promoting a public URL.

## Launch posture (required for v1)

| Setting | First launch |
| --- | --- |
| Shopping provider | **One** live key: `SERPER_API_KEY` (preferred) or `SERPAPI_API_KEY` |
| `OPENAI_ENRICHMENT_ENABLED` | **Omit / false** — heuristics-only statements |
| `OPENAI_STATEMENT_EXPLANATION_ENABLED` | **Omit / false** — no paid explanation calls |
| `OPENAI_API_KEY` | Prefer **omit** until a hard spend cap exists |
| `PRODUCT_COMPARE_DEMO_MODE` | **Omit / false** |
| `CRON_SECRET` | **Omit** (cron stays fail-closed in production) |
| Platform rate limits / WAF | **Required** before sharing the URL |

## Variables intentionally omitted for first launch

- `OPENAI_ENRICHMENT_ENABLED` / paid OpenAI enrichment models
- `OPENAI_STATEMENT_EXPLANATION_ENABLED` / statement explanation models
- `CRON_SECRET` and scheduled price-alert cron
- `PRODUCT_COMPARE_DEMO_MODE`
- Affiliate partner IDs (`AMAZON_ASSOCIATE_TAG`, etc.)
- All `DEBUG_*` / `PRODUCT_*_DEBUG` flags

## Statement AI explanation (separate from enrichment)

| Variable | Safe default | Notes |
| --- | --- | --- |
| `OPENAI_STATEMENT_EXPLANATION_ENABLED` | unset / `false` | Never enables enrichment |
| `OPENAI_STATEMENT_EXPLANATION_MODEL` | `gpt-4o-mini` | Override only when enabling |
| `OPENAI_STATEMENT_EXPLANATION_TIMEOUT_MS` | `12000` | Abort budget |
| `OPENAI_API_KEY` | omit until spend cap | Shared key; gates remain independent |

In-app rate limiting for `POST /api/statements/explain` is **per serverless instance only**. Configure platform WAF / edge limits before enabling.

## Build

```bash
npm run build
# or: npx next build
```

Framework preset: Next.js. Output: standard Next.js app (no custom export required).

## Before public promotion

1. Configure **Vercel WAF / rate limiting** (or equivalent) on public `POST` routes:
   - `/api/compare-product`
   - `/api/shopping-assistant`
   - `/api/statements/analyze`
   - `/api/statements/explain`
2. Set a hard **OpenAI spend cap** (provider dashboard) **before** setting `OPENAI_ENRICHMENT_ENABLED=true` or `OPENAI_STATEMENT_EXPLANATION_ENABLED=true`.
3. Confirm Serper (or SerpAPI) prepaid/budget alerts.
4. Confirm production env does **not** set `PRODUCT_COMPARE_DEMO_MODE=true`.

## Post-deploy smoke tests

1. `/` loads; sidebar shows Compare, Shopping assistant, Statements only.
2. Compare (electronics): paste or describe a product with reference price — live listings, no “Demo mode” banner.
3. Shopping assistant: “AA batteries” and “65 inch TV” return ranked options.
4. Statements: upload a text-selectable PDF — heuristic analysis completes without OpenAI.
5. Statements “Explain with AI” with explanation flag off → deterministic fallback, no provider error text.
6. Direct `POST /api/cron/price-alerts` without secret → **503** in production.
7. With demo mode left off and shopping keys removed (staging only) → clear “shopping not configured” error (not silent empty success).

## Rollback

1. In the host dashboard, instant rollback to the previous deployment.
2. Or unset `SERPER_API_KEY` / `SERPAPI_API_KEY` to fail-closed shopping while keeping the site up.
3. Keep `OPENAI_ENRICHMENT_ENABLED` unset so no paid enrichment resumes accidentally.
4. Keep `OPENAI_STATEMENT_EXPLANATION_ENABLED` unset (or set `false`) as the explanation kill switch.

## Security notes

- Secrets belong only in the host env UI — never in git.
- `.env*` is gitignored; only `.env.example` is tracked.
- Cron remains refuse-closed in production without `CRON_SECRET`.
- Statement explanation accepts **JSON sanitized fact contracts only** — never PDF uploads on `/api/statements/explain`.