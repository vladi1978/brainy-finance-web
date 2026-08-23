import Link from "next/link";

const plans = [
  {
    name: "Free",
    price: "$0",
    description: "Try Brainy's core shopping and statement tools.",
    features: ["Compare stores", "Shopping Assistant", "Text-PDF statement analysis", "Evidence-based insights"],
  },
  {
    name: "Brainy Plus",
    price: "$7.99/mo",
    annual: "$59/year",
    description: "A founding-plan preview for guided decisions and ongoing savings habits.",
    features: ["Guided Financial Copilot", "Savings Ledger", "Monthly financial checkups", "Bill comparison and reminders when accounts are available"],
  },
];

export default function PricingPage() {
  return (
    <main className="flex-1 bg-black px-6 py-16 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">Plans</p>
        <h1 className="mt-3 text-4xl font-bold">Keep your lifestyle. Spend smarter.</h1>
        <p className="mt-4 max-w-2xl text-white/65">
          Brainy helps you find better prices and understand opportunities in your own spending. You make every decision.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {plans.map((plan) => (
            <section key={plan.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-2xl font-semibold">{plan.name}</h2>
              <p className="mt-3 text-3xl font-bold text-emerald-300">{plan.price}</p>
              {plan.annual ? <p className="mt-1 text-sm text-white/55">or {plan.annual}</p> : null}
              <p className="mt-4 text-sm text-white/65">{plan.description}</p>
              <ul className="mt-5 space-y-2 text-sm text-white/75">
                {plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100/80">
          Pricing preview only. Billing, accounts, persistent reminders, and paid-plan activation are not active yet. No payment can be submitted on this page.
        </div>
        <Link href="/statements" className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-black hover:bg-emerald-300">Try Brainy</Link>
      </div>
    </main>
  );
}
