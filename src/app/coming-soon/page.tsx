import Link from "next/link";

const TITLES: Record<string, string> = {
  "price-match": "Returns & price-match tracker",
  insurance: "Auto & home insurance optimizer",
  utilities: "Household bills analyzer (electricity, gas, internet)",
};

type ComingSoonPageProps = {
  searchParams: Promise<{ p?: string }>;
};

export default async function ComingSoonPage({
  searchParams,
}: ComingSoonPageProps) {
  const params = await searchParams;
  const key = params.p ?? "";
  const title = key && TITLES[key] ? TITLES[key] : "Coming Soon";

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-[#050608] px-6 py-16 text-center">
      <span className="mb-4 rounded-full border border-white/10 px-3 py-1 text-xs text-white/50">
        BrainyFinance
      </span>
      <h1 className="max-w-lg text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-3 max-w-md text-sm text-white/55">
        We&apos;re finishing this module. Navigation is already wired so the
        layout stays consistent when we ship new features.
      </p>
      <Link
        href="/compare"
        className="mt-8 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.1]"
      >
        Back to Compare
      </Link>
    </main>
  );
}
