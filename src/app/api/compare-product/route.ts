import { NextResponse } from "next/server";
import { compareProduct } from "@/lib/product/compareEngine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = body?.input?.trim();

    if (!input) {
      return NextResponse.json(
        { error: "Missing product input" },
        { status: 400 }
      );
    }

    const result = await compareProduct(input);

    return NextResponse.json(result);
  } catch (error) {
    console.error("COMPARE PRODUCT API ERROR:", error);

    return NextResponse.json(
      { error: "Failed to compare product" },
      { status: 500 }
    );
  }
}