"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CompareApiCandidate,
  CompareProductResponse,
  PremiumCouponOffer,
} from "@/lib/product/types";
import { manualFormHasSearchableCore } from "@/lib/product/manualProductInput";
import type { PriceAlertSurfaceNotification } from "@/lib/premium/priceAlerts";
import { storeDisplayLabel, storeLogoUrl } from "@/lib/premium/storeBranding";

const USER_STORAGE_KEY = "brainy_finance_uid";

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

/** Prefer Google Shopping source label; fallback to branded id (e.g. `walmart` → Walmart). */
function candidateRetailerName(c: { store: string; storeLabel?: string }): string {
  const label = c.storeLabel?.trim();
  if (label) return label;
  if (c.store === "other") return "Tienda externa";
  return storeDisplayLabel(c.store);
}

function MatchBadge({ type }: { type: CompareApiCandidate["matchType"] }) {
  const colors = {
    exact_match: "bg-green-500/20 text-green-300 border-green-500/40",
    close_match: "bg-emerald-500/18 text-emerald-200 border-emerald-500/35",
    alternative: "bg-sky-500/15 text-sky-200 border-sky-500/35",
  };
  const labels: Record<CompareApiCandidate["matchType"], string> = {
    exact_match: "Best Deal",
    close_match: "Similar Product",
    alternative: "Alternative Option",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-md border ${colors[type]}`}
    >
      {labels[type]}
    </span>
  );
}

function StoreLogo({
  store,
  displayName,
  className,
}: {
  store: string;
  /** When set, used for initials / aria when the logo is missing (e.g. SERP merchant name). */
  displayName?: string;
  className?: string;
}) {
  const src = store === "other" ? null : storeLogoUrl(store);
  const label = displayName ?? storeDisplayLabel(store);
  const initial =
    store === "other" ? "?" : label.slice(0, 1).toUpperCase();
  const [imgOk, setImgOk] = useState(Boolean(src));

  if (!src || !imgOk) {
    return (
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white ${className ?? ""}`}
        aria-hidden
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`h-11 w-11 shrink-0 rounded-lg bg-white object-contain p-1 ${className ?? ""}`}
      onError={() => setImgOk(false)}
    />
  );
}

