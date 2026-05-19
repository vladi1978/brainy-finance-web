import { NextResponse } from "next/server";
import { compareProduct } from "@/lib/product/engine";
import {
  manualFormHasSearchableCore,
  normalizeManualProductForm,
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
    const compareOpts = {
      debug,
      pricePaid: pricePaid?.trim() || manual?.pricePaid || null,
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

    return NextResponse.json(
      { error: "Failed to compare product" },
      { status: 500 }
    );
  }
}
