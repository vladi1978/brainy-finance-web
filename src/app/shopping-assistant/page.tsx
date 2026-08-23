"use client";

import { useState } from "react";
import type {
  ShoppingAssistantOption,
  ShoppingAssistantResult,
} from "@/lib/product/shoppingAssistant";

const SAMPLES = [
  "I need AA batteries.",
  "I need a 65 inch TV.",
  "I need a cordless drill.",
] as const;

function formatPrice(price: number | null, currency: string): string {
  if (price == null || !Number.isFinite(price)) return "Unavailable";
  if (currency === "USD") return `$${price.toFixed(2)}`;
  return `${currency} ${price.toFixed(2)}`;
}

function formatUnitPrice(
  pricePerUnit: number | null,
  currency: string
): string {
  if (pricePerUnit == null || !Number.isFinite(pricePerUnit)) return "Unavailable";
  if (currency === "USD") return `$${pricePerUnit.toFixed(2)} each`;
  return `${currency} ${pricePerUnit.toFixed(2)} each`;
}

function ListingCard({
  option,
  unconfirmedSize,
}: {
  option: ShoppingAssistantOption;
  unconfirmedSize?: boolean;
}) {
  return (
    <article className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      {option.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.imageUrl}
          alt=""
          className="h-24 w-24 shrink-0 rounded-xl object-cover bg-black/40"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-black/40 text-[11px] text-white/35">
          No image
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-white">{option.title}</h3>
          {option.amazonListing ? (
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
              Amazon listing
            </span>
          ) : null}
          {unconfirmedSize ? (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
              Screen size not confirmed in source data
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-white/70">
          {option.retailer} · {formatPrice(option.price, option.currency)}
          {" · "}
          {option.packCount == null
            ? "Pack count unavailable"
            : `${option.packCount}-pack`}
          {" · "}
          {formatUnitPrice(option.pricePerUnit, option.currency)}
          {option.rating == null
            ? " · Rating unavailable"
            : ` · ${option.rating} stars`}
        </p>
        {Object.keys(option.specifications).length > 0 ? (
          <p className="mt-2 text-xs text-white/50">
            {Object.entries(option.specifications)
              .map(([key, value]) => `${key}: ${value}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="mt-2 text-xs text-white/40">
            Additional specifications unavailable.
          </p>
        )}
        <a
          href={option.productUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-emerald-300 hover:underline"
        >
          Open listing
        </a>
      </div>
    </article>
  );
}

export default function ShoppingAssistantPage() {
  const [request, setRequest] = useState<string>(SAMPLES[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ShoppingAssistantResult | null>(null);

  const run = async (text: string) => {
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/shopping-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: text }),
      });
      const payload = (await response.json()) as ShoppingAssistantResult & {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || payload.success === false) {
        setError(payload.error ?? "Shopping assistant failed.");
        return;
      }
      setResult(payload);
    } catch {
      setError("Shopping assistant failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
        Available now
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
        Shopping assistant
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
        Ask for a product in plain language. Brainy reuses the existing comparison
        engine and Google Shopping discovery. Results are for shopping help only —
        not SMS, checkout, orders, or Amazon account integration.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(request);
        }}
      >
        <label className="block text-sm font-medium text-white/80">
          Shopping request
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none ring-emerald-400/30 focus:ring-2"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => {
                setRequest(sample);
                void run(sample);
              }}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/80 hover:border-white/25"
            >
              {sample}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={loading || !request.trim()}
          className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? "Searching…" : "Find products"}
        </button>
      </form>

      {error ? (
        <p className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-10 space-y-8">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/45">
              User request
            </h2>
            <p className="mt-2 text-lg text-white">{result.userRequest}</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/45">
              Interpreted request
            </h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/45">Product query</dt>
                <dd className="text-white">{result.interpreted.productQuery}</dd>
              </div>
              <div>
                <dt className="text-white/45">Category</dt>
                <dd className="text-white">
                  {result.interpreted.category ?? "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-white/45">Department used</dt>
                <dd className="text-white">
                  {result.interpreted.department ?? "None — generic matching"}
                </dd>
              </div>
              <div>
                <dt className="text-white/45">Attributes</dt>
                <dd className="text-white">
                  {Object.keys(result.interpreted.attributes).length
                    ? Object.entries(result.interpreted.attributes)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(" · ")
                    : "None extracted"}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/45">
              Product options
            </h2>
            <p className="mt-1 text-xs text-white/40">
              Source data from Google Shopping via the existing engine. Pack
              count is shown only when parsed from the listing. Price per unit
              is derived only when both price and pack count exist. Ratings are
              shown only when the source provided them. Amazon is highlighted
              only when the source returned an Amazon listing.
            </p>
            <div className="mt-4 grid gap-4">
              {result.options.length === 0 ? (
                <p className="rounded-xl border border-white/10 px-4 py-6 text-sm text-white/60">
                  {result.engineMessage ?? "No product options were returned."}
                </p>
              ) : result.interpreted.category === "televisions" ? (
                <>
                  {result.options.some((row) => row.compatibility === "match") ? (
                    <div className="grid gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/55">
                        Confirmed {result.interpreted.attributes.screenSizeInches ?? ""}-inch matches
                      </h3>
                      {result.options
                        .filter((row) => row.compatibility === "match")
                        .map((option) => (
                          <ListingCard
                            key={`${option.storeId}-${option.productUrl}`}
                            option={option}
                          />
                        ))}
                    </div>
                  ) : null}
                  {result.options.some((row) => row.compatibility === "unknown") ? (
                    <div className="grid gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/55">
                        Other possible matches
                      </h3>
                      <p className="text-xs text-white/40">
                        Screen size not confirmed by source.
                      </p>
                      {result.options
                        .filter((row) => row.compatibility === "unknown")
                        .map((option) => (
                          <ListingCard
                            key={`${option.storeId}-${option.productUrl}`}
                            option={option}
                            unconfirmedSize
                          />
                        ))}
                    </div>
                  ) : null}
                </>
              ) : (
                result.options.map((option) => (
                  <ListingCard
                    key={`${option.storeId}-${option.productUrl}`}
                    option={option}
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-200/80">
              Recommendation
            </h2>
            <p className="mt-1 text-xs text-emerald-100/70">
              Shopping Assistant pick using compatibility, pack value, and
              source facts. Matcher identity scores are not the purchase
              rationale. Missing fields are not invented.
            </p>
            {result.recommendation ? (
              <>
                <p className="mt-2 text-lg font-semibold text-white">
                  {result.recommendation.title}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {result.recommendation.retailer}
                  {result.recommendation.amazonListing
                    ? " · Amazon listing from source data"
                    : ""}
                </p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-white/80">
                  {result.recommendation.factualReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {result.recommendation.productUrl ? (
                  <a
                    href={result.recommendation.productUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-block text-sm text-emerald-200 hover:underline"
                  >
                    Open listing
                  </a>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-white/70">
                No recommendation could be made from returned source data.
              </p>
            )}
          </section>

          <section className="text-xs leading-5 text-white/40">
            {result.limitations.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        </div>
      ) : null}
    </main>
  );
}
