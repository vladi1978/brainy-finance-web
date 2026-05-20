import { NextResponse } from "next/server";
import { compareProduct } from "@/lib/product/engine";
import {
  isValidReferencePriceInput,
  manualFormHasSearchableCore,
  normalizeManualProductForm,
  REFERENCE_PRICE_REQUIRED_MESSAGE,
} from "@/lib/product/manualProductInput";

/** When false (default), ignore client `debug` and keep compare logs quiet. Set DEBUG_COMPARE=true to enable. */
const COMPARE_DEBUG = process.env.DEBUG_COMPARE === "true";

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const record = body as Record<string, unknown>;
    const debug = Boolean(record.debug) && COMPARE_DEBUG;
    const pricePaid =
      typeof record.pricePaid === "string"
        ? record.pricePaid
        : typeof record.referencePrice === "string"
          ? record.referencePrice
          : null;

    const manual = normalizeManualProductForm(record.manualProduct);
    const linkFromForm = manual?.link?.trim();
    const resolvedPricePaid =
      (typeof pricePaid === "string" ? pricePaid : "").trim() ||
      manual?.pricePaid?.trim() ||
      "";

    if (!isValidReferencePriceInput(resolvedPricePaid)) {
      return NextResponse.json(
        {
          success: false,
          error: REFERENCE_PRICE_REQUIRED_MESSAGE,
        },
        { status: 400 }
      );
    }

    const compareOpts = {
      debug,
      pricePaid: resolvedPricePaid,
    };

    let result;
    if (linkFromForm) {
      result = await compareProduct(linkFromForm, compareOpts);
    } else if (manual && manualFormHasSearchableCore(manual)) {
      result = await compareProduct("", {
        ...compareOpts,
        manualProduct: manual,
      });
    } else {
      const input =
        typeof record.input === "string" ? record.input.trim() : "";
      if (!input) {
        return NextResponse.json(
          { success: false, error: "Missing product input" },
          { status: 400 }
        );
      }
      result = await compareProduct(input, compareOpts);
    }

    if (result == null || typeof result !== "object") {
      return NextResponse.json(
        { success: false, error: "Compare failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[COMPARE_API_ERROR]", error);
    const message =
      error instanceof Error ? error.message.trim() : "";

    if (message === REFERENCE_PRICE_REQUIRED_MESSAGE) {
      return NextResponse.json(
        { success: false, error: REFERENCE_PRICE_REQUIRED_MESSAGE },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Compare failed" },
      { status: 500 }
    );
  }
}
