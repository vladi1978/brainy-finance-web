/**
 * Map noisy statement descriptors onto friendly subscription labels.
 */

const INLINE_ALIASES: Array<{ test: RegExp; key: string; display: string }> =
  [
    { test: /\bAPPLE\.COM\s*\/?\s*BILL\b/iu, key: "APPLE", display: "Apple" },
    { test: /\bAPPLE\s+BILL\b/iu, key: "APPLE", display: "Apple" },
    { test: /\bAPL\*[\s]*[A-Z0-9._-]+\b/iu, key: "APPLE", display: "Apple" },
    { test: /\bNETFLIX(?:\.COM)?\b/iu, key: "NETFLIX", display: "Netflix" },
    {
      test: /\bSPOTIFY(?:[\s.]COM)?\b/iu,
      key: "SPOTIFY",
      display: "Spotify",
    },
    {
      test: /\bDISNEY\+?\b/iu,
      key: "DISNEY PLUS",
      display: "Disney+",
    },
    { test: /\bHULU\b/iu, key: "HULU", display: "Hulu" },
    { test: /\bHBO(?:\s+MAX)?\b/iu, key: "HBO MAX", display: "HBO Max" },
    {
      test: /\bGOOGLE\*?\s*YOUTUBE\b/iu,
      key: "YOUTUBE",
      display: "YouTube",
    },
    {
      test: /\bAMAZON\s+PRIME\b/iu,
      key: "AMAZON PRIME",
      display: "Amazon Prime",
    },
    { test: /\bAMZN\b/iu, key: "AMAZON", display: "Amazon" },
    {
      test: /\bMICROSOFT\b|\bMSFT\*365\b/iu,
      key: "MICROSOFT",
      display: "Microsoft",
    },
    { test: /\bADOBE\*?\b/iu, key: "ADOBE", display: "Adobe" },
    { test: /\bDROPBOX\*?\b/iu, key: "DROPBOX", display: "Dropbox" },
    { test: /\bOPENAI\b/iu, key: "OPENAI", display: "OpenAI" },
    { test: /\bPELOTON\b/iu, key: "PELOTON", display: "Peloton" },
  ];

/** Uppercase keyed labels for collapsing clusters */
export function applyInlineMerchantAliases(text: string): string {
  let t = text;
  for (const { test, key } of INLINE_ALIASES) {
    const g = test.flags.includes("g") ? test.flags : `${test.flags}g`;
    t = t.replace(new RegExp(test.source, g), ` ${key} `);
  }
  return t.replace(/\s+/gu, " ").trim();
}

/** Human subscription label inferred from descriptor text only */
export function canonicalConsumerBrandFromDescription(
  description: string
): string | null {
  for (const { test, display } of INLINE_ALIASES) {
    if (test.test(description)) return display;
  }
  return null;
}

function titleCaseTokens(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/gu)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Friendly label shown for a cluster-backed subscription row */
export function friendlyMerchantSubscriptionLabel(args: {
  primaryDescription: string;
  clusterKeyUpper: string;
}): string {
  const fromCanon = canonicalConsumerBrandFromDescription(
    args.primaryDescription
  );
  if (fromCanon) return fromCanon.slice(0, 80);

  const k = args.clusterKeyUpper.trim();
  const head =
    k
      .split(/\s+/u)
      .find((p) => p.length >= 3 && /[A-Z]/u.test(p)) ?? k.slice(0, 48);
  return titleCaseTokens(head).slice(0, 80);
}
