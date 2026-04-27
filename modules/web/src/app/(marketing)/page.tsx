import Link from "next/link";
import {
  Bot,
  Sparkles,
  Play,
  Workflow,
  Brain,
  GitBranch,
  ShieldCheck,
  Target,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Activity,
  ImageIcon,
} from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Bayesian A/B analysis",
    description:
      "Real-time probability estimates and expected loss calculations — not just p-values. Know when you have enough evidence to act.",
  },
  {
    icon: Bot,
    title: "AI-powered decisions",
    description:
      "The agent surfaces key metrics, flags statistical concerns, and guides your team through the hypothesis → evidence → decision cycle.",
  },
  {
    icon: GitBranch,
    title: "Feature flag native",
    description:
      "Pairs natively with FeatBit feature flags — traffic assignment, targeting, and holdouts ride alongside the experiment, not on a parallel track.",
  },
  {
    icon: FlaskConical,
    title: "Decision audit trail",
    description:
      "Every release decision is documented — evidence reviewed, confidence level, rationale. The record lives with the experiment, not in Slack.",
  },
  {
    icon: Activity,
    title: "Multi-stage experiments",
    description:
      "Design, exposure, analysis, and decision — each stage has its own state, blocking criteria, and completion checklist.",
  },
];

const steps = [
  {
    number: "01",
    title: "Define a hypothesis",
    description:
      "State what you expect to change and how you'll measure it. The agent enforces this before you can add traffic.",
  },
  {
    number: "02",
    title: "Expose users",
    description:
      "Assign traffic — through FeatBit feature flags or any gating mechanism you already use. Control split, targeting, and holdouts.",
  },
  {
    number: "03",
    title: "Analyze evidence",
    description:
      "Bayesian analysis runs continuously. Review probability estimates, credible intervals, and guardrail metrics in real time.",
  },
  {
    number: "04",
    title: "Record the decision",
    description:
      "Ship, rollback, or iterate — with a documented rationale. The decision record stays with the experiment forever.",
  },
];

const loopStages = [
  { label: "Intent", short: "What outcome?" },
  { label: "Hypothesis", short: "Falsifiable claim" },
  { label: "Implementation", short: "Reversible change" },
  { label: "Exposure", short: "Who sees it" },
  { label: "Measurement", short: "Primary metric" },
  { label: "Interpretation", short: "Evidence framing" },
  { label: "Decision", short: "Continue / pause / rollback" },
  { label: "Learning", short: "Feed next cycle" },
];

