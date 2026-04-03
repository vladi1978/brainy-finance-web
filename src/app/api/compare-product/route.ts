import { NextResponse } from "next/server";
import { compareProduct } from "@/lib/product/engine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = body?.input?.trim();
    const debug = Boolean(body?.debug);

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