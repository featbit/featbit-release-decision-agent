export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  authorRole: string;
  category: string;
  readingTime: string;
  content: string;
}

const posts: BlogPost[] = [
  {
    slug: "why-feature-flags-need-experiments",
    title: "Why Feature Flags Need Experiments — Not Just Rollouts",
    description:
      "Shipping code behind a flag is safe. But shipping code that actually works for users requires measurement. Here's how FeatBit closes that loop.",
    date: "2026-04-01",
    author: "FeatBit Team",
    authorRole: "Product",
    category: "Product",
    readingTime: "5 min read",
    content: `
Feature flags let you separate deployment from release. You merge, ship to production, and keep the feature dark until you're ready.

But *ready* is the word that slips through the cracks. Ready for the infra team? Ready for QA? Or ready for *users* — meaning it actually improves the metric you care about?

## The gap between safe and effective

A flag protects production stability. It does not protect you from shipping something users don't want. You can roll out a new checkout flow behind a flag, verify it's stable, flip it on for 100% of users — and only later realize conversion dropped 3%.

Experiments close that gap. Instead of using a flag as a kill switch, you treat the flag as an assignment mechanism: group A sees the current behavior, group B sees the new behavior, and you measure the difference.

## From rollout to release decision

FeatBit's Release Decision Agent treats every flag-backed change as a question waiting for evidence:

1. **Hypothesis** — what outcome are you expecting, and how will you measure it?
2. **Exposure** — who sees the change, and at what traffic split?
3. **Evidence** — is the data showing the effect is real, not noise?
4. **Decision** — ship, rollback, or iterate?

The agent tracks each of these stages, surfaces statistical summaries from your experiment runs, and helps you document the rationale behind the decision — not just the outcome.

## Why this matters for teams

Post-mortems often reveal that teams *had* the data, they just didn't look at it before shipping. By making the decision workflow explicit, FeatBit creates a forcing function: you cannot mark a release as "shipped" without either recording the evidence that justified it or explicitly acknowledging you're skipping the measurement step.

That explicit skip is itself signal — it tells you where your team's risk tolerance lives, and where it costs you later.
`,
  },
  {
    slug: "bayesian-vs-frequentist-ab-testing",
    title: "Bayesian vs Frequentist A/B Testing: A Practical Guide for Engineering Teams",
    description:
      "p-values and confidence intervals are standard, but they answer the wrong question. Here's why FeatBit uses Bayesian analysis — and when it matters.",
    date: "2026-03-18",
    author: "FeatBit Team",
    authorRole: "Engineering",
    category: "Engineering",
    readingTime: "8 min read",
    content: `
Most A/B testing frameworks ship with frequentist statistics. You set a significance level (usually 0.05), run the test until you hit that threshold, and then make a call. It's familiar, it's standard, and it has a subtle problem: it answers the question *"is there an effect?"* rather than *"what is the effect, and how certain am I?"*

## What frequentist testing tells you

A p-value of 0.03 means: *if there were no true effect, observing data this extreme would happen 3% of the time.* It says nothing about the probability that your hypothesis is correct. It says nothing about the magnitude of the effect. And it's vulnerable to peeking — checking results before the experiment ends inflates false positive rates.

## What Bayesian analysis tells you

A Bayesian credible interval gives you a direct probability statement: *there is a 95% chance the true conversion lift is between 1.2% and 4.7%.* You can also compute: *what is the probability that variant B is better than control?* — a question engineering teams actually care about.

FeatBit's Release Decision Agent uses Bayesian beta-binomial models for conversion metrics. At each point in the experiment, you get:

- **Probability to be best**: the chance each variant leads
- **Expected loss**: how much you expect to lose by picking the wrong variant
- **Credible interval**: the range the true effect is likely to fall in

## The practical difference

Frequentist testing requires you to set sample size in advance and not peek. Bayesian analysis lets you monitor continuously — the posterior updates as data arrives, and you can stop when the expected loss drops below your threshold. For engineering teams shipping features on short cycles, this is the more useful property.

## When it doesn't matter

If your traffic is high (millions of daily users) and your effect sizes are large (>5%), both approaches converge quickly and the difference is academic. The gap shows up at lower traffic or smaller effects — exactly where most B2B SaaS teams live.

FeatBit exposes both the Bayesian summary and the raw sample counts so you can apply your own judgment when the model's assumptions don't fit your situation.
`,
  },
  {
    slug: "release-decision-framework",
    title: "The Release Decision Framework: Turning Experiment Data into Action",
    description:
      "Data doesn't make decisions — people do. A framework for moving from experiment results to confident release calls.",
    date: "2026-03-05",
    author: "FeatBit Team",
    authorRole: "Product",
    category: "Product",
    readingTime: "6 min read",
    content: `
Experiment data is only useful when it changes behavior. In practice, many teams collect data, review it briefly, and ship based on gut feel anyway — making the experiment theater rather than infrastructure.

FeatBit's Release Decision Agent is designed to prevent that. Here's the framework it enforces.

## Four stages, four questions

**1. Design** — *What are we testing, and what does success look like?*

Before writing a line of code, the agent asks you to define: the hypothesis, the primary metric, the minimum detectable effect, and the guardrails (metrics that shouldn't get worse). This is harder than it sounds. Most teams can describe what they're building; fewer can articulate in advance what evidence would make them not ship it.

**2. Expose** — *Who sees the change?*

Traffic allocation, targeting rules, holdout groups. The agent tracks these as experiment configuration, not just feature flag settings — so you have a record of *who* was exposed when, not just *whether* the flag was on.

**3. Analyze** — *What does the data show?*

The agent runs Bayesian analysis on collected metrics, surfaces the probability each variant leads, and flags potential issues: insufficient sample size, traffic imbalance, instrumentation gaps.

**4. Decide** — *Ship, rollback, or iterate?*

The final stage is a decision record. It captures: the evidence reviewed, the confidence level, the decision made, and the rationale. This record lives alongside the experiment, not in someone's head or a Slack thread that disappears.

## Why documentation matters

Decision documentation is not bureaucracy — it's the feedback loop that makes the next decision faster. When you can look back and see "we shipped this with 82% probability to be best and conversion lifted 2.1%", you learn what *good enough* looks like for your team and your metric. When you can see "we shipped this with 55% probability and it turned out to be flat", you learn where your intuition overrode the data.

Neither outcome is failure. Both are information.

## The agent's role

The Release Decision Agent doesn't make decisions. It makes the decision process legible — surfaces the right questions at the right time, keeps the evidence organized, and leaves a record that outlasts the sprint.
`,
  },
];

export function getAllPosts(): BlogPost[] {
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
