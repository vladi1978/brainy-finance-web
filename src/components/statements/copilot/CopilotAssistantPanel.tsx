"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildSuggestedPrompts,
  generateCopilotOpening,
  generateCopilotReply,
} from "@/lib/statements/copilot/contextualAssistant";
import type { CopilotAssistantContext } from "@/lib/statements/copilot/types";

type Props = {
  assistant: CopilotAssistantContext | undefined;
};

type ChatMessage = { role: "user" | "assistant"; text: string };

export function CopilotAssistantPanel({ assistant }: Props) {
  const opening = useMemo(
    () => generateCopilotOpening(assistant),
    [assistant]
  );
  const suggestedPrompts = useMemo(
    () => buildSuggestedPrompts(assistant),
    [assistant]
  );

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: opening },
  ]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const reply = generateCopilotReply(trimmed, assistant);
      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed },
        { role: "assistant", text: reply },
      ]);
      setInput("");
    },
    [assistant]
  );

  return (
    <aside className="bf-copilot-enter flex h-full min-h-[320px] flex-col rounded-2xl border border-violet-400/15 bg-gradient-to-b from-violet-500/[0.08] to-black/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-200/80">
        Financial Copilot
      </p>
      <p className="mt-1 text-[10px] text-white/40">
        Statement analysis · local intelligence
      </p>

      <MessageList messages={messages} />

      <PromptChips prompts={suggestedPrompts} onSelect={send} />

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
          placeholder="Ask about fees, trends, bills…"
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

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
      {messages.map((m, i) => (
        <div
          key={`${m.role}-${i}`}
          className={[
            "rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
            m.role === "user"
              ? "ml-6 border border-white/10 bg-white/[0.06] text-white/80"
              : "mr-4 border border-violet-400/15 bg-violet-500/[0.08] text-violet-100/90",
          ].join(" ")}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}

function PromptChips({
  prompts,
  onSelect,
}: {
  prompts: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/60 transition hover:border-violet-400/30 hover:text-violet-100"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
