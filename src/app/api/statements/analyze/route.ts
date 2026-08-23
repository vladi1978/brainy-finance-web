import { NextResponse } from "next/server";
import {
  MAX_STATEMENT_UPLOAD_BYTES,
  contentLengthExceeds,
  isProductionRuntime,
} from "@/lib/api/publicRequestGuards";
import { analyzeStatementPdf } from "@/lib/statements/analyzeStatement";

export const runtime = "nodejs";

/**
 * PDF files must contain the `%PDF-` header. The ISO model allows the header
 * within the first 1024 bytes (BOM / leading noise). Require the marker there—
 * do not accept arbitrary files that merely claim application/pdf.
 */
function looksLikePdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const window = buffer.subarray(0, Math.min(buffer.length, 1024));
  return window.indexOf(Buffer.from("%PDF-", "latin1")) !== -1;
}

function isAcceptedPdfFile(file: File): boolean {
  const type = (file.type || "").trim().toLowerCase();
  const name = (file.name || "").trim().toLowerCase();
  if (type === "application/pdf") return true;
  if (!type && name.endsWith(".pdf")) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    if (contentLengthExceeds(req, MAX_STATEMENT_UPLOAD_BYTES)) {
      return NextResponse.json(
        {
          ok: false,
          error: "PDF exceeds the maximum upload limit (12 MB).",
        },
        { status: 413 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "PDF file missing from request." },
        { status: 400 }
      );
    }

    if (!isAcceptedPdfFile(file)) {
      return NextResponse.json(
        { ok: false, error: "Only PDF uploads are accepted." },
        { status: 400 }
      );
    }

    if (file.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "PDF file is empty." },
        { status: 400 }
      );
    }

    if (file.size > MAX_STATEMENT_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "PDF exceeds the maximum upload limit (12 MB).",
        },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!looksLikePdf(buffer)) {
      return NextResponse.json(
        { ok: false, error: "Only PDF uploads are accepted." },
        { status: 400 }
      );
    }

    const result = await analyzeStatementPdf(buffer);

    if (isProductionRuntime()) {
      console.log("[statements/analyze]", {
        pageCount: result.pageCount,
        transactionCount: result.transactions.length,
        textChars: result.textChars,
        openAiUsed: result.openAiUsed,
        fallbackUsed: result.fallbackUsed,
        accepted: result.parseDebug?.acceptedCount ?? null,
        rejected: result.parseDebug?.rejectedCount ?? null,
      });
    } else {
      console.log(
        "[statements/analyze] extracted text length (chars):",
        result.textChars
      );
      if (result.parseDebug) {
        console.log("[statements/analyze] pipeline diagnostics:", {
          extractedChars: result.parseDebug.totalExtractedChars,
          cleanedLines: result.parseDebug.cleanedLineCount,
          reconstructedLines: result.parseDebug.reconstructedLineCount,
          accepted: result.parseDebug.acceptedCount,
          rejected: result.parseDebug.rejectedCount,
          aiDisambiguated: result.parseDebug.aiDisambiguatedCount,
          fullTextAiFallback: result.parseDebug.fullTextAiFallbackUsed,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      meta: {
        pageCount: result.pageCount,
        transactionCount: result.transactions.length,
        textChars: result.textChars,
        statementPeriod: result.statementPeriod,
        openAiUsed: result.openAiUsed,
        openAiError: result.openAiError,
        fallbackUsed: result.fallbackUsed,
        parseDebug: isProductionRuntime() ? null : result.parseDebug,
      },
      summary: result.summary,
      subscriptions: result.subscriptions,
      recurringExpenses: result.recurringExpenses,
      spendingInsights: result.spendingInsights,
      transfers: result.transfers,
      diagnostics: result.diagnostics,
      intelligence: result.intelligence,
    });
  } catch (error) {
    console.error(
      "STATEMENTS ANALYZE ERROR:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Could not read that statement PDF. Try a different export.",
      },
      { status: 500 }
    );
  }
}
