"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  description?: string;
  soon?: boolean;
  soonKey?: string;
};

const PRIMARY: NavItem[] = [
  {
    label: "Comparar tiendas",
    href: "/compare",
    description: "Amazon · Walmart · Target",
  },
  {
    label: "Extractos y suscripciones",
    href: "/statements",
    description: "PDF / Excel",
  },
  {
    label: "Planes familiares",
    href: "/family-sharing",
    description: "Compartir con confianza",
  },
];

const FUTURE: NavItem[] = [
  {
    label: "Price match",
    href: "/coming-soon?p=price-match",
    soon: true,
    soonKey: "price-match",
  },
  {
    label: "Seguros auto / hogar",
    href: "/coming-soon?p=insurance",
    soon: true,
    soonKey: "insurance",
  },
  {
    label: "Facturas del hogar",
    href: "/coming-soon?p=utilities",
    soon: true,
    soonKey: "utilities",
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
        item.soon ? "opacity-90" : "",
      ].join(" ")}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">{item.label}</span>
        {item.soon && (
          <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/95">
            Próximamente
          </span>
        )}
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
  const searchParams = useSearchParams();

  return (
    <aside className="sticky top-0 flex min-h-screen w-72 shrink-0 flex-col border-r border-white/[0.08] bg-gradient-to-b from-[#050608] to-[#0a0d12]">
      <div className="flex items-center gap-3 px-5 py-6">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-sm font-bold text-emerald-300 transition hover:border-emerald-400/40"
          aria-label="BrainyFinance inicio"
        >
          B
        </Link>
        <div>
          <Link href="/" className="block">
            <p className="text-sm font-semibold tracking-tight text-white">
              BrainyFinance
            </p>
          </Link>
          <p className="text-xs text-white/45">MVP · ahorro inteligente</p>
        </div>
      </div>

      <nav className="flex-1 space-y-8 overflow-y-auto px-3 pb-8">
        <div>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
            Producto activo
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

        <div>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
            Roadmap
          </p>
          <div className="space-y-1.5">
            {FUTURE.map((item) => (
              <NavButton
                key={item.href}
                item={item}
                active={
                  pathname === "/coming-soon" &&
                  searchParams.get("p") === item.soonKey
                }
              />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-white/[0.08] px-5 py-4">
        <p className="text-[11px] leading-relaxed text-white/40">
          Los módulos en roadmap abren una vista temporal para que el layout no
          cambie cuando habilitemos cada pilar.
        </p>
      </div>
    </aside>
  );
}
