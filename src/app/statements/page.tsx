export default function StatementsPage() {
  return (
    <main className="flex-1 bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold mb-2">Extractos y suscripciones</h1>
        <p className="text-white/70 mb-8">
          MVP: aquí conectarás la carga de PDF / Excel de extractos bancarios y
          el detector de suscripciones y cargos duplicados.
        </p>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/80 text-sm leading-relaxed">
          Próximos pasos: subida de archivo, parsing y panel de ahorro mensual
          estimado.
        </div>
      </div>
    </main>
  );
}
