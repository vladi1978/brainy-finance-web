import { NextResponse } from "next/server";
import { compareProduct } from "@/lib/product/engine";
import {
  isValidReferencePriceInput,
  manualFormHasSearchableCore,
  normalizeManualProductForm,
  REFERENCE_PRICE_REQUIRED_MESSAGE,
} from "@/lib/product/manualProductInput";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const debug = Boolean(body?.debug);
    const pricePaid =
      typeof body?.pricePaid === "string"
        ? body.pricePaid
        : typeof body?.referencePrice === "string"
          ? body.referencePrice
          : null;

    const manual = normalizeManualProductForm(body?.manualProduct);
    const linkFromForm = manual?.link?.trim();
    const resolvedPricePaid =
      pricePaid?.trim() || manual?.pricePaid?.trim() || "";

    if (!isValidReferencePriceInput(resolvedPricePaid)) {
      return NextResponse.json(
        { error: REFERENCE_PRICE_REQUIRED_MESSAGE },
        { status: 400 }
      );
    }

    const compareOpts = {
      debug,
      pricePaid: resolvedPricePaid,
    };

    if (linkFromForm) {
      const result = await compareProduct(linkFromForm, compareOpts);
      return NextResponse.json(result);
    }

    if (manual && manualFormHasSearchableCore(manual)) {
      const result = await compareProduct("", {
        ...compareOpts,
        manualProduct: manual,
      });
      return NextResponse.json(result);
    }

    const input = body?.input?.trim();
    if (!input) {
      return NextResponse.json(
        { error: "Missing product input" },
        { status: 400 }
      );
    }

    const result = await compareProduct(input, compareOpts);

    return NextResponse.json(result);
  } catch (error) {
    console.error("COMPARE PRODUCT API ERROR:", error);
    const message =
      error instanceof Error ? error.message.trim() : "Failed to compare product";
    if (message === REFERENCE_PRICE_REQUIRED_MESSAGE) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Failed to compare product" },
      { status: 500 }
    );
  }
}
