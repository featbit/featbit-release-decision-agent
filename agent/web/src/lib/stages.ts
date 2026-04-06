export const STAGES = [
  {
    key: "intent",
    label: "Intent",
    cf: "CF-01",
    skill: "intent-shaping",
    description: "Define the business goal and measurable outcome",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  {
    key: "hypothesis",
    label: "Hypothesis",
    cf: "CF-02",
    skill: "hypothesis-design",
    description: "Form a falsifiable causal claim",
    color:
      "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  },
  {
    key: "implementing",
    label: "Implementing",
    cf: "CF-03/04",
    skill: "reversible-exposure-control",
    description: "Feature flag + rollout strategy",
    color:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  {
    key: "exposing",
    label: "Exposing",
    cf: "CF-03/04",
    skill: "reversible-exposure-control",
    description: "Controlled traffic exposure",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    key: "measuring",
    label: "Measuring",
    cf: "CF-05",
    skill: "measurement-design / experiment-workspace",
    description: "Define metrics & collect data",
    color:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  },
  {
    key: "deciding",
    label: "Deciding",
    cf: "CF-06/07",
    skill: "evidence-analysis",
    description: "Evaluate evidence and frame decision",
    color:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  {
    key: "learning",
    label: "Learning",
    cf: "CF-08",
    skill: "learning-capture",
    description: "Capture learnings for next cycle",
    color:
      "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function getStage(key: string) {
  return STAGES.find((s) => s.key === key) ?? STAGES[0];
}
