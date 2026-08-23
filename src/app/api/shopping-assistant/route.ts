import { NextResponse } from "next/server";
import { runShoppingAssistant } from "@/lib/product/shoppingAssistant";
import {
  MAX_SHOPPING_BODY_BYTES,
  MAX_SHOPPING_REQUEST_CHARS,
  contentLengthExceeds,
} from "@/lib/api/publicRequestGuards";

export async function POST(req: Request) {
  if (contentLengthExceeds(req, MAX_SHOPPING_BODY_BYTES)) {
    return NextResponse.json(
      { success: false, error: "Request body too large" },
      { status: 413 }
    );
  }

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
  const requestText =
    (typeof record.request === "string" && record.request) ||
    (typeof record.input === "string" && record.input) ||
    (typeof record.query === "string" && record.query) ||
    "";

  if (typeof requestText !== "string" || !requestText.trim()) {
    return NextResponse.json(
      { success: false, error: "Missing shopping request" },
      { status: 400 }
    );
  }

  if (requestText.length > MAX_SHOPPING_REQUEST_CHARS) {
    return NextResponse.json(
      {
        success: false,
        error: `Shopping request exceeds ${MAX_SHOPPING_REQUEST_CHARS} characters.`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await runShoppingAssistant(requestText);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.trim() : "Shopping assistant failed";
    if (/describe the product/i.test(message)) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    console.error(
      "[shopping-assistant]",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        success: false,
        error:
          "We could not complete that shopping request right now. Please try again.",
      },
      { status: 500 }
    );
  }
}
