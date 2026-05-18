import { NextResponse } from "next/server";
import { analyzeStatementPdf } from "@/lib/statements/analyzeStatement";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "PDF file missing from request." },
        { status: 400 }
      );
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { ok: false, error: "Only PDF uploads are accepted." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "PDF exceeds the maximum upload limit (12 MB).",
        },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await analyzeStatementPdf(buffer);

    console.log(
      "[statements/analyze] extracted text length (chars):",
      result.textChars
    );
    console.log(
      "[statements/analyze] first 5 parsed transactions:",
      result.transactions.slice(0, 5)
    );
    if (result.parseDebug) {
      console.log(
        "[statements/analyze] pipeline diagnostics:",
        JSON.stringify({
          extractedChars: result.parseDebug.totalExtractedChars,
          cleanedLines: result.parseDebug.cleanedLineCount,
          reconstructedLines: result.parseDebug.reconstructedLineCount,
          accepted: result.parseDebug.acceptedCount,
          rejected: result.parseDebug.rejectedCount,
          aiDisambiguated: result.parseDebug.aiDisambiguatedCount,
          fullTextAiFallback: result.parseDebug.fullTextAiFallbackUsed,
        })
      );
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
        parseDebug: result.parseDebug,
      },
      summary: result.summary,
      subscriptions: result.subscriptions,
      recurringExpenses: result.recurringExpenses,
      spendingInsights: result.spendingInsights,
      transfers: result.transfers,
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    console.error("STATEMENTS ANALYZE ERROR:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not read that statement PDF. Try a different export.",
      },
      { status: 500 }
    );
  }
}
