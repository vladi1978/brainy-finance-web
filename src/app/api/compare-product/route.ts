import { NextResponse } from "next/server";
import {
  MAX_COMPARE_BODY_BYTES,
  MAX_COMPARE_INPUT_CHARS,
  MAX_MANUAL_FIELD_CHARS,
  contentLengthExceeds,
} from "@/lib/api/publicRequestGuards";
import { compareProduct } from "@/lib/product/engine";
import {
  isValidReferencePriceInput,
  manualFormHasSearchableCore,
  normalizeManualProductForm,
  REFERENCE_PRICE_REQUIRED_MESSAGE,
} from "@/lib/product/manualProductInput";
import { parseCompareFlowDepartment } from "@/lib/product/compareFlowDepartment";
import type { CompareFlowDepartment } from "@/lib/product/compareFlowDepartment";

/** When false (default), ignore client `debug` and keep compare logs quiet. Set DEBUG_COMPARE=true to enable. */
const COMPARE_DEBUG = process.env.DEBUG_COMPARE === "true";

const COMPARE_API_LOG_PREFIX = "[compare-product:api]";

type CompareApiStage =
  | "parse_body"
  | "validate_body_shape"
  | "resolve_price_paid"
  | "parse_department"
  | "resolve_compare_path"
  | "compare_link"
  | "compare_manual"
  | "compare_input"
  | "validate_compare_result"
  | "serialize_response";

function logCompareApi(
  stage: CompareApiStage,
  payload: Record<string, unknown>
): void {
  if (process.env.NODE_ENV !== "development") return;
  console.log(COMPARE_API_LOG_PREFIX, { stage, ...payload });
}

