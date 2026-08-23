"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CompareApiCandidate,
  CompareMatchResultGroups,
  CompareProductDeal,
  CompareProductResponse,
  MatchConfidenceBand,
  PremiumCouponOffer,
} from "@/lib/product/types";
import {
  isValidReferencePriceInput,
  manualFormHasSearchableCore,
  REFERENCE_PRICE_REQUIRED_MESSAGE,
} from "@/lib/product/manualProductInput";
import type { PriceAlertSurfaceNotification } from "@/lib/premium/priceAlerts";
import { storeDisplayLabel, storeLogoUrl } from "@/lib/premium/storeBranding";
import {
  buildBrainyRedirectUrl,
  isOutboundRedirectTargetValid,
} from "@/lib/product/outboundRedirect";
import {
  COMPARE_FLOW_DEPARTMENTS,
  type CompareFlowDepartment,
} from "@/lib/product/compareFlowDepartment";
import {
  NO_EXACT_WITH_ALTERNATIVES_MESSAGE,
  POSSIBLE_ALTERNATIVES_EXPLANATION,
} from "@/lib/product/matching/confidenceBands";
import { isClientDevBackgroundTasksDisabled } from "@/lib/dev/runtimeControls";

const USER_STORAGE_KEY = "brainy_finance_uid";
/** SSR / hydration snapshot — never touch localStorage on the server. */
const USER_ID_SERVER_SNAPSHOT = "";

let cachedCompareUserId: string | null = null;

function subscribeCompareUserId(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === USER_STORAGE_KEY || event.key === null) {
      cachedCompareUserId = null;
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function getCompareUserIdSnapshot(): string {
  if (cachedCompareUserId != null) return cachedCompareUserId;
  try {
    let id = localStorage.getItem(USER_STORAGE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ?? `u_${Date.now()}`;
      localStorage.setItem(USER_STORAGE_KEY, id);
    }
    cachedCompareUserId = id;
    return id;
  } catch {
    cachedCompareUserId = `u_${Date.now()}`;
    return cachedCompareUserId;
  }
}

function getCompareUserIdServerSnapshot(): string {
  return USER_ID_SERVER_SNAPSHOT;
}

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatReferencePrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Reference price unavailable";
  return `$${n.toFixed(2)}`;
}

function sourceListingRedirectHref(sp: {
  sourceUrl?: string | null;
  store: string;
  title: string;
}): string | null {
  const srcUrl = (sp.sourceUrl ?? "").replace(/\s+/g, " ").trim();
  if (!srcUrl || !isOutboundRedirectTargetValid(srcUrl)) return null;
  return buildBrainyRedirectUrl({
    targetUrl: srcUrl,
    store: sp.store,
    title: sp.title,
    source: "compare_source_listing",
  });
}

/** Prefer Google Shopping source label; fallback to branded id (e.g. `walmart` → Walmart). */
function candidateRetailerName(c: { store: string; storeLabel?: string }): string {
  const label = c.storeLabel?.trim();
  if (label) return label;
  if (c.store === "other") return "External store";
  return storeDisplayLabel(c.store);
}

