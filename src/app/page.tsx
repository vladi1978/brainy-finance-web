import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-black text-white">
      <section className="mx-auto flex max-w-6xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="mb-4 rounded-full border border-white/20 px-4 py-1 text-sm text-white/70">
          AI-Powered Savings Assistant
        </span>

        <h1 className="mb-6 max-w-4xl text-5xl font-bold tracking-tight sm:text-6xl">
          Save more with <span className="text-green-400">BrainyFinance</span>
        </h1>

        <p className="mb-8 max-w-2xl text-lg text-white/70">
          Upload your statements, uncover subscription savings, compare product prices,
          and track better deals — all in one smart savings app.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/compare"
            className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black transition hover:bg-green-400"
          >
            Open comparador
          </Link>

          <Link
            href="/statements"
            className="rounded-xl border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Extractos / suscripciones
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-20 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Find subscriptions</h3>
          <p className="text-white/70">
            Detect recurring charges and see where you could save every month.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Compare products</h3>
          <p className="text-white/70">
            Paste a link, upload a screenshot, or type a product to find better prices.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-2 text-xl font-semibold">Track price drops</h3>
          <p className="text-white/70">
            Save products and get alerted when Brainy finds a lower price.
          </p>
        </div>
      </section>
    </main>
  );
}