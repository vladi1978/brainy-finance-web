import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Brainy",
  description:
    "How Brainy handles shopping requests and statement PDF analysis.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12 text-white">
      <p className="text-xs uppercase tracking-wider text-white/45">
        Brainy · Privacy
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-white/55">
        Last updated: August 23, 2026 · Version 2026-08-23.v1
      </p>
      <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/90">
        This policy describes Brainy’s current privacy practices in plain
        language. It has <span className="font-semibold">not</span> been
        reviewed or approved by an attorney and is not legal advice.
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/75">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">1. Overview</h2>
          <p>
            Brainy helps you compare products and review text-based PDF bank
            statements. Brainy currently has no user accounts and no database
            that stores your statements.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            2. What we process
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Shopping and compare requests you submit (product URLs or
              descriptions).
            </li>
            <li>
              PDF statement bytes you upload, processed in memory to return
              analysis results to your browser.
            </li>
            <li>
              Technical request metadata needed to operate the service (for
              example, approximate size limits and error logs without raw
              statement text in production).
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            3. What we do not do today
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>We do not create a lasting server-side archive of your PDF.</li>
            <li>
              We do not sell your statement contents to insurers or advertisers.
            </li>
            <li>
              Optional OpenAI enrichment for statements is disabled unless
              explicitly enabled by the operator; raw PDF bytes are not forwarded
              as a file upload to OpenAI.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            4. Third-party shopping providers
          </h2>
          <p>
            Price comparison uses server-side shopping search credentials. When
            you leave Brainy to a retailer, that retailer’s privacy policy
            applies. Brainy’s retailer redirect validates destinations against an
            allowlist of known store domains.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            5. Future insurance referrals
          </h2>
          <p>
            Brainy may later offer optional links to independent insurance
            comparison partners. When that ships, Brainy will not send your bank
            statement or extracted financial transactions to the partner in the
            referral link. The partner will request whatever information it needs
            directly from you. Affiliate availability will not change your
            statement classifications or Health Score.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">
            6. Browser storage
          </h2>
          <p>
            Some UI preferences (for example, recommendation action status) may
            be stored in your browser’s local storage. Clearing site data removes
            them. That storage does not replace a server privacy record.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">7. Security</h2>
          <p>
            We use HTTPS, request size limits, PDF type checks, and production
            logging that avoids dumping raw statement text. No system is perfect;
            please upload only documents you are comfortable processing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-white">8. Changes</h2>
          <p>
            We will update this page when privacy practices change. Account-based
            consent logs may be added when authentication is introduced.
          </p>
        </section>
      </div>

      <p className="mt-12 text-sm text-white/50">
        Also see the{" "}
        <Link href="/terms" className="text-emerald-300 underline">
          Terms of Service
        </Link>
        .
      </p>
    </main>
  );
}
