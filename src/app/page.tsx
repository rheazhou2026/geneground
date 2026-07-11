import Link from "next/link";
import { FinalVerdictBadge } from "@/components/FinalVerdictBadge";

// TODO: point at the real GeneGround repository once it's public.
const GITHUB_URL = "#";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
];

const HOW_IT_WORKS_STEPS = [
  {
    n: "01",
    title: "Paste the interpretation",
    body: "Drop in the AI-generated write-up of your Perturb-seq or scRNA-seq result — no formatting required.",
  },
  {
    n: "02",
    title: "Attach a Claude Science handoff",
    body: "Add the evidence bundle it was written from — differential expression tables, enrichment packets, robustness summaries. A demo handoff is used if you skip this.",
  },
  {
    n: "03",
    title: "Review grounded claims",
    body: "Each claim gets a verdict, the supporting and unsupported parts, and a safer, dataset-grounded rewrite where the wording overreaches.",
  },
];

const TRUST_POINTS = [
  {
    title: "Claim-level extraction",
    body: "The interpretation is split into individual, checkable claims — not graded as one paragraph.",
  },
  {
    title: "Mini ontology normalization",
    body: "Genes, pathways, and conditions are resolved against a curated HGNC/Reactome/Cell Ontology subset before anything is matched.",
  },
  {
    title: "Evidence chunk retrieval",
    body: "Each claim's normalized gene is a hard requirement for biological evidence — condition and pathway match only narrow it further.",
  },
  {
    title: "Four specialist agents",
    body: "Perturbation evidence, pathway signature, robustness quality, and language causality are evaluated independently per claim.",
  },
  {
    title: "Deterministic final verdict aggregation",
    body: "The verdict is computed by fixed rules from the four agent outputs — never assigned freehand by a model.",
  },
];

const PREVIEW_ORIGINAL_CLAIM =
  "STAT1 knockdown suppresses interferon signaling in stimulated CD4+ T cells, suggesting STAT1 acts as a key regulator of inflammatory activation.";
const PREVIEW_SAFER_REWRITE =
  "STAT1 knockdown is associated with decreased interferon signaling in stimulated CD4+ T cells, consistent with a role in inflammatory activation — this transcriptomic association does not establish STAT1 as a regulator.";
const PREVIEW_EVIDENCE_CHIPS = [
  { id: "STAT1_Stim8hr_DE_001", index: "Perturbation" },
  { id: "STAT1_Stim8hr_PATHWAY_002", index: "Pathway" },
  { id: "STAT1_Stim8hr_ROBUST_001", index: "Robustness" },
  { id: "LANG_RULE_KEY_REGULATOR", index: "Language" },
];

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-full bg-white dark:bg-black">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur-sm dark:border-zinc-900 dark:bg-black/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">GeneGround</span>
          </div>
          <nav className="flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden text-sm text-zinc-500 transition-colors hover:text-zinc-900 sm:inline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {link.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              className="hidden items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 sm:inline-flex dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <GitHubIcon className="h-4 w-4" />
              GitHub
            </a>
            <Link
              href="/demo"
              className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Try demo
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pb-24 sm:pt-28">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Claim-level verification · MVP
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            Claim-level grounding for AI-generated omics interpretations.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-500 dark:text-zinc-400">
            GeneGround checks whether biological claims are supported by Claude Science evidence, flags overstated
            language, and rewrites interpretations with dataset-grounded caveats.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/demo"
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Try the demo →
            </Link>
            <a
              href={GITHUB_URL}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
            >
              <GitHubIcon className="h-4 w-4" />
              View GitHub
            </a>
          </div>
        </section>

        {/* Product preview card */}
        <section id="product" className="mx-auto max-w-5xl scroll-mt-20 px-6 pb-20">
          <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Example output
              </span>
              <FinalVerdictBadge verdict="overstated" size="sm" />
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  Original claim
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{PREVIEW_ORIGINAL_CLAIM}</p>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  Safer rewrite
                </p>
                <p className="mt-1 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {PREVIEW_SAFER_REWRITE}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  Evidence trace
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PREVIEW_EVIDENCE_CHIPS.map((chip) => (
                    <span
                      key={chip.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                    >
                      <span className="text-zinc-400 dark:text-zinc-600">{chip.index}</span>
                      <span className="text-zinc-300 dark:text-zinc-700">·</span>
                      {chip.id}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-900 dark:bg-zinc-950/50">
          <div className="mx-auto max-w-5xl scroll-mt-20 px-6 py-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">How it works</h2>
            <div className="mt-8 grid gap-8 sm:grid-cols-3">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <div key={step.n}>
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">{step.n}</span>
                  <h3 className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust / technical section */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Not a chatbot. An audit report.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-500 dark:text-zinc-400">
              GeneGround doesn&apos;t generate a new interpretation — it grades the one you already have, through a
              fixed pipeline rather than a single model call.
            </p>
          </div>
          <div className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {TRUST_POINTS.map((point) => (
              <div key={point.title} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{point.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{point.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-900">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-3 px-6 py-8 sm:flex-row sm:items-center">
          <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">
            GeneGround — evidence-grounded claim verification
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600">
            Local mock evidence corpus by default; the demo also accepts a real Claude Science handoff.
          </span>
        </div>
      </footer>
    </div>
  );
}
