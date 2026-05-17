export default function StatementsPage() {
  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold mb-2">Statements & Subscriptions</h1>
        <p className="text-white/70 mb-8">
          MVP: connect PDF / Excel bank statement uploads and detect
          subscriptions plus duplicate charges.
        </p>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/80 text-sm leading-relaxed">
          Next up: file upload, parsing, and an estimated monthly savings
          dashboard.
        </div>
      </div>
    </main>
  );
}