function structuredCompareFailure(
  stage: CompareApiStage,
  selectedDepartment: CompareFlowDepartment | null,
  error: unknown,
  requestSummary: Record<string, unknown>
) {
  const message =
    error instanceof Error
      ? error.message.trim() || "Unknown compare error"
      : typeof error === "string"
        ? error.trim() || "Unknown compare error"
        : "Unknown compare error";

  console.error(COMPARE_API_LOG_PREFIX, {
    stage,
    selectedDepartment,
    requestSummary,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  const debug =
    process.env.NODE_ENV === "development"
      ? {
          stage,
          selectedDepartment,
          message,
          requestSummary,
        }
      : undefined;

  return NextResponse.json(
    {
      success: false,
      error: "compare_failed",
      message:
        "We could not compare this product right now. Please try again in a moment.",
      ...(debug ? { debug } : {}),
    },
    { status: 500 }
  );
}

function summarizeRequestBody(record: Record<string, unknown>): Record<string, unknown> {
  const manual = normalizeManualProductForm(record.manualProduct);
  return {
    hasInput: typeof record.input === "string" && record.input.trim().length > 0,
    hasManualProduct: manual != null,
    manualHasLink: Boolean(manual?.link?.trim()),
    manualHasSearchableCore: manual ? manualFormHasSearchableCore(manual) : false,
    departmentRaw:
      typeof record.department === "string"
        ? record.department.slice(0, 64)
        : record.department == null
          ? null
          : "invalid",
    hasPricePaid:
      typeof record.pricePaid === "string" ||
      typeof record.referencePrice === "string",
    debugRequested: Boolean(record.debug),
  };
}

function stringFieldTooLong(
  value: unknown,
  maxChars: number
): value is string {
  return typeof value === "string" && value.length > maxChars;
}

function validateCompareFieldBounds(
  record: Record<string, unknown>
): string | null {
  if (stringFieldTooLong(record.input, MAX_COMPARE_INPUT_CHARS)) {
    return `Product input exceeds ${MAX_COMPARE_INPUT_CHARS} characters.`;
  }
  if (stringFieldTooLong(record.pricePaid, MAX_MANUAL_FIELD_CHARS)) {
    return "pricePaid is too long.";
  }
  if (stringFieldTooLong(record.referencePrice, MAX_MANUAL_FIELD_CHARS)) {
    return "referencePrice is too long.";
  }
  if (stringFieldTooLong(record.department, MAX_MANUAL_FIELD_CHARS)) {
    return "department is too long.";
  }

  const manualRaw = record.manualProduct;
  if (manualRaw != null) {
    if (typeof manualRaw !== "object" || Array.isArray(manualRaw)) {
      return "manualProduct must be an object.";
    }
    const manual = manualRaw as Record<string, unknown>;
    for (const key of [
      "link",
      "brand",
      "productNameOrModel",
      "category",
      "pricePaid",
    ] as const) {
      if (stringFieldTooLong(manual[key], MAX_MANUAL_FIELD_CHARS)) {
        return `manualProduct.${key} is too long.`;
      }
    }
  }

  return null;
}

export async function POST(req: Request) {
  let stage: CompareApiStage = "parse_body";
  let selectedDepartment: CompareFlowDepartment | null = null;
  let requestSummary: Record<string, unknown> = {};

  try {
    if (contentLengthExceeds(req, MAX_COMPARE_BODY_BYTES)) {
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

    stage = "validate_body_shape";
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const record = body as Record<string, unknown>;
    const boundsError = validateCompareFieldBounds(record);
    if (boundsError) {
      return NextResponse.json(
        { success: false, error: boundsError },
        { status: 400 }
      );
    }

    requestSummary = summarizeRequestBody(record);
    logCompareApi(stage, {
      requestSummary,
    });

    const debug = Boolean(record.debug) && COMPARE_DEBUG;

    stage = "resolve_price_paid";
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

    stage = "parse_department";
    selectedDepartment = parseCompareFlowDepartment(record.department);
    logCompareApi(stage, {
      requestBody: requestSummary,
      selectedDepartment,
    });
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DEPARTMENT_REQUEST]",
        JSON.stringify({
          selectedDepartment,
          departmentRaw: record.department ?? null,
          requestSummary,
        })
      );
    }

    if (!selectedDepartment) {
      return NextResponse.json(
        {
          success: false,
          error: "Choose a department before comparing.",
        },
        { status: 400 }
      );
    }

    const compareOpts = {
      debug,
      pricePaid: resolvedPricePaid,
      department: selectedDepartment,
    };

    stage = "resolve_compare_path";
    let result;
    try {
      if (linkFromForm) {
        stage = "compare_link";
        logCompareApi(stage, { selectedDepartment, requestBody: requestSummary });
        result = await compareProduct(linkFromForm, compareOpts);
      } else if (manual && manualFormHasSearchableCore(manual)) {
        stage = "compare_manual";
        logCompareApi(stage, { selectedDepartment, requestBody: requestSummary });
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
        stage = "compare_input";
        logCompareApi(stage, { selectedDepartment, requestBody: requestSummary });
        result = await compareProduct(input, compareOpts);
      }
    } catch (compareError) {
      return structuredCompareFailure(
        stage,
        selectedDepartment,
        compareError,
        requestSummary
      );
    }

    stage = "validate_compare_result";
    if (result == null || typeof result !== "object") {
      return structuredCompareFailure(
        stage,
        selectedDepartment,
        new Error("Compare returned an empty or non-object result"),
        requestSummary
      );
    }

    stage = "serialize_response";
    logCompareApi(stage, { selectedDepartment, requestBody: requestSummary });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[COMPARE_API_ERROR]", error);
    const thrownMessage =
      error instanceof Error ? error.message.trim() : "";

    if (thrownMessage === REFERENCE_PRICE_REQUIRED_MESSAGE) {
      return NextResponse.json(
        { success: false, error: REFERENCE_PRICE_REQUIRED_MESSAGE },
        { status: 400 }
      );
    }

    if (thrownMessage === "Choose a department before comparing products.") {
      return NextResponse.json(
        { success: false, error: "Choose a department before comparing." },
        { status: 400 }
      );
    }

    return structuredCompareFailure(
      stage,
      selectedDepartment,
      error,
      requestSummary
    );
  }
}
