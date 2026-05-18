import type { HouseholdMember } from "../types";

function roleBadgeClasses(role: HouseholdMember["role"]): string {
  const styles: Record<HouseholdMember["role"], string> = {
    owner: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200/95",
    member: "border-sky-400/30 bg-sky-400/10 text-sky-200/90",
    viewer: "border-white/15 bg-white/[0.06] text-white/65",
  };
  return styles[role];
}

export function HouseholdMembersSection({
  members,
}: {
  members: HouseholdMember[];
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Members</h2>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Roles control household management — not access to anyone else’s
            statements or transactions.
          </p>
        </div>
      </div>
      <ul className="mt-6 divide-y divide-white/[0.06]">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-white"
                aria-hidden
              >
                {m.avatarInitial}
              </div>
              <div>
                <p className="font-medium text-white">{m.displayName}</p>
                <p className="text-sm text-white/45">{m.email}</p>
              </div>
            </div>
            <span
              className={`w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${roleBadgeClasses(m.role)}`}
            >
              {m.role}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
