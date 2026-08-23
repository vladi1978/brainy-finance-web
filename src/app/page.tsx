import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-black text-white">
      <section className="mx-auto flex max-w-6xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="mb-4 rounded-full border border-white/20 px-4 py-1 text-sm text-white/70">
          Shopping &amp; savings
        </span>

        <h1 className="mb-6 max-w-4xl text-5xl font-bold tracking-tight sm:text-6xl">
          Save more with <span className="text-green-400">Brainy</span>
        </h1>

        <p className="mb-8 max-w-2xl text-lg text-white/70">
          Compare prices across stores, ask for products in plain language, and
          review text-based PDF statements for subscriptions and spending patterns.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
          <Link
            href="/compare"
            className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black transition hover:bg-green-400"
          >
            Open Compare
          </Link>

          <Link
            href="/shopping-assistant"
            className="rounded-xl border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Shopping assistant
          </Link>

          <Link
            href="/statements"
            className="rounded-xl border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Statements
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-20 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Compare stores</h3>
          <p className="text-white/70">
            Paste a product link or describe what you&apos;re shopping for to find
            cheaper matches across retailers.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Shopping assistant</h3>
          <p className="text-white/70">
            Ask in natural language. Brainy ranks compatible options using the
            same comparison engine — no checkout or SMS.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Statement review</h3>
          <p className="text-white/70">
            Upload a text-selectable PDF bank statement to surface subscriptions
            and spending patterns. Scanned image-only PDFs are not supported.
          </p>
        </div>
      </section>
    </main>
  );
}
