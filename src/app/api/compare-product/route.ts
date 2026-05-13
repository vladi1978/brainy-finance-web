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

    const manual = normalizeManualProductForm(body?.manualProduct);
    const linkFromForm = manual?.link?.trim();

    if (linkFromForm) {
      const result = await compareProduct(linkFromForm, { debug });
      return NextResponse.json(result);
    }

    if (manual && manualFormHasSearchableCore(manual)) {
      const result = await compareProduct("", { debug, manualProduct: manual });
      return NextResponse.json(result);
    }

    const input = body?.input?.trim();
    if (!input) {
      return NextResponse.json(
        { error: "Missing product input" },
        { status: 400 }
      );
    }

    const result = await compareProduct(input, { debug });

    return NextResponse.json(result);
  } catch (error) {
    console.error("COMPARE PRODUCT API ERROR:", error);

    return NextResponse.json(
      { error: "Failed to compare product" },
      { status: 500 }
    );
  }
}