function ConfidenceBandBadge({
  band,
  label,
}: {
  band?: MatchConfidenceBand;
  label?: string;
}) {
  const resolved = label ?? "Match";
  const styles: Record<MatchConfidenceBand, string> = {
    exact_match: "bg-green-500/20 text-green-300 border-green-500/40",
    high_confidence: "bg-emerald-500/18 text-emerald-200 border-emerald-500/35",
    similar_specs: "bg-cyan-500/15 text-cyan-200 border-cyan-500/35",
    possible_alternative: "bg-sky-500/15 text-sky-200 border-sky-500/35",
    below_threshold: "bg-white/10 text-white/50 border-white/20",
  };
  const bandKey = band ?? "below_threshold";
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-md border ${styles[bandKey]}`}
    >
      {resolved}
    </span>
  );
}

function MatchBadge({ type }: { type: CompareApiCandidate["matchType"] }) {
  const map: Record<
    CompareApiCandidate["matchType"],
    { band: MatchConfidenceBand; label: string }
  > = {
    exact_match: { band: "exact_match", label: "Exact Match" },
    close_match: { band: "high_confidence", label: "High Confidence" },
    alternative: { band: "possible_alternative", label: "Possible Alternative" },
  };
  const entry = map[type];
  return <ConfidenceBandBadge band={entry.band} label={entry.label} />;
}

function resolveMatchGroups(
  result: CompareProductResponse
): CompareMatchResultGroups {
  if (result.matchGroups) return result.matchGroups;
  return {
    exactMatches: result.candidates.filter((c) => c.confidenceBand === "exact_match"),
    highConfidenceMatches: result.candidates.filter(
      (c) => c.confidenceBand === "high_confidence"
    ),
    possibleAlternatives: result.candidates.filter(
      (c) =>
        c.confidenceBand === "possible_alternative" ||
        c.confidenceBand === "similar_specs"
    ),
  };
}

function countMatchGroupItems(groups: CompareMatchResultGroups): number {
  return (
    (groups.exactMatches?.length ?? 0) +
    (groups.highConfidenceMatches?.length ?? 0) +
    (groups.possibleAlternatives?.length ?? 0)
  );
}

const MATCH_GROUP_SECTIONS: {
  key: keyof CompareMatchResultGroups;
  title: string;
  description: string;
}[] = [
  {
    key: "exactMatches",
    title: "Exact Matches",
    description: "Score 90+ — strongest alignment with your product.",
  },
  {
    key: "highConfidenceMatches",
    title: "High Confidence Matches",
    description: "Score 75–89 — key specs align for price comparison.",
  },
  {
    key: "possibleAlternatives",
    title: "Possible Alternatives",
    description:
      "Score 55–74 — related listings; verify size, model, and accessories before buying.",
  },
];

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
    <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
        Simulated coupon preview · not a real offer
      </p>
      <p className="mt-1 text-[11px] text-white/45">
        Codes and discounts shown here are demo-only and will not apply at checkout.
      </p>
      <ul className="mt-2 space-y-2">
        {coupons.map((o) => (
          <li key={o.id} className="text-xs text-white/85">
            <span className="font-medium text-amber-100/90">{o.headline}</span>
            <span className="text-white/50"> — {o.detail}</span>
            {o.code ? (
              <span className="ml-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-amber-100/80">
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

function renderCandidateCard(
  c: CompareApiCandidate,
  opts: {
    isWinner: boolean;
    best: CompareProductDeal | null | undefined;
    onTrack: (c: CompareApiCandidate) => void;
  }
) {
  const { isWinner, best, onTrack } = opts;
  const outbound =
    c.outboundUrl?.trim() ||
    c.affiliateUrl?.trim() ||
    c.productUrl?.trim() ||
    "";
  const storeLabel = candidateRetailerName(c);
  const redirectHref =
    outbound &&
    isOutboundRedirectTargetValid(outbound) &&
    (c.urlType === "product" || c.urlType === "search")
      ? buildBrainyRedirectUrl({
          targetUrl: outbound,
          store: c.store,
          title: c.title,
          source: "compare_candidate",
          urlType: c.urlType,
        })
      : null;
  const outboundButtonLabel =
    c.urlType === "product"
      ? `Open product at ${storeLabel}`
      : c.urlType === "search"
        ? `Open search at ${storeLabel}`
        : "Retailer link unavailable";
  const savingsVs = c.savingsVsReference;

  return (
    <li key={`${c.store}-${c.productUrl}-${c.title.slice(0, 24)}`}>
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
              <span className="text-white/80 text-sm font-medium">{storeLabel}</span>
              {c.urlType === "search" ? (
                <span
                  className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-amber-500/45 bg-amber-500/12 px-2 py-0.5 text-amber-200/95"
                  title="Retailer search — confirm the listing matches this product before buying."
                >
                  Search result — verify product before buying
                </span>
              ) : c.urlType === "product" ? (
                <span
                  className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/95"
                  title="Direct link to the retailer product page."
                >
                  Product listing
                </span>
              ) : null}
              <ConfidenceBandBadge
                band={c.confidenceBand}
                label={c.confidenceBandLabel}
              />
              <span className="text-white/40 text-sm">
                {typeof c.displayMatchScore === "number"
                  ? c.displayMatchScore
                  : c.identityScore}
                /100
              </span>
              {(() => {
                if (c.commercialListingLabel) return null;
                const kind = c.priceDifferenceKind;
                const label = c.priceDifferenceLabel;
                if (kind === "verified_save" && savingsVs != null && savingsVs > 0) {
                  return (
                    <span className="text-xs font-semibold text-green-400 rounded-md border border-green-500/40 bg-green-500/15 px-2 py-0.5">
                      {label ?? `Save ${formatPrice(savingsVs)}`}
                    </span>
                  );
                }
                if (
                  (kind === "alternative_lower" || kind === "search_listed_lower") &&
                  savingsVs != null &&
                  savingsVs > 0
                ) {
                  return (
                    <span
                      className="text-xs font-medium text-amber-100/95 rounded-md border border-amber-500/40 bg-amber-500/12 px-2 py-0.5"
                      title="Price is lower than your reference, but this is not a verified exact match."
                    >
                      {label ??
                        (kind === "search_listed_lower"
                          ? `Listed ${formatPrice(savingsVs)} lower — verify product`
                          : `${formatPrice(savingsVs)} lower — different or unconfirmed model`)}
                    </span>
                  );
                }
                if (savingsVs != null && savingsVs > 0 && c.confidenceBand === "exact_match") {
                  return (
                    <span className="text-xs font-semibold text-green-400 rounded-md border border-green-500/40 bg-green-500/15 px-2 py-0.5">
                      Save {formatPrice(savingsVs)}
                    </span>
                  );
                }
                if (savingsVs != null && savingsVs > 0) {
                  return (
                    <span className="text-xs font-medium text-amber-100/95 rounded-md border border-amber-500/40 bg-amber-500/12 px-2 py-0.5">
                      {formatPrice(savingsVs)} lower — different or unconfirmed model
                    </span>
                  );
                }
                return null;
              })()}
              {c.commercialListingLabel ? (
                <span
                  className="text-[11px] font-medium uppercase tracking-wide rounded-md border border-amber-500/45 bg-amber-500/12 px-2 py-0.5 text-amber-200/95"
                  title="This price may be a payment plan or rental — not a full purchase price."
                >
                  {c.commercialListingLabel}
                </span>
              ) : null}
            </div>
          </div>
          <p className="font-medium text-white line-clamp-2">{c.title}</p>
          {c.matchReasons && c.matchReasons.length > 0 ? (
            <ul className="text-white/55 text-sm mt-1 space-y-0.5 list-disc list-inside">
              {c.matchReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (c.matchExplanation ?? c.relevanceReason) ? (
            <p className="text-white/55 text-sm mt-1 line-clamp-2">
              {c.matchExplanation ?? c.relevanceReason}
            </p>
          ) : null}
          <p className="text-green-400 font-semibold mt-1">{formatPrice(c.price)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {redirectHref ? (
              <a
                href={redirectHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black hover:bg-green-400 transition"
              >
                {outboundButtonLabel}
              </a>
            ) : (
              <span
                className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/45 cursor-not-allowed"
                title="No clean retailer product or search URL is available for this listing."
              >
                Retailer link unavailable
              </span>
            )}
            <button
              type="button"
              onClick={() => void onTrack(c)}
              className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
              title="Demo only — no email or push notifications are sent."
            >
              Track price (demo)
            </button>
          </div>
          <CouponsPanel coupons={c.premiumCoupons ?? []} />
        </div>
      </div>
    </li>
  );
}



function CompareDepartmentDebugLine({
  selectedDepartment,
}: {
  selectedDepartment: CompareFlowDepartment | null;
}) {
  if (process.env.NODE_ENV !== "development") return null;

  const activeLabel =
    COMPARE_FLOW_DEPARTMENTS.find((dept) => dept.id === selectedDepartment)
      ?.label ?? "None";

  return (
    <p className="mt-2 text-xs font-mono text-white/40">
      Selected department:{" "}
      <span className={selectedDepartment ? "text-green-300" : undefined}>
        {activeLabel}
      </span>
    </p>
  );
}

function DepartmentIcon({ id }: { id: CompareFlowDepartment }) {
  const common = "h-6 w-6";
  if (id === "electronics") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="3"
          y="5"
          width="18"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M8 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "pools_outdoor") {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 14c3-4 13-4 16 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M6 18h12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 6.5l3 3L9 18H6v-3l8.5-8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13 8l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ComparePage() {
  const [selectedDepartment, setSelectedDepartment] =
    useState<CompareFlowDepartment | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("link");
  const [linkValue, setLinkValue] = useState("");
  const [linkPricePaid, setLinkPricePaid] = useState("");
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
  const userId = useSyncExternalStore(
    subscribeCompareUserId,
    getCompareUserIdSnapshot,
    getCompareUserIdServerSnapshot
  );
  const [priceNotifications, setPriceNotifications] = useState<
    PriceAlertSurfaceNotification[]
  >([]);
  const [trackMessage, setTrackMessage] = useState<string | null>(null);
  const [priceError, setPriceError] = useState("");

  const currentPricePaid =
    inputMode === "link" ? linkPricePaid : manualPricePaid;

  const pricePaidValid = isValidReferencePriceInput(currentPricePaid);

  const linkInputReady = inputMode !== "link" || linkValue.trim().length > 0;
  const manualInputReady =
    inputMode !== "manual" ||
    manualFormHasSearchableCore({
      brand: manualBrand.trim() || null,
      productNameOrModel: manualProductName.trim() || null,
      category: manualCategory.trim() || null,
      sizeDimensionsCapacity: manualSize.trim() || null,
      colorVariant: manualColor.trim() || null,
      keyFeatures: manualFeatures.trim() || null,
      pricePaid: manualPricePaid.trim() || null,
    });

  const canCompare =
    selectedDepartment !== null &&
    linkInputReady &&
    manualInputReady &&
    pricePaidValid &&
    !loading;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log(
      "[DEPARTMENT_STATE]",
      JSON.stringify({
        selectedDepartment,
        label:
          COMPARE_FLOW_DEPARTMENTS.find((dept) => dept.id === selectedDepartment)
            ?.label ?? null,
      })
    );
  }, [selectedDepartment]);

  const refreshPriceFeed = useCallback(async () => {
    if (isClientDevBackgroundTasksDisabled()) return;
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

  // Demo price-alert feed: setState only after await (async continuation).
  useEffect(() => {
    if (!userId) return;
    if (isClientDevBackgroundTasksDisabled()) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/price-alerts?userId=${encodeURIComponent(userId)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          notifications?: PriceAlertSurfaceNotification[];
        };
        if (!cancelled) {
          setPriceNotifications(data.notifications ?? []);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const runSweepAndRefresh = useCallback(async () => {
    if (isClientDevBackgroundTasksDisabled()) return;
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
      setTrackMessage("Could not identify your session to save the alert.");
      return;
    }
    const suggested =
      c.price != null && Number.isFinite(c.price)
        ? String(Math.round(c.price * 0.92 * 100) / 100)
        : "";
    const raw = window.prompt("Target price (USD)", suggested);
    if (raw == null) return;
    const targetPrice = Number.parseFloat(raw.trim());
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      setTrackMessage("Invalid target price.");
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
      setTrackMessage(payload.error ?? "Could not create the alert.");
      return;
    }
    setTrackMessage(
      "Demo only: alert recorded in this session. No email, SMS, or push notifications are sent."
    );
    void refreshPriceFeed();
  };

  const validatePricePaid = (): boolean => {
    if (!isValidReferencePriceInput(currentPricePaid)) {
      setPriceError(REFERENCE_PRICE_REQUIRED_MESSAGE);
      return false;
    }
    setPriceError("");
    return true;
  };

  const handleCompare = async () => {
    setErrorMessage("");
    if (!selectedDepartment) {
      setErrorMessage("Choose a department before comparing.");
      return;
    }
    if (!validatePricePaid()) return;

    const pricePaid = currentPricePaid.trim();
    let body: Record<string, unknown>;

    if (inputMode === "link") {
      if (!linkValue.trim()) return;
      body = {
        input: linkValue.trim(),
        pricePaid,
        department: selectedDepartment,
      };
    } else {
      const manualProduct = {
        brand: manualBrand.trim() || null,
        productNameOrModel: manualProductName.trim() || null,
        category: manualCategory.trim() || null,
        sizeDimensionsCapacity: manualSize.trim() || null,
        colorVariant: manualColor.trim() || null,
        keyFeatures: manualFeatures.trim() || null,
        pricePaid,
      };
      if (!manualFormHasSearchableCore(manualProduct)) {
        setErrorMessage(
          "Add at least a brand, product name/model, or category to search without a link."
        );
        return;
      }
      body = { manualProduct, pricePaid, department: selectedDepartment };
    }

    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DEPARTMENT_REQUEST]",
        JSON.stringify({
          selectedDepartment,
          label:
            COMPARE_FLOW_DEPARTMENTS.find((dept) => dept.id === selectedDepartment)
              ?.label ?? null,
          departmentPayload: body.department ?? null,
          inputMode,
        })
      );
      console.log("[compare] request body", {
        body,
        selectedDepartment,
        productUrl: inputMode === "link" ? linkValue.trim() : null,
        price: pricePaid,
      });
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

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        setErrorMessage(
          "Brainy could not compare this product right now."
        );
        return;
      }

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setErrorMessage(
          "Brainy could not compare this product right now."
        );
        return;
      }

      const data = parsed as CompareProductResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const apiErr = (data.error ?? "").trim();
        const apiMsg = (data.message ?? "").trim();

        if (response.status === 400 && apiErr) {
          setPriceError(apiErr);
          return;
        }

        setErrorMessage(
          apiMsg ||
            (apiErr === "compare_failed"
              ? "Brainy could not compare this product right now."
              : apiErr) ||
            "Brainy could not compare this product right now."
        );
        return;
      }

      setResult(data);
      for (const c of [
        ...data.candidates,
        ...(data.similarButNotCheaper ?? []),
      ]) {
        console.log("[compare-ui] candidate outbound", {
          store: c.store,
          title: c.title,
          urlType: c.urlType,
          urlConfidence: c.urlConfidence,
          urlResolutionReason: c.urlResolutionReason ?? null,
          outboundUrl: c.outboundUrl,
        });
      }
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
  const matchGroups = result ? resolveMatchGroups(result) : null;
  const visibleMatchCount = matchGroups ? countMatchGroupItems(matchGroups) : 0;
  const hasExactOrHigh =
    (matchGroups?.exactMatches?.length ?? 0) > 0 ||
    (matchGroups?.highConfidenceMatches?.length ?? 0) > 0;
  const onlyPossibleAlternatives =
    visibleMatchCount > 0 && !hasExactOrHigh;

  return (
    <main className="flex-1 bg-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold mb-2">Compare Stores</h1>
        <p className="text-white/70 mb-8">
          Compare the same product across stores. Paste a product link or describe what you
          are shopping for, and enter the price you found so we only surface cheaper matches.
          Price tracking and coupon panels below are simulated previews — not live alerts or
          redeemable offers.
        </p>

        {result?.demoMode ? (
          <div
            className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            role="status"
          >
            <p className="font-semibold">Demo mode — synthetic listings</p>
            <p className="mt-1 text-amber-100/80">
              Results are not live prices, inventory, or retailer offers. Disable{" "}
              <code className="text-xs">PRODUCT_COMPARE_DEMO_MODE</code> for real shopping
              search.
            </p>
          </div>
        ) : null}

        {priceNotifications.length > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-amber-100">
                Simulated price alert (no notifications sent):{" "}
                {priceNotifications[0]?.message}
              </p>
              <button
                type="button"
                onClick={() => void dismissNotifications()}
                className="rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-100 hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6 mb-8">
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
                    Save up to {formatPrice(result!.savings)} vs your reference price among
                    verified exact matches
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
            <h2 className="text-xl font-semibold mb-3">Subscriptions</h2>
            <p className="text-white/80 text-sm">
              Recurring charges come from text-based PDF statement analysis — not
              from this compare screen.
            </p>
            <Link
              href="/statements"
              className="mt-3 inline-flex text-sm font-medium text-emerald-300/90 hover:text-emerald-200"
            >
              Open Statements
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 p-6 bg-white/5">
          <h2 className="text-2xl font-bold mb-2">Compare a Product</h2>
          <p className="text-white/60 text-sm mb-6">
            Start by choosing what you&apos;re shopping for — then paste a link or describe
            the item.
          </p>

          <div className="mb-8">
            <p className="text-sm font-semibold text-white/90 mb-1">
              Step 1 · Choose a department
            </p>
            <p className="text-xs text-white/50 mb-4">
              Brainy uses department-specific rules to find safer matches across stores.
            </p>
            <div
              className="grid gap-4 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Product department"
            >
              {COMPARE_FLOW_DEPARTMENTS.map((dept) => {
                const isSelected = selectedDepartment === dept.id;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      if (selectedDepartment !== dept.id) {
                        setResult(null);
                        setErrorMessage("");
                        setTrackMessage(null);
                      }
                      setSelectedDepartment(dept.id);
                      if (process.env.NODE_ENV === "development") {
                        console.log(
                          "[DEPARTMENT_SELECTED]",
                          JSON.stringify({
                            selectedDepartment: dept.id,
                            label: dept.label,
                            previousDepartment: selectedDepartment,
                          })
                        );
                      }
                    }}
                    className={`group flex h-full flex-col rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? "border-green-500/50 bg-green-500/10 ring-1 ring-green-500/30"
                        : "border-white/10 bg-black/30 hover:border-white/25 hover:bg-white/[0.03]"
                    }`}
                  >
                    <div
                      className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl border ${
                        isSelected
                          ? "border-green-500/40 bg-green-500/15 text-green-300"
                          : "border-white/10 bg-white/5 text-white/70 group-hover:text-white"
                      }`}
                    >
                      <DepartmentIcon id={dept.id} />
                    </div>
                    <span className="text-base font-semibold text-white">{dept.label}</span>
                    <span className="mt-1 text-xs font-medium text-green-300/90">
                      {dept.headline}
                    </span>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">
                      {dept.description}
                    </p>
                    <ul className="mt-3 space-y-1 border-t border-white/10 pt-3">
                      {dept.examples.map((example) => (
                        <li
                          key={example}
                          className="text-[11px] text-white/45 before:mr-1.5 before:content-['·']"
                        >
                          {example}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={
              selectedDepartment
                ? ""
                : "pointer-events-none opacity-40 select-none"
            }
          >
            <p className="text-sm font-semibold text-white/90 mb-4">
              Step 2 · Add your product
            </p>

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
            <div className="space-y-3 mb-6">
              <input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="Paste a store URL or type a product name"
                className="w-full rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none"
              />
              <div>
                <input
                  value={linkPricePaid}
                  onChange={(e) => {
                    setLinkPricePaid(e.target.value);
                    if (priceError) setPriceError("");
                  }}
                  onBlur={validatePricePaid}
                  placeholder="Price you found / paid"
                  aria-required
                  className={`w-full max-w-md rounded-xl bg-black border px-4 py-3 text-white outline-none ${
                    priceError ? "border-red-500/50" : "border-white/15"
                  }`}
                />
                {priceError ? (
                  <p className="mt-2 text-sm text-red-300">{priceError}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleCompare}
                disabled={!canCompare}
                className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-500"
              >
                {loading ? "Searching..." : "Compare Now"}
              </button>
              <CompareDepartmentDebugLine
                selectedDepartment={selectedDepartment}
              />
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
                  onChange={(e) => {
                    setManualPricePaid(e.target.value);
                    if (priceError) setPriceError("");
                  }}
                  onBlur={validatePricePaid}
                  placeholder="Price you found / paid"
                  aria-required
                  className={`rounded-xl bg-black border px-4 py-3 text-white outline-none ${
                    priceError ? "border-red-500/50" : "border-white/15"
                  }`}
                />
              </div>
              <textarea
                value={manualFeatures}
                onChange={(e) => setManualFeatures(e.target.value)}
                placeholder="Key features (short phrases — avoid pasting a full product description)"
                rows={3}
                className="w-full rounded-xl bg-black border border-white/15 px-4 py-3 text-white outline-none resize-y min-h-[5rem]"
              />
              {priceError && inputMode === "manual" ? (
                <p className="text-sm text-red-300">{priceError}</p>
              ) : null}
              <button
                type="button"
                onClick={handleCompare}
                disabled={!canCompare}
                className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black hover:bg-green-400 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-500"
              >
                {loading ? "Searching..." : "Compare Now"}
              </button>
              <CompareDepartmentDebugLine
                selectedDepartment={selectedDepartment}
              />
            </div>
          )}
          </div>

          {!selectedDepartment ? (
            <p className="mb-4 text-sm text-amber-200/80">
              Select a department above to unlock product input.
            </p>
          ) : null}

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
                  <span className="font-semibold text-cyan-200/95">Brainy AI: </span>
                  {result.aiProductSummary}
                </p>
              ) : null}

              {result.sourceProduct?.sourceUrl && result.sourceProduct.title ? (
                <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60 mb-3">
                    Original product
                  </h3>
                  <div className="flex gap-4">
                    {result.sourceProduct.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result.sourceProduct.imageUrl}
                        alt=""
                        className="h-24 w-24 rounded-lg object-contain bg-white shrink-0"
                      />
                    ) : (
                      <div className="h-24 w-24 rounded-lg bg-white/10 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <StoreLogo store={result.sourceProduct.store} />
                        <span className="text-white/70 text-sm font-medium">
                          {storeDisplayLabel(result.sourceProduct.store)}
                        </span>
                      </div>
                      <p className="font-medium text-white line-clamp-3">
                        {result.sourceProduct.title}
                      </p>
                      <p className="text-green-400 font-semibold mt-2">
                        {formatReferencePrice(result.sourceProduct.originalPrice)}
                      </p>
                      {result.sourceProduct.originalPrice != null &&
                      Number.isFinite(result.sourceProduct.originalPrice) ? (
                        <p className="text-white/45 text-xs mt-1">
                          Reference price for savings comparisons
                        </p>
                      ) : null}
                      {(() => {
                        const sp = result.sourceProduct;
                        if (!sp) return null;
                        const href = sourceListingRedirectHref({
                          sourceUrl: sp.sourceUrl,
                          store: sp.store,
                          title: sp.title,
                        });
                        if (!href) return null;
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex mt-3 items-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10"
                          >
                            View original listing
                          </a>
                        );
                      })()}
                    </div>
                  </div>
                </div>
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

              {onlyPossibleAlternatives ? (
                <p className="text-amber-100/90 text-sm rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                  {POSSIBLE_ALTERNATIVES_EXPLANATION}
                </p>
              ) : null}

              {(visibleMatchCount > 0 ||
                (result.similarButNotCheaper?.length ?? 0) > 0 ||
                result.comparisonMessage ||
                result.message) && (
                <div>
                  <h3 className="text-xl font-semibold text-white mb-1">
                    {visibleMatchCount > 0
                      ? onlyPossibleAlternatives
                        ? NO_EXACT_WITH_ALTERNATIVES_MESSAGE
                        : (result.comparisonMessage ?? "Best savings")
                      : (result.comparisonMessage ??
                        result.message ??
                        "No cheaper matching products found yet.")}
                  </h3>
                  {visibleMatchCount > 0 ? (
                    <>
                      {!onlyPossibleAlternatives ? (
                        <p className="text-white/50 text-sm mb-4">
                          {visibleMatchCount}{" "}
                          {visibleMatchCount === 1 ? "listing" : "listings"}{" "}
                          cheaper than your reference price.
                        </p>
                      ) : null}
                      {matchGroups
                        ? MATCH_GROUP_SECTIONS.map((section) => {
                            const items = matchGroups[section.key];
                            if (!items?.length) return null;
                            return (
                              <section key={section.key} className="mb-8">
                                <h4 className="text-lg font-semibold text-white/90">
                                  {section.title} ({items.length})
                                </h4>
                                <p className="text-white/45 text-sm mt-1 mb-3">
                                  {section.description}
                                </p>
                                <ul className="space-y-3">
                                  {items.map((c) =>
                                    renderCandidateCard(c, {
                                      isWinner:
                                        Boolean(showBest && best) &&
                                        c.productUrl === best!.productUrl &&
                                        c.store === best!.store,
                                      best,
                                      onTrack: trackPrice,
                                    })
                                  )}
                                </ul>
                              </section>
                            );
                          })
                        : null}
                    </>
                  ) : (
                    <p className="text-amber-100/90 text-sm mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                      {result.comparisonMessage ??
                        result.message ??
                        "No cheaper matching products found yet."}
                    </p>
                  )}
                  {(result.similarButNotCheaper?.length ?? 0) > 0 ? (
                    <details className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-white/80">
                        Other similar products ({result.similarButNotCheaper!.length})
                      </summary>
                      <ul className="space-y-3 mt-4">
                        {result.similarButNotCheaper!.map((c) =>
                          renderCandidateCard(c, {
                            isWinner: false,
                            best: null,
                            onTrack: trackPrice,
                          })
                        )}
                      </ul>
                    </details>
                  ) : null}
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </main>
  );
}
