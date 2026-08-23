import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Brainy",
  description:
    "Terms of Service for Brainy’s shopping, comparison, and statement-review tools.",
};

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12 text-white">
      <p className="text-xs uppercase tracking-wider text-white/45">
        Brainy · Product terms
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-white/55">
        Last updated: August 23, 2026 · Version 2026-08-23.v1
      </p>
      <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/90">
        These terms describe how Brainy works today. They are a product clarity
        document and have <span className="font-semibold">not</span> been
        reviewed or approved by an attorney. They are not legal advice. If you
        need legal certainty for your situation, consult a qualified attorney.
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">1. What Brainy is</h2>
          <p>
            Brainy is an AI-powered shopping and savings tool. It helps you
            compare product prices, ask for products in plain language, and
            review text-selectable PDF bank statements to understand spending
            patterns such as subscriptions, fees, expected bills, and repeated
            discretionary activity.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            2. What Brainy is not
          </h2>
          <p>
            Brainy is not a bank, accounting service, financial adviser, insurer,
            insurance agent or broker, or legal adviser. Brainy does not sell
            insurance, open accounts, move money, or provide personalized legal
            or investment advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            3. Statement analysis
          </h2>
          <p>
            When you upload a PDF statement, Brainy processes it in memory to
            extract and classify activity for the purpose you authorize on the
            upload screen. Brainy does not require an account today and does not
            operate a database of your statements. Analysis quality depends on
            text-selectable PDFs; scanned image-only PDFs may not work.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            4. Insights and estimates
          </h2>
          <p>
            Classifications, Health Score, insights, and recommendations are
            automated estimates based on the document you provide. They can be
            incomplete or incorrect. They are informational only. Brainy does
            not guarantee savings, approval, availability, or outcomes from any
            third-party offer.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            5. Third-party providers and referrals
          </h2>
          <p>
            Shopping links and any future insurance comparison links lead to
            independent third parties. Those providers set their own prices,
            coverage, eligibility, privacy practices, and terms. If Brainy later
            earns a referral commission, that compensation must not change your
            financial classifications or Health Score. Sponsored placements, when
            present, will be labeled.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">6. Acceptable use</h2>
          <p>
            Upload only documents you own or have permission to analyze. Do not
            use Brainy to harm others, abuse infrastructure, or attempt to
            extract data you are not authorized to access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">7. Changes</h2>
          <p>
            Brainy may update these terms as the product changes. Material
            updates will refresh the version date on this page. Account-based
            acceptance records may be added when authentication ships.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">8. Contact</h2>
          <p>
            Questions about these terms can be directed through the project
            channels you already use with the Brainy team.
          </p>
        </section>
      </div>

      <p className="mt-12 text-sm text-white/50">
        Also see the{" "}
        <Link href="/privacy" className="text-emerald-300 underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
