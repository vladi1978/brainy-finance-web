export function normalizeQuery(input: string): string {
    return input
      .trim()
      .replace(/\s+/g, " ")
      .replace(/["']/g, "")
      .toLowerCase();
  }