function CouponsPanel({ coupons }: { coupons: PremiumCouponOffer[] }) {
  if (!coupons.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-200/90">
        Beneficio Brainy · cupones activos (preview)
      </p>
      <ul className="mt-2 space-y-2">
        {coupons.map((o) => (
          <li key={o.id} className="text-xs text-white/85">
            <span className="font-medium text-violet-100">{o.headline}</span>
            <span className="text-white/50"> — {o.detail}</span>
            {o.code ? (
              <span className="ml-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-violet-200">
                {o.code}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type InputMode = "link" | "manual";

export default function ComparePage() {
  const [inputMode, setInputMode] = useState<InputMode>("link");
  const [linkValue, setLinkValue] = useState("");
  const [manualBrand, setManualBrand] = useState("");
  const [manualProductName, setManualProductName] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualSize, setManualSize] = useState("");
  const [manualColor, setManualColor] = useState("");
  const [manualFeatures, setManualFeatures] = useState("");
  const [manualPricePaid, setManualPricePaid] = useState("");
  const [result, setResult] = useState<CompareProductResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [priceNotifications, setPriceNotifications] = useState<
    PriceAlertSurfaceNotification[]
  >([]);
  const [trackMessage, setTrackMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      let id = localStorage.getItem(USER_STORAGE_KEY);
      if (!id) {
        id = globalThis.crypto?.randomUUID?.() ?? `u_${Date.now()}`;
        localStorage.setItem(USER_STORAGE_KEY, id);
      }
      setUserId(id);
    } catch {
      setUserId(`u_${Date.now()}`);
    }
  }, []);

  const refreshPriceFeed = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(
        `/api/price-alerts?userId=${encodeURIComponent(userId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications?: PriceAlertSurfaceNotification[];
      };
      setPriceNotifications(data.notifications ?? []);
    } catch {
      /* ignore */
    }
  }, [userId]);

  useEffect(() => {
    void refreshPriceFeed();
  }, [refreshPriceFeed]);

  const runSweepAndRefresh = useCallback(async () => {
    if (!userId) return;
    try {
      await fetch("/api/cron/price-alerts", { method: "POST" });
      await refreshPriceFeed();
    } catch {
      /* ignore */
    }
  }, [userId, refreshPriceFeed]);

  const dismissNotifications = useCallback(async () => {
    if (!userId) return;
    await fetch(
      `/api/price-alerts?userId=${encodeURIComponent(userId)}&ackNotifications=1`,
      { cache: "no-store" }
    );
    setPriceNotifications([]);
  }, [userId]);

  const trackPrice = async (c: CompareApiCandidate) => {
    setTrackMessage(null);
    if (!userId) {
      setTrackMessage("No se pudo identificar tu sesión para guardar la alerta.");
      return;
    }
    const suggested =
      c.price != null && Number.isFinite(c.price)
        ? String(Math.round(c.price * 0.92 * 100) / 100)
        : "";
    const raw = window.prompt("Precio objetivo (USD)", suggested);
    if (raw == null) return;
    const targetPrice = Number.parseFloat(raw.trim());
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      setTrackMessage("Precio objetivo no válido.");
      return;
    }
    const outbound =
      c.outboundUrl?.trim() || c.affiliateUrl || c.productUrl;
    const res = await fetch("/api/price-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        productUrl: outbound,
        store: c.store,
        title: c.title,
        currentPrice: c.price,
        targetPrice,
      }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      setTrackMessage(payload.error ?? "No se pudo crear la alerta.");
      return;
    }
    setTrackMessage("Alerta de precio guardada. Te avisaremos cuando baje (simulación).");
    void refreshPriceFeed();
  };

  const handleCompare = async () => {
    setErrorMessage("");

    let body: Record<string, unknown>;

    if (inputMode === "link") {
      if (!linkValue.trim()) return;
      body = { input: linkValue.trim() };
    } else {
      const manualProduct = {
        brand: manualBrand.trim() || null,
        productNameOrModel: manualProductName.trim() || null,
        category: manualCategory.trim() || null,
        sizeDimensionsCapacity: manualSize.trim() || null,
        colorVariant: manualColor.trim() || null,
        keyFeatures: manualFeatures.trim() || null,
        pricePaid: manualPricePaid.trim() || null,
      };
      if (!manualFormHasSearchableCore(manualProduct)) {
        setErrorMessage(
          "Add at least a brand, product name/model, or category to search without a link."
        );
        return;
      }
      body = { manualProduct };
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/compare-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as CompareProductResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data?.error || "Failed to compare product");
      }

      setResult(data);
      void runSweepAndRefresh();
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
    <main className="flex-1 bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold mb-2">Compare Stores</h1>
        <p className="text-white/70 mb-8">
          Listados directos en comercios — sin pasar por Google Shopping. Pega un enlace o
          describe el producto.
        </p>

        {priceNotifications.length > 0 && (
          <div className="mb-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-cyan-100">
                Alerta de precio (demo): {priceNotifications[0]?.message}
              </p>
              <button
                type="button"
                onClick={() => void dismissNotifications()}
                className="rounded-lg border border-cyan-400/40 px-3 py-1 text-xs text-cyan-100 hover:bg-white/5"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

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
                <div className="mb-2 flex items-center gap-2">
                  <StoreLogo store={best.store} />
                  <p className="text-white/60 text-sm">
                    {storeDisplayLabel(best.store)}
                  </p>
                </div>
                <p className="text-lg font-bold mb-1 line-clamp-2">{best.title}</p>
                <p className="text-green-400 font-semibold mt-1">{formatPrice(best.price)}</p>
                {result!.savings != null && result!.savings > 0 && (
                  <p className="text-white/70 text-sm mt-2">
                    Hasta {formatPrice(result!.savings)} menos vs tu precio de referencia entre opciones
                    más baratas
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

          <div className="flex flex-wrap gap-3 mb-6">
            <button
              type="button"
              onClick={() => setInputMode("link")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition border ${
                inputMode === "link"
                  ? "bg-green-500/20 border-green-500/50 text-green-300"
                  : "bg-black/40 border-white/15 text-white/70 hover:border-white/25"
              }`}
            >
              I have a product link
            </button>
            <button
              type="button"
              onClick={() => setInputMode("manual")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition border ${
                inputMode === "manual"
                  ? "bg-green-500/20 border-green-500/50 text-green-300"
                  : "bg-black/40 border-white/15 text-white/70 hover:border-white/25"
              }`}
            >
              I don&apos;t have a link
            </button>
          </div>

          {inputMode === "link" ? (
            <div className="flex flex-col md:flex-row gap-3 mb-6">
              <input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="Paste a store URL or type a product name"
                className="flex-1 rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
              />
              <button
                type="button"
                onClick={handleCompare}
                className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition"
              >
                {loading ? "Searching..." : "Compare Now"}
              </button>
            </div>
          ) : (
            <div className="space-y-4 mb-6">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={manualBrand}
                  onChange={(e) => setManualBrand(e.target.value)}
                  placeholder="Brand (e.g. Samsung, Nike)"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
                <input
                  value={manualProductName}
                  onChange={(e) => setManualProductName(e.target.value)}
                  placeholder="Product name / model"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
                <input
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value)}
                  placeholder="Category / product type"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
                <input
                  value={manualSize}
                  onChange={(e) => setManualSize(e.target.value)}
                  placeholder="Size / dimensions / capacity"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
                <input
                  value={manualColor}
                  onChange={(e) => setManualColor(e.target.value)}
                  placeholder="Color / variant"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
                <input
                  value={manualPricePaid}
                  onChange={(e) => setManualPricePaid(e.target.value)}
                  placeholder="Price paid (optional)"
                  className="rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
                />
              </div>
              <textarea
                value={manualFeatures}
                onChange={(e) => setManualFeatures(e.target.value)}
                placeholder="Key features (short phrases — avoid pasting a full product description)"
                rows={3}
                className="w-full rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none resize-y min-h-[5rem]"
              />
              <button
                type="button"
                onClick={handleCompare}
                className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition"
              >
                {loading ? "Searching..." : "Compare Now"}
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-300">
              {errorMessage}
            </div>
          )}

          {trackMessage && (
            <div className="mb-4 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3 text-green-100 text-sm">
              {trackMessage}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              {result.scrapeBotWalled && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
                  We couldn&apos;t read this page automatically. Try pasting the product name instead.
                </div>
              )}

              {result.normalizedQuery && (
                <p className="text-white/50 text-sm">
                  Search:{" "}
                  <span className="text-white/80">{result.normalizedQuery}</span>
                </p>
              )}

              {result.aiProductSummary ? (
                <p className="text-cyan-100/90 text-sm rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2">
                  <span className="font-semibold text-cyan-200/95">Brainy (IA): </span>
                  {result.aiProductSummary}
                </p>
              ) : null}

              {showBest && best && (
                <p className="text-green-400/95 text-sm font-medium">
                  Best deal (among{" "}
                  {
                    result.candidates.filter((x) => x.matchType === "exact_match")
                      .length
                  }{" "}
                  exact matches): {formatPrice(best.price)} at {candidateRetailerName(best)}
                </p>
              )}

              {result.message && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
                  {result.message}
                </div>
              )}

              {result.candidates.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold text-white mb-1">
                    {result.comparisonMessage ?? "Coincidencias"}
                  </h3>
                  <p className="text-white/50 text-sm mb-2">
                    Lista completa para este resultado:{" "}
                    <span className="text-white/75 font-medium">
                      {result.candidates.length}{" "}
                      {result.candidates.length === 1 ? "candidato" : "candidatos"}
                    </span>
                    . Las filas con etiqueta{" "}
                    <span className="text-white/75">Enlace de búsqueda</span> llevan el
                    botón &quot;Ver resultados en [tienda]&quot;; no es una ficha única hasta
                    que confirmes el producto en la lista.
                  </p>
                  <h4 className="text-lg font-semibold mb-3 text-white/90">
                    Todas las coincidencias listadas ({result.candidates.length})
                  </h4>
                  <ul className="space-y-3">
                    {(() => {
                      const firstNotCheap = result.candidates.findIndex(
                        (c) => c.priceCompareSegment === "not_cheaper"
                      );
                      return result.candidates.map((c, idx) => {
                        const isWinner =
                          showBest &&
                          best &&
                          c.productUrl === best.productUrl &&
                          c.store === best.store;
                        const outbound =
                          (c.outboundUrl?.trim() || c.affiliateUrl || c.productUrl);
                        const storeLabel = candidateRetailerName(c);
                        const showSearchDisclaimer = c.urlType === "search";
                        const outboundButtonLabel =
                          c.urlType === "product"
                            ? `Ver producto en ${storeLabel}`
                            : c.urlType === "search"
                              ? `Ver resultados en ${storeLabel}`
                              : `Ver en ${storeLabel}`;
                        const showSimilarBanner =
                          firstNotCheap >= 0 &&
                          idx === firstNotCheap &&
                          firstNotCheap > 0;
                        const savingsVs = c.savingsVsReference;
                        return (
                          <li key={`${c.store}-${c.productUrl}-${idx}`}>
                            {showSimilarBanner && (
                              <p className="text-sm text-amber-200/95 mb-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                                No es más barato, pero es similar
                              </p>
                            )}
                            <div
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
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <StoreLogo store={c.store} displayName={storeLabel} />
                                  <div className="flex flex-wrap items-center gap-2">
                                    {isWinner && best?.matchType === "exact_match" && (
                                      <span className="text-xs font-semibold text-green-400 uppercase">
                                        Best Deal
                                      </span>
                                    )}
                                    <span className="text-white/80 text-sm font-medium">
                                      {storeLabel}
                                    </span>
                                    {c.urlType === "search" ? (
                                      <span
                                        className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-amber-500/45 bg-amber-500/12 px-2 py-0.5 text-amber-200/95"
                                        title="Abre una búsqueda en la tienda, no una ficha fija."
                                      >
                                        Enlace de búsqueda
                                      </span>
                                    ) : c.urlType === "product" ? (
                                      <span
                                        className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/95"
                                        title="Enlace directo al listado en la tienda."
                                      >
                                        Ficha en tienda
                                      </span>
                                    ) : (
                                      <span
                                        className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-white/20 bg-white/5 px-2 py-0.5 text-white/55"
                                        title="Tipo de URL no clasificado."
                                      >
                                        Enlace externo
                                      </span>
                                    )}
                                    <MatchBadge type={c.matchType} />
                                    <span className="text-white/40 text-sm">
                                      {c.identityScore}/100
                                    </span>
                                    {savingsVs != null && savingsVs > 0 ? (
                                      <span className="text-xs font-semibold text-green-400 rounded-md border border-green-500/40 bg-green-500/15 px-2 py-0.5">
                                        Ahorra {formatPrice(savingsVs)}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <p className="font-medium text-white line-clamp-2">
                                  {c.title}
                                </p>
                                <p className="text-green-400 font-semibold mt-1">
                                  {formatPrice(c.price)}
                                </p>
                                {showSearchDisclaimer ? (
                                  <p className="text-white/45 text-xs mt-2 space-y-1">
                                    <span className="block">
                                      Enlace de búsqueda, verifica el producto antes de comprar.
                                    </span>
                                  </p>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <a
                                    href={outbound}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black hover:bg-green-400 transition"
                                  >
                                    {outboundButtonLabel}
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void trackPrice(c)}
                                    className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
                                  >
                                    Rastrear precio
                                  </button>
                                </div>
                                <CouponsPanel coupons={c.premiumCoupons ?? []} />
                              </div>
                            </div>
                          </li>
                        );
                      });
                    })()}
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
