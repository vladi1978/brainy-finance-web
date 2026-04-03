import { InputKind } from "./types";

export function detectInputType(input: string): InputKind {
  const value = input.trim();

  const isUrl =
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.includes("www.");

  if (isUrl) return "url";

  const looksLikeDescription =
    value.length > 60 ||
    value.includes(",") ||
    value.toLowerCase().includes("with") ||
    value.toLowerCase().includes("for") ||
    value.toLowerCase().includes("inch") ||
    value.toLowerCase().includes("class");

  if (looksLikeDescription) return "description";

  return "name";
}