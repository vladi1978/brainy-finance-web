"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

type SubscriptionFlags = {
  forgotten: boolean;
  duplicate: boolean;
  priceIncreased: boolean;
  trialConverted: boolean;
  suspicious: boolean;
};

type SubscriptionRow = {
  clusterId: string;
  merchant: string;
  normalizedName: string;
  category: string;
  amount: number;
  currency: string;
  frequency: string;
  lastCharged: string;
  monthlyEquivalent: number;
  annualEquivalent: number;
  confidence: number;
  flags: SubscriptionFlags;
  totalSpentInPeriod: number;
  daysSinceLastCharge: number | null;
};

type ParseDebugMeta = {
  totalExtractedChars: number;
  cleanedLineCount: number;
  reconstructedLineCount: number;
  candidateCount: number;
  highConfidenceParsed: number;
  acceptedCount: number;
  rejectedCount: number;
  aiDisambiguatedCount: number;
  fullTextAiFallbackUsed: boolean;
};

type AnalyzeOk = {
  ok: true;
  meta: {
    pageCount: number;
    transactionCount: number;
    textChars: number;
    statementPeriod: { start: string; end: string } | null;
    openAiUsed: boolean;
    openAiError: string | null;
    fallbackUsed: boolean;
    parseDebug: ParseDebugMeta | null;
  };
  summary: {
    monthlySpend: number;
    annualSpend: number;
    subscriptionCount: number;
    estimatedSavings: number;
  };
  subscriptions: SubscriptionRow[];
};

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function dominantSubscriptionCurrency(rows: SubscriptionRow[]): string {
  if (!rows.length) return "USD";
  const counts = new Map<string, number>();
  for (const s of rows) {
    const c = s.currency?.length === 3 ? s.currency : "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function merchantInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const ch = t[0];
  return /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(ch) ? ch.toUpperCase() : "#";
}

const freqLabel: Record<string, string> = {
  monthly: "Mensual",
  annual: "Anual",
  weekly: "Semanal",
  unknown: "Desconocida",
};

const catLabel: Record<string, string> = {
  streaming: "Streaming",
  music: "Música",
  fitness: "Fitness",
  insurance: "Seguros",
  software: "Software",
  shopping: "Compras",
  utilities: "Servicios",
  other: "Otro",
};

export default function StatementsClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeOk | null>(null);
  const [actions, setActions] = useState<
    Record<string, "cancel" | "review" | "keep" | "alt" | undefined>
  >({});

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setError(null);
    setData(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/statements/analyze", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as AnalyzeOk & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Error al analizar el PDF.");
        return;
      }
      setData(json as AnalyzeOk);
    } catch {
      setError("No se pudo subir el archivo. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  }, []);

  const periodLabel = useMemo(() => {
    if (!data?.meta.statementPeriod) return null;
    const { start, end } = data.meta.statementPeriod;
    return `${start} → ${end}`;
  }, [data]);

  const summaryCurrency = useMemo(
    () => (data ? dominantSubscriptionCurrency(data.subscriptions) : "USD"),
    [data]
  );

  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold">
          Estados de cuenta y suscripciones
        </h1>
        <p className="mb-8 max-w-2xl text-white/70">
          Sube un estado de cuenta en PDF de cualquier banco o país. En el
          servidor extraemos el texto, reconstruimos líneas cortadas, puntuamos
          candidatos a transacción y usamos IA solo cuando hace falta. El
          archivo PDF no se envía a OpenAI.
        </p>

        <label className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.04] px-6 py-10 transition hover:border-emerald-400/35 hover:bg-white/[0.06]">
          <span className="text-sm font-medium text-white">
            {busy ? "Procesando PDF…" : "Arrastra o elige un PDF"}
          </span>
          <span className="text-xs text-white/45">
            Extracción multipágina con pdf-parse · máx. 12 MB
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {busy ? (
          <div className="mt-6 space-y-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-4 text-sm text-emerald-100/90">
            <p className="font-medium text-emerald-200">Procesando…</p>
            <ul className="list-inside list-disc space-y-1 text-white/60">
              <li>Leyendo páginas del PDF</li>
              <li>Normalizando y reuniendo líneas de movimientos</li>
              <li>Extrayendo y validando transacciones</li>
              <li>Detectando posibles suscripciones recurrentes</li>
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 space-y-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <p className="font-semibold text-red-100">No se pudo completar el análisis</p>
            <p>{error}</p>
            <p className="text-xs text-red-200/70">
              Si el PDF está escaneado como imagen, prueba otro archivo con
              texto seleccionable o exporta el estado desde tu banca en línea.
            </p>
          </div>
        ) : null}

        {data ? (
          <div className="mt-10 space-y-10">
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              {periodLabel ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Periodo detectado: {periodLabel}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Páginas: {data.meta.pageCount}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Transacciones detectadas: {data.meta.transactionCount}
              </span>
              {data.meta.transactionCount === 0 ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                  No se extrajeron movimientos — prueba otro PDF o uno con texto
                  seleccionable
                </span>
              ) : null}
              {data.meta.parseDebug ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  IA en líneas dudosas: {data.meta.parseDebug.aiDisambiguatedCount}
                  {data.meta.parseDebug.fullTextAiFallbackUsed
                    ? " · Rescate IA (texto completo)"
                    : ""}
                </span>
              ) : null}
              {data.meta.fallbackUsed ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                  Suscripciones por reglas locales (sin IA o sin clusters)
                </span>
              ) : null}
              {data.meta.openAiUsed ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                  Análisis OpenAI aplicado
                </span>
              ) : null}
              {data.meta.openAiError ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
                  OpenAI: {data.meta.openAiError}
                </span>
              ) : null}
            </div>

            {data.meta.parseDebug ? (
              <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
                <summary className="cursor-pointer select-none text-white/70">
                  Diagnóstico del extractor de movimientos
                </summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-white/40">Caracteres extraídos</dt>
                    <dd>{data.meta.parseDebug.totalExtractedChars}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Líneas físicas / reconstruidas</dt>
                    <dd>
                      {data.meta.parseDebug.cleanedLineCount} /{" "}
                      {data.meta.parseDebug.reconstructedLineCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Regex alta confianza</dt>
                    <dd>{data.meta.parseDebug.highConfidenceParsed}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Aceptadas / rechazadas (muestra)</dt>
                    <dd>
                      {data.meta.parseDebug.acceptedCount} /{" "}
                      {data.meta.parseDebug.rejectedCount}
                    </dd>
                  </div>
                </dl>
              </details>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                title="Gasto mensual est."
                value={formatMoney(data.summary.monthlySpend, summaryCurrency)}
                subtitle={
                  data.subscriptions.length
                    ? `Suma en ${summaryCurrency} (por categoría del modelo)`
                    : "Sin suscripciones detectadas"
                }
              />
              <SummaryCard
                title="Gasto anual est."
                value={formatMoney(data.summary.annualSpend, summaryCurrency)}
              />
              <SummaryCard
                title="Suscripciones"
                value={String(data.summary.subscriptionCount)}
              />
              <SummaryCard
                title="Ahorro estimado"
                subtitle="Suma mensual de cargos marcados"
                value={formatMoney(data.summary.estimatedSavings, summaryCurrency)}
              />
            </section>

            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white">
                Suscripciones detectadas
              </h2>
              {data.subscriptions.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">
                  No encontramos cargos recurrentes con suficiente evidencia.
                  Puede deberse a pocas transacciones en el periodo, a que el PDF
                  no tiene tabla clara de movimientos o a filtros de seguridad
                  que excluyen nóminas, transferencias y comisiones. Prueba otro
                  estado o un archivo con texto seleccionable.
                </p>
              ) : (
                <ul className="space-y-4">
                  {data.subscriptions.map((s) => (
                    <li key={s.clusterId}>
                      <SubscriptionCard
                        row={s}
                        action={actions[s.clusterId]}
                        onAction={(key) =>
                          setActions((prev) => ({
                            ...prev,
                            [s.clusterId]: key,
                          }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard(props: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
        {props.title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-white">{props.value}</p>
      {props.subtitle ? (
        <p className="mt-1 text-xs text-white/45">{props.subtitle}</p>
      ) : null}
    </div>
  );
}

function SubscriptionCard(props: {
  row: SubscriptionRow;
  action?: "cancel" | "review" | "keep" | "alt";
  onAction: (key: "cancel" | "review" | "keep" | "alt") => void;
}) {
  const { row: s, action, onAction } = props;
  const badges: Array<{ key: string; label: string }> = [];
  if (s.flags.forgotten) badges.push({ key: "f", label: "OLVIDADA" });
  if (s.flags.duplicate) badges.push({ key: "d", label: "DUPLICADO" });
  if (s.flags.priceIncreased) badges.push({ key: "p", label: "SUBIÓ PRECIO" });
  if (s.flags.suspicious) badges.push({ key: "s", label: "SOSPECHOSA" });
  if (s.flags.trialConverted)
    badges.push({ key: "t", label: "TRIAL → PAGO" });

  const compareHref = `/compare?subscriptionMerchant=${encodeURIComponent(s.normalizedName)}`;

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">
      <div className="flex flex-wrap gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-lg font-bold text-emerald-200">
          {merchantInitial(s.merchant)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {s.merchant}
            </h3>
            <span className="text-sm text-white/50">
              Confianza {(s.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {s.normalizedName.trim().toUpperCase() !==
          s.merchant.trim().toUpperCase() ? (
            <p className="mt-0.5 text-xs text-white/45">
              Etiqueta: {s.normalizedName}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-white/45">
            Último cargo: {s.lastCharged}
            {s.daysSinceLastCharge != null
              ? ` · Hace ${s.daysSinceLastCharge} días`
              : ""}
            {" · "}
            Total en periodo: {formatMoney(s.totalSpentInPeriod, s.currency)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b.key}
                className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100"
              >
                {b.label.trim()}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white">
            {formatMoney(s.amount, s.currency)}
          </p>
          <p className="text-xs text-white/45">
            {freqLabel[s.frequency] ?? s.frequency}
          </p>
          <p className="text-xs text-emerald-200/90">
            ≈ {formatMoney(s.monthlyEquivalent, s.currency)}/mes ·{" "}
            {formatMoney(s.annualEquivalent, s.currency)}/año
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            {catLabel[s.category] ?? s.category}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        <ActionChip
          label="Cancelar"
          pressed={action === "cancel"}
          onClick={() => onAction("cancel")}
        />
        <ActionChip
          label="Revisar"
          pressed={action === "review"}
          onClick={() => onAction("review")}
        />
        <ActionChip
          label="Mantener"
          pressed={action === "keep"}
          onClick={() => onAction("keep")}
        />
        <Link
          href={compareHref}
          className={[
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
            action === "alt"
              ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
              : "border-white/15 bg-white/5 text-white/80 hover:border-white/25",
          ].join(" ")}
          onClick={() => onAction("alt")}
        >
          Buscar alternativa
        </Link>
      </div>
    </div>
  );
}

function ActionChip(props: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
        props.pressed
          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
          : "border-white/15 bg-white/5 text-white/80 hover:border-white/25",
      ].join(" ")}
    >
      {props.label}
    </button>
  );
}
