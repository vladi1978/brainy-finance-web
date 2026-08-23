"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  description?: string;
};

const PRIMARY: NavItem[] = [
  {
    label: "Compare Stores",
    href: "/compare",
    description: "Amazon · Walmart · Target",
  },
  {
    label: "Shopping assistant",
    href: "/shopping-assistant",
    description: "Ask in plain language",
  },
  {
    label: "Statements & Subscriptions",
    href: "/statements",
    description: "Text-based PDF",
  },
];

function isPrimaryActive(pathname: string, href: string): boolean {
  if (href === "/compare") {
    return pathname === "/compare" || pathname === "/dashboard";
  }
  return pathname === href;
}

function NavButton({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={[
        "group flex w-full flex-col rounded-xl border px-3 py-2.5 text-left transition",
        active
          ? "border-white/15 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
          : "border-transparent bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]",
      ].join(" ")}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">{item.label}</span>
      </span>
      {item.description ? (
        <span className="mt-0.5 text-xs text-white/45 group-hover:text-white/55">
          {item.description}
        </span>
      ) : null}
    </Link>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex min-h-screen w-72 shrink-0 flex-col border-r border-white/[0.08] bg-gradient-to-b from-[#050608] to-[#0a0d12]">
      <div className="flex items-center gap-3 px-5 py-6">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-sm font-bold text-emerald-300 transition hover:border-emerald-400/40"
          aria-label="Brainy home"
        >
          B
        </Link>
        <div>
          <Link href="/" className="block">
            <p className="text-sm font-semibold tracking-tight text-white">
              Brainy
            </p>
          </Link>
          <p className="text-xs text-white/45">Shop smarter. Save more.</p>
        </div>
      </div>

      <nav className="flex-1 space-y-8 overflow-y-auto px-3 pb-8">
        <div>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
            Available now
          </p>
          <div className="space-y-1.5">
            {PRIMARY.map((item) => (
              <NavButton
                key={item.href}
                item={item}
                active={isPrimaryActive(pathname, item.href)}
              />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-white/[0.08] px-5 py-4">
        <p className="text-[11px] leading-relaxed text-white/40">
          Brainy helps you compare prices, shop in plain language, and review
          text-based PDF statements — not banking, investing, or financial advice.
        </p>
      </div>
    </aside>
  );
}
