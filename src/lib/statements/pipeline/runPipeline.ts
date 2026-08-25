import { disambiguateLineBatches } from "./aiBatch";
import { scoreTransactionCandidate } from "./candidateScore";
import { parseBlockWithStrategies, type ParsedRow } from "./extractRow";
import { inferStatementYear } from "./dates";
import { normalizePdfText, splitPhysicalLines } from "./textNormalize";
import { reconstructStatementLinesWithSections } from "./reconstructLines";
import { extractBankStatementSummaryTotals } from "./statementSummary";
import type { ParsePipelineDebug, Transaction } from "../types";
import type { PipelineResult } from "./types";
import { passesPostParseValidation } from "./validateRow";
import { extractTransactionsViaOpenAI } from "../transactionAiFallback";

const REGEX_ACCEPT_SCORE = 0.38;
const AI_QUEUE_MIN = 0.34;

function dedupeTransactions(rows: Transaction[]): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (const r of rows) {
    const key = `${r.date}|${r.description}|${r.amount}|${r.type}|${r.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function toTransaction(row: ParsedRow): Transaction {
  const { strategy: _, ...tx } = row;
  void _;
  return tx;
}

export async function runTransactionPipeline(
  rawText: string,
  signal: AbortSignal
): Promise<PipelineResult> {
  const totalExtractedChars = rawText.length;
  const normalized = normalizePdfText(rawText);
  const physical = splitPhysicalLines(normalized);
  const defaultYear = inferStatementYear(physical);
  const reconstructed = reconstructStatementLinesWithSections(
    physical,
    defaultYear
  );

  const rejected: ParsePipelineDebug["rejected"] = [];
  const aiPayloads: Array<{ globalIndex: number; text: string }> = [];
  const regexAccepted: ParsedRow[] = [];

  reconstructed.forEach((entry, globalIndex) => {
    const line = entry.text;
    const sectionHint = entry.section;
    const cleanedLine = line
      .replace(
        /\s+(?:Can you spot a scam\?|Be aware of these common red flags|When you use the QRC feature|Braille and Large Print|We want to help you avoid overdraft)[\s\S]*$/iu,
        ""
      )
      .trim();
    const cs = scoreTransactionCandidate(cleanedLine, defaultYear);
    const row = parseBlockWithStrategies(cleanedLine, defaultYear, sectionHint);
    const validRow =
      row && passesPostParseValidation(cleanedLine, row, defaultYear);

    if (validRow && cs.score >= REGEX_ACCEPT_SCORE) {
      regexAccepted.push(row);
      return;
    }

    const aiEligible =
      cs.score >= AI_QUEUE_MIN &&
      line.length >= 8 &&
      line.length <= 320 &&
      (cs.hasDate || cs.hasAmount);

    if (aiEligible) {
      aiPayloads.push({ globalIndex, text: line });
      return;
    }

    const reasons = [...cs.reasons];
    if (validRow && cs.score < REGEX_ACCEPT_SCORE) {
      reasons.push("puntuación baja; no enviado a IA");
    } else if (!validRow && row) {
      reasons.push("extracción rechazada en validación");
    } else if (!cs.hasDate && !cs.hasAmount) {
      reasons.push("sin fecha ni importe");
    }
    rejected.push({
      line: line.slice(0, 220),
      reasons: reasons.length ? reasons : ["sin coincidencia"],
    });
  });

  let aiTx: Transaction[] = [];
  let aiError: string | null = null;
  if (aiPayloads.length > 0) {
    const ai = await disambiguateLineBatches(
      aiPayloads,
      defaultYear,
      signal
    );
    aiError = ai.error;
    const asParsed: ParsedRow[] = ai.transactions.map((t) => ({
      ...t,
      strategy: "ai-batch",
    }));
    aiTx = asParsed
      .filter((row) =>
        passesPostParseValidation(
          `${row.date} ${row.description}`,
          row,
          defaultYear,
          0.02
        )
      )
      .map(toTransaction);
    if (aiError) {
      console.warn("[statement-pipeline] AI batch:", aiError);
    }
  }

  let merged = [...regexAccepted.map(toTransaction), ...aiTx];
  merged = dedupeTransactions(merged);
  merged.sort((a, b) => a.date.localeCompare(b.date));

  let fullTextAiFallbackUsed = false;
  if (merged.length === 0) {
    const fb = await extractTransactionsViaOpenAI(normalized, signal);
    if (fb.transactions.length > 0) {
      merged = dedupeTransactions(fb.transactions);
      merged.sort((a, b) => a.date.localeCompare(b.date));
      fullTextAiFallbackUsed = true;
    }
  }

  const structuredLog = {
    totalExtractedChars,
    cleanedLineCount: physical.length,
    reconstructedLineCount: reconstructed.length,
    transactionCandidates: reconstructed.length,
    highConfidenceParsed: regexAccepted.length,
    acceptedTransactions: merged.length,
    rejectedTransactions: rejected.length,
    aiDisambiguatedCount: aiTx.length,
    fullTextAiFallbackUsed,
    rejectionSample: rejected.slice(0, 40),
    firstTenParsed: merged.slice(0, 10).map((t) => ({
      date: t.date,
      description:
        t.description.slice(0, 80) + (t.description.length > 80 ? "…" : ""),
      amount: t.amount,
      type: t.type,
      currency: t.currency,
    })),
  };

  if (process.env.NODE_ENV === "production") {
    console.log("[statement-pipeline]", {
      totalExtractedChars: structuredLog.totalExtractedChars,
      reconstructedLineCount: structuredLog.reconstructedLineCount,
      highConfidenceParsed: structuredLog.highConfidenceParsed,
      acceptedTransactions: structuredLog.acceptedTransactions,
      rejectedTransactions: structuredLog.rejectedTransactions,
      aiDisambiguatedCount: structuredLog.aiDisambiguatedCount,
      fullTextAiFallbackUsed: structuredLog.fullTextAiFallbackUsed,
    });
  } else {
    console.log(
      "[statement-pipeline]",
      JSON.stringify(structuredLog, null, 2)
    );
  }

  const statementSummary = extractBankStatementSummaryTotals(normalized);

  const debug: ParsePipelineDebug = {
    totalExtractedChars,
    physicalLineCount: physical.length,
    cleanedLineCount: physical.length,
    reconstructedLineCount: reconstructed.length,
    candidateCount: reconstructed.length,
    highConfidenceParsed: regexAccepted.length,
    acceptedCount: merged.length,
    rejectedCount: rejected.length,
    aiDisambiguatedCount: aiTx.length,
    fullTextAiFallbackUsed,
    rejected: rejected.slice(0, 80),
    firstTenTransactions: merged.slice(0, 10).map((t) => ({
      date: t.date,
      description:
        t.description.slice(0, 80) + (t.description.length > 80 ? "…" : ""),
      amount: t.amount,
      type: t.type,
      currency: t.currency,
      source: fullTextAiFallbackUsed ? "ia-texto-completo" : "mezcla",
    })),
    statementSummary,
  };

  return { transactions: merged, debug };
}
