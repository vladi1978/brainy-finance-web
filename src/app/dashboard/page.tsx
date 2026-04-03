"use client";

import { useState } from "react";

type DashboardResult = {
  title: string;
  originalPrice: number | null;
  bestPrice: number | null;
  store: string;
  savings: number | null;
  link?: string;
};

export default function DashboardPage() {
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<DashboardResult | null>(null);
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to compare product");
      }

      console.log("API RESULT:", data);

      if (data.bestDeal) {
        const originalPrice = data.sourceProduct?.originalPrice ?? null;
        const bestPrice = data.bestDeal.price ?? null;

        setResult({
          title: data.bestDeal.title,
          originalPrice,
          bestPrice,
          store: data.bestDeal.store,
          savings:
            originalPrice != null && bestPrice != null
              ? originalPrice - bestPrice
              : null,
          link: data.bestDeal.affiliateUrl || data.bestDeal.productUrl,
        });
      } else {
        setErrorMessage("No comparison result found.");
      }
    } catch (error) {
      console.error("Compare error:", error);
      setErrorMessage("Something went wrong while comparing this product.");
    } finally {
      setLoading(false);
    }
  };

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
            {result ? (
              <div>
                <p className="text-3xl font-bold mb-1">{result.title}</p>
                <p className="text-white/80">
                  Original Price:{" "}
                  <span className="font-semibold">
                    {result.originalPrice != null
                      ? `$${result.originalPrice}`
                      : "Not detected"}
                  </span>
                </p>
                <p className="text-green-400 font-semibold mt-1">
                  Best Deal:{" "}
                  {result.bestPrice != null ? `$${result.bestPrice}` : "N/A"} (
                  {result.store})
                </p>
                <p className="text-white/70 mt-2">
                  Savings:{" "}
                  <span className="font-semibold">
                    {result.savings != null ? `$${result.savings}` : "Not available"}
                  </span>
                </p>
              </div>
            ) : (
              <div>
                <p className="text-white/80">
                  Run a comparison to see the best deal across stores.
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
              placeholder="Paste Amazon, Walmart, Target, Temu URL OR type a product name / description"
              className="flex-1 rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
            />

            <button
              onClick={handleCompare}
              className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition"
            >
              {loading ? "Comparing..." : "Compare Now"}
            </button>
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
              {errorMessage}
            </div>
          )}

          {result && (
            <div className="rounded-2xl border border-white/10 p-6 bg-black/30">
              <h3 className="text-3xl font-bold mb-3">{result.title}</h3>

              <p className="text-white/80 text-lg">
                Original Price:{" "}
                <span className="font-semibold">
                  {result.originalPrice != null
                    ? `$${result.originalPrice}`
                    : "Not detected yet"}
                </span>
              </p>

              <p className="text-green-400 text-xl font-bold mt-2">
                Best Deal:{" "}
                {result.bestPrice != null ? `$${result.bestPrice}` : "N/A"} (
                {result.store})
              </p>

              <p className="text-white/80 mt-2">
                Savings:{" "}
                <span className="font-semibold">
                  {result.savings != null ? `$${result.savings}` : "Not available"}
                </span>
              </p>

              {result.link && (
                <a
                  href={result.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-5 rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-400 transition"
                >
                  Buy & Save
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}