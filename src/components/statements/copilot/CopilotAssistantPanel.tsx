"use client";

import { useCallback, useState } from "react";
import {
  MOCK_SUGGESTED_PROMPTS,
  mockAssistantReply,
} from "@/lib/statements/timeline/mockAssistant";
import type { CopilotTimelineResult } from "@/lib/statements/timeline/types";

type Props = {
  copilot: CopilotTimelineResult | undefined;
};

type ChatMessage = { role: "user" | "assistant"; text: string };

export function CopilotAssistantPanel({ copilot }: Props) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: mockAssistantReply("", copilot),
    },
  ]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const reply = mockAssistantReply(trimmed, copilot);
      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed },
        { role: "assistant", text: reply.replace(/\*\*/g, "") },
      ]);
      setInput("");
    },
    [copilot]
  );

  return (
    <aside className="bf-copilot-enter flex h-full min-h-[320px] flex-col rounded-2xl border border-violet-400/15 bg-gradient-to-b from-violet-500/[0.08] to-black/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-200/80">
        AI Assistant
      </p>
      <p className="mt-1 text-[10px] text-white/40">Demo responses · not live AI</p>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={[
              "rounded-xl px-3 py-2 text-xs leading-relaxed",
              m.role === "user"
                ? "ml-6 border border-white/10 bg-white/[0.06] text-white/80"
                : "mr-4 border border-violet-400/15 bg-violet-500/[0.08] text-violet-100/90",
            ].join(" ")}
          >
            {m.text}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {MOCK_SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => send(p)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/60 transition hover:border-violet-400/30 hover:text-violet-100"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about priorities…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-violet-400/40 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-violet-400/30 bg-violet-500/20 px-3 py-2 text-xs font-medium text-violet-100 transition hover:bg-violet-500/30"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
