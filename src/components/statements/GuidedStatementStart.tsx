"use client";

import Link from "next/link";
import { useState } from "react";
import {
  GUIDED_PLAYBOOKS,
  getGuidedPlaybook,
  type BrainyGoal,
} from "@/lib/brainy/guidedPlaybooks";

export function GuidedStatementStart() {
  const [goal, setGoal] = useState<BrainyGoal>("save_this_month");
  const selected = getGuidedPlaybook(goal);

  return (
    <section className="mb-8 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.1] to-emerald-500/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-200/80">
        Ask Brainy
      </p>
      <h2 className="mt-2 text-xl font-semibold">What would you like help with?</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {GUIDED_PLAYBOOKS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setGoal(item.id)}
            className={[
              "rounded-full border px-3 py-2 text-xs transition",
              item.id === goal
                ? "border-violet-300/50 bg-violet-400/20 text-violet-50"
                : "border-white/10 bg-black/20 text-white/60 hover:border-white/25 hover:text-white",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
        <p className="text-sm leading-relaxed text-white/75">{selected.response}</p>
        {!selected.available ? (
          <p className="mt-2 text-xs font-medium text-amber-200/80">Planned capability · not active yet</p>
        ) : selected.href ? (
          <Link href={selected.href} className="mt-3 inline-flex rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-black hover:bg-emerald-300">
            {selected.actionLabel}
          </Link>
        ) : (
          <p className="mt-2 text-xs text-emerald-200/70">Next: accept document consent and upload below.</p>
        )}
      </div>
    </section>
  );
}
