"use client";

import { useState } from "react";
import type { CompareApiCandidate, CompareProductResponse } from "@/lib/product/types";

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function MatchBadge({ type }: { type: CompareApiCandidate["matchType"] }) {
  const colors = {
    high: "bg-green-500/20 text-green-300 border-green-500/40",
    medium: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    low: "bg-white/10 text-white/60 border-white/20",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-md border ${colors[type]}`}
    >
      {type}
    </span>
  );
}

export default function DashboardPage() {
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<CompareProductResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleCompare = async () => {
    if (!inputValue.trim()) return;

    setLoading(true);
    setErrorMessage("");
    setResult(null);

    try {
      const response = await fetch("/api/compare-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: inputValue }),
      });

      const data = (await response.json()) as CompareProductResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data?.error || "Failed to compare product");
      }

      setResult(data);
    } catch (error) {
      console.error("Compare error:", error);
      setErrorMessage("Something went wrong while comparing this product.");
    } finally {
      setLoading(false);
    }
  };

  const best = result?.bestDeal;
  const showBest = Boolean(result?.showBestDeal && best);

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold mb-2">BrainyFinance Dashboard</h1>
        <p className="text-white/70 mb-8">
          Upload statements, detect subscriptions, and compare product prices.
        </p>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h2 className="text-xl font-semibold mb-3">Subscriptions Found</h2>
            <p className="text-5xl font-bold text-green-400">4</p>
            <p className="text-white/70 mt-2">Potential monthly savings: $63</p>
          </div>

          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h2 className="text-xl font-semibold mb-3">Best Product Deal</h2>
            {showBest && best ? (
              <div>
                <p className="text-lg font-bold mb-1 line-clamp-2">{best.title}</p>
                <p className="text-green-400 font-semibold mt-1">
                  {formatPrice(best.price)} · {best.store}
                </p>
                {result!.savings != null && result!.savings > 0 && (
                  <p className="text-white/70 text-sm mt-2">
                    Up to {formatPrice(result!.savings)} spread among strong matches
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-white/80 text-sm">
                  {result && !showBest
                    ? "Showing closest store matches — open a listing to verify."
                    : "Run a search to see store listings side by side."}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
            <h2 className="text-xl font-semibold mb-3">Affiliate Opportunity</h2>
            <p className="text-5xl font-bold text-green-400">$12.40</p>
            <p className="text-white/70 mt-2">
              Estimated affiliate earnings this month
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
          <h2 className="text-2xl font-bold mb-4">Compare a Product</h2>

          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Paste a store URL or type a product name"
              className="flex-1 rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
            />

            <button
              onClick={handleCompare}
              className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition"
            >
              {loading ? "Searching..." : "Compare Now"}
            </button>
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
              {errorMessage}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              {result.normalizedQuery && (
                <p className="text-white/50 text-sm">
                  Search:{" "}
                  <span className="text-white/80">{result.normalizedQuery}</span>
                </p>
              )}

              {showBest && best && (
                <p className="text-green-400/95 text-sm font-medium">
                  Best deal (among {result.candidates.filter((x) => x.matchType === "high").length}{" "}
                  strong matches): {formatPrice(best.price)} at {best.store}
                </p>
              )}

              {!showBest && result.candidates.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold text-white mb-1">
                    {result.comparisonMessage ?? "Closest matches found"}
                  </h3>
                  <p className="text-white/50 text-sm mb-4">
                    We need at least two strong matches to highlight a single best deal.
                  </p>
                </div>
              )}

              {result.message && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
                  {result.message}
                </div>
              )}

              {result.candidates.length > 0 && (
                <div>
                  <h4 className="text-lg font-semibold mb-3 text-white/90">
                    Store results
                  </h4>
                  <ul className="space-y-3">
                    {result.candidates.map((c) => {
                      const isWinner =
                        showBest &&
                        best &&
                        c.productUrl === best.productUrl &&
                        c.store === best.store;
                      return (
                      <li
                        key={`${c.store}-${c.productUrl}`}
                        className={`flex gap-4 rounded-xl border p-4 ${
                          isWinner
                            ? "border-green-500/50 bg-green-500/10"
                            : "border-white/10 bg-black/30"
                        }`}
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt=""
                            className="h-20 w-20 rounded-lg object-contain bg-white/5 shrink-0"
                          />
                        ) : (
                          <div className="h-20 w-20 rounded-lg bg-white/5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {isWinner && (
                              <span className="text-xs font-semibold text-green-400 uppercase">
                                Best price
                              </span>
                            )}
                            <span className="text-white/50 text-sm uppercase">
                              {c.store}
                            </span>
                            <MatchBadge type={c.matchType} />
                            <span className="text-white/40 text-sm">
                              {Math.round(c.confidence * 100)}%
                            </span>
                          </div>
                          <p className="font-medium text-white line-clamp-2">
                            {c.title}
                          </p>
                          <p className="text-green-400 font-semibold mt-1">
                            {formatPrice(c.price)}
                          </p>
                          <a
                            href={c.affiliateUrl || c.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-green-400/90 hover:text-green-300 mt-2 inline-block"
                          >
                            Open link
                          </a>
                        </div>
                      </li>
                    );
                    })}
                  </ul>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </main>
  );
}
