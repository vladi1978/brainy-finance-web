import OpenAI from "openai";

import type { ActionRecommendation } from "./types";

const MODEL_DEFAULT = "gpt-4o-mini";

/**
 * Optionally rewrites recommendation titles/descriptions for clarity.
 * Never changes savings figures — amounts are passed as read-only context.
 */
export async function enrichRecommendationsWording(
  items: ActionRecommendation[],
  options?: { signal?: AbortSignal }
): Promise<ActionRecommendation[]> {
  if (!items.length) return items;

  const enabled =
    process.env.OPENAI_RECOMMENDATIONS_WORDING?.trim() === "1" ||
    process.env.OPENAI_RECOMMENDATIONS_WORDING?.trim() === "true";
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!enabled || !apiKey) return items;

  const model =
    process.env.OPENAI_RECOMMENDATIONS_MODEL?.trim() || MODEL_DEFAULT;

  const client = new OpenAI({ apiKey });

  const payload = items.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    actionType: r.actionType,
    merchantReference: r.merchantReference ?? null,
    estimatedMonthlySavings: r.estimatedMonthlySavings,
    severity: r.severity,
  }));

  try {
    const res = await client.chat.completions.create(
      {
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Rewrite financial action recommendation copy to be concise and helpful. " +
              "Return JSON { recommendations: [{ id, title, description }] } with the same ids. " +
              "Do NOT invent dollar amounts, prices, or savings — only improve wording.",
          },
          {
            role: "user",
            content: JSON.stringify({ recommendations: payload }),
          },
        ],
      },
      { signal: options?.signal }
    );

    const content = res.choices[0]?.message?.content?.trim();
    if (!content) return items;

    const parsed = JSON.parse(content) as {
      recommendations?: Array<{
        id: string;
        title?: string;
        description?: string;
      }>;
    };
    if (!Array.isArray(parsed.recommendations)) return items;

    const byId = new Map(
      parsed.recommendations
        .filter((r) => r?.id && typeof r.id === "string")
        .map((r) => [r.id, r])
    );

    return items.map((item) => {
      const patch = byId.get(item.id);
      if (!patch) return item;
      return {
        ...item,
        title:
          typeof patch.title === "string" && patch.title.trim()
            ? patch.title.trim()
            : item.title,
        description:
          typeof patch.description === "string" && patch.description.trim()
            ? patch.description.trim()
            : item.description,
      };
    });
  } catch (e) {
    console.warn(
      "[recommendations/openaiWording] skipped:",
      e instanceof Error ? e.message : e
    );
    return items;
  }
}