const lenses = [
  { id: "CF-01", title: "Intent Clarification", body: "Separate goal from solution before tactics." },
  { id: "CF-02", title: "Hypothesis Discipline", body: "Convert intent into a falsifiable claim." },
  { id: "CF-03", title: "Reversible Change Control", body: "Make change reversible before visible." },
  { id: "CF-04", title: "Exposure Strategy", body: "Decide who sees it — not as a deploy side-effect." },
  { id: "CF-05", title: "Measurement Discipline", body: "One primary metric, a few guardrails." },
  { id: "CF-06", title: "Evidence Sufficiency", body: "Don't let urgency pretend to be evidence." },
  { id: "CF-07", title: "Decision Framing", body: "Action categories — not ritualized significance." },
  { id: "CF-08", title: "Learning Closure", body: "Every cycle produces a reusable learning." },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        {/* subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {/* brand gradient blob */}
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-brand opacity-[0.08] blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-brand opacity-[0.06] blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28 lg:py-32">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
              <Sparkles className="h-3.5 w-3.5" />
              FeatBit Experimentation · AI-powered A/B testing
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl leading-[1.1]">
              Release with evidence,{" "}
              <span className="text-brand">not instinct</span>
            </h1>

            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
              FeatBit Experimentation is an A/B testing platform with an
              AI agent baked in. Bayesian statistics, hypothesis discipline, and
              evidence-based decisions — the best practices, packaged so any team
              can run rigorous experiments without a statistician.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/experiments/new"
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground hover:opacity-90 transition-opacity shadow-sm"
              >
                Start an experiment
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/featbit/featbit"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Hero video placeholder */}
      <section className="relative border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 -mt-10 md:-mt-16 pb-16 md:pb-20">
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="relative aspect-video w-full bg-gradient-to-br from-brand-muted via-background to-brand-muted/40">
              {/* placeholder scaffolding */}
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, transparent 49%, color-mix(in srgb, var(--brand) 14%, transparent) 49%, color-mix(in srgb, var(--brand) 14%, transparent) 51%, transparent 51%)",
                  backgroundSize: "14px 14px",
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg shadow-brand/30">
                  <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">
                    See FeatBit Experimentation in action
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Product walk-through · video placeholder
                  </p>
                </div>
              </div>
              {/* corner badge */}
              <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                placeholder
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI Agent spotlight */}
      <section className="relative border-b border-border/60 bg-muted/20">
        <div className="absolute -top-24 right-1/4 h-64 w-64 rounded-full bg-brand opacity-[0.05] blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-start">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
                <Bot className="h-3.5 w-3.5" />
                Release Decision Agent
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl leading-tight">
                An AI agent that{" "}
                <span className="text-brand">runs the loop</span>{" "}
                with you
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                The agent isn't a workflow generator — it's a control framework.
                It decides what kind of decision you're really facing and which
                lens to apply: shaping intent, sharpening a hypothesis, choosing
                an exposure strategy, judging whether evidence is sufficient,
                framing the decision, and closing the cycle with a learning.
              </p>

              {/* Loop pills */}
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Workflow className="h-3.5 w-3.5" />
                  The core loop
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {loopStages.map((s, i) => (
                    <span
                      key={s.label}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs"
                    >
                      <span className="text-brand font-mono text-[10px] tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-medium text-foreground">{s.label}</span>
                      <span className="text-muted-foreground hidden md:inline">
                        · {s.short}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/experiments/new"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90 transition-opacity shadow-sm"
                >
                  Try the agent
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="https://github.com/featbit/featbit-release-decision-agent/tree/main/skills/featbit-release-decision"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  Read the skill spec
                </a>
              </div>
            </div>

            {/* Right column — agent UI image placeholder + lenses preview */}
            <div className="space-y-5">
              <div className="surface-panel rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 bg-background/60">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-chart-4/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-brand/70" />
                  <span className="ml-2 text-[11px] font-mono text-muted-foreground">
                    /featbit-release-decision
                  </span>
                </div>
                <div className="relative aspect-[4/3] bg-gradient-to-br from-brand-muted/60 via-background to-background">
                  <div
                    className="absolute inset-0 opacity-50"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px)",
                      backgroundSize: "20px 20px",
                    }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background border border-border/60 shadow-sm">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Agent chat & analysis screenshot · placeholder
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {lenses.slice(0, 4).map((lens) => (
                  <div
                    key={lens.id}
                    className="rounded-lg border border-border/60 bg-background p-3"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] font-semibold text-brand">
                        {lens.id}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {lens.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {lens.body}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground text-center">
                4 of 8 control lenses · the agent picks the right one for your stage
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Best practices baked in */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Best practices, packaged
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Rigorous experimentation, without the PhD
            </h2>
            <p className="mt-4 text-muted-foreground">
              The algorithms and discipline that top experimentation teams rely
              on — built into the agent so any team can run controlled
              experiments on equal footing.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="surface-panel rounded-xl p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <Brain className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Bayesian inference
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Posterior probabilities, credible intervals, and expected loss —
                the framing reviewers actually use to decide. No p-value rituals.
              </p>
            </div>
            <div className="surface-panel rounded-xl p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <Target className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Hypothesis discipline
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                One primary metric, a few guardrails, a falsifiable claim. The
                agent enforces shape before you can add traffic — so analysis
                doesn't become storytelling.
              </p>
            </div>
            <div className="surface-panel rounded-xl p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Evidence sufficiency
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The agent decides whether to call it now, wait, widen the
                window, or revisit instrumentation. Urgency doesn't get to
                pretend to be evidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Standalone or with feature flags */}
      <section className="border-t border-border/60 bg-muted/20 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Better with FeatBit flags. Useful without them.
            </h2>
            <p className="mt-4 text-muted-foreground">
              The platform stands on its own as an A/B testing system. Pair it
              with FeatBit feature flags and the loop closes — exposure,
              measurement, and decision share the same source of truth.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="surface-panel rounded-xl p-7">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-brand/30 bg-brand-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand">
                Recommended
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-brand-foreground">
                  <GitBranch className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-foreground text-lg">
                  With FeatBit feature flags
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Native integration. Variants, traffic split, targeting rules,
                and holdout groups are read from your live flags. The agent
                checks for cross-experiment conflicts before you start a run.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Reversible exposure control out of the box
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Pre-start conflict detection across experiments
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Decisions ship as flag changes — not as a separate ritual
                  </span>
                </li>
              </ul>
            </div>

            <div className="surface-panel rounded-xl p-7">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-border/70 bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Standalone
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                  <FlaskConical className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-foreground text-lg">
                  Without feature flags
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Already split traffic somewhere else? Paste observed data, or
                connect a database. The agent still shapes the hypothesis,
                analyzes evidence, and frames the decision.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Expert-mode wizard accepts pasted observed data
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Bring your own gating, targeting, or rollout system
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                  <span className="text-foreground/90">
                    Bayesian analysis & decision audit still apply
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              From hypothesis to decision in four stages
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Each stage is explicit, tracked, and documented. No more ambiguous
              &ldquo;we tested it&rdquo; — just clear evidence trails.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div key={step.number} className="relative">
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-3xl font-bold text-brand/20 tabular-nums leading-none">
                    {step.number}
                  </span>
                  <div className="h-px flex-1 bg-brand/20" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="border-t border-border/60 bg-muted/20 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Everything your team needs
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Built for engineering and product teams that want to ship with confidence.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="group rounded-xl border border-border/60 bg-background p-6 hover:border-brand/40 hover:shadow-sm transition-all"
                >
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted text-brand group-hover:bg-brand group-hover:text-brand-foreground transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-brand py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-brand-foreground sm:text-4xl">
            Stop guessing. Start deciding.
          </h2>
          <p className="mt-4 text-brand-foreground/80 max-w-xl mx-auto">
            Set up your first experiment in minutes. Your data stays with you.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/experiments/new"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-foreground px-6 py-3 text-sm font-semibold text-brand hover:opacity-90 transition-opacity shadow-sm"
            >
              Create your first experiment
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://docs.featbit.co"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-brand-foreground/30 px-6 py-3 text-sm font-semibold text-brand-foreground hover:bg-brand-foreground/10 transition-colors"
            >
              Read the docs
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
