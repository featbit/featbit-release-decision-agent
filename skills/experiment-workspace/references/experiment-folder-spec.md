# Experiment Data Spec

Every experiment is a row in the `Experiment` table (Prisma schema), accessed via HTTP API.
The database is the experiment. No local experiment files needed.

---

## Database Schema (Experiment model)

| Field | Type | Purpose |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `slug` | String | Experiment identifier (kebab-case), unique within a project |
| `hypothesis` | String? | The causal claim being tested |
| `primaryMetricEvent` | String? | Event name for the primary metric |
| `guardrailEvents` | String? | JSON array string of guardrail event names |
| `controlVariant` | String? | Control variant value (e.g. "false", "baseline") |
| `treatmentVariant` | String? | Treatment variant value (e.g. "true", "candidate") |
| `minimumSample` | Int? | Validity floor per variant (see SKILL.md for computation) |
| `observationStart` | String? | ISO 8601 date when the flag was enabled |
| `observationEnd` | String? | ISO 8601 date when observation ended (null if still running) |
| `priorProper` | Boolean (false) | Whether an informative prior is used |
| `priorMean` | Float? | Expected relative lift (0 = no expected direction) |
| `priorStddev` | Float? | Uncertainty around prior mean (0.3 = ±30% plausible range) |
| `inputData` | String? | Collected metric data (JSON string — see format below) |
| `analysisResult` | String? | Computed analysis output (JSON string — see format below) |
| `status` | String ("draft") | `draft` / `collecting` / `analyzing` / `decided` |
| `decision` | String? | Final decision category |
| `decisionSummary` | String? | Plain-language action recommendation for non-technical readers |
| `decisionReason` | String? | Technical rationale with data points |
| `createdAt` | DateTime | Auto-generated |
| `updatedAt` | DateTime | Auto-updated |

Rules for experiment fields:
- `slug` must be unique within the project — typically derived from the flag key (e.g. `chat-cta-v2`)
- `primaryMetricEvent` must exactly match the event name tracked via FeatBit SDK's `track()` call
- `observationStart` is the date from which logs are included — do not backfill before the flag was enabled
- `minimumSample` is a sanity floor, not a stopping rule
- `priorProper: false` (default) = flat prior; `priorProper: true` = informative Gaussian prior
- Do not change `primaryMetricEvent`, `controlVariant`, or `treatmentVariant` after data collection starts

---

## `inputData` Format

Holds aggregated exposure and conversion counts for every metric and variant. Written by `collect-input.ts` or manually populated.

```json
{
  "metrics": {
    "cta_clicked": {
      "false": {"n": 487, "k": 41},
      "true":  {"n": 513, "k": 67}
    },
    "chat_opened": {
      "false": {"n": 487, "k": 38},
      "true":  {"n": 513, "k": 41}
    }
  }
}
```

Rules:
- Outer keys are event names — must match `primaryMetricEvent` and `guardrailEvents` in the experiment record
- Inner keys are variant values — must match `controlVariant` and `treatmentVariant` in the experiment record
- `n` = unique users exposed to that variant in the observation window
- `k` = unique users who fired the event at least once, out of those `n`
- Source: see `references/data-source-guide.md` for §FeatBit / §Database / §Custom patterns

---

## `analysisResult` Format

Written by the analysis script (`analyze-bayesian.py` or `analyze-bandit.py`) after computation. Example output:

```json
{
  "type": "bayesian",
  "experiment": "chat-cta-v2",
  "computed_at": "2026-03-15T09:00:00Z",
  "window": { "start": "2026-03-01", "end": "2026-03-15" },
  "control": "false",
  "treatments": ["true"],
  "prior": "flat/improper (data-only)",
  "srm": {
    "chi2_p_value": 0.4821,
    "ok": true,
    "observed": { "false": 487, "true": 513 }
  },
  "primary_metric": {
    "event": "cta_clicked",
    "metric_type": "proportion",
    "rows": [
      { "variant": "false", "n": 487, "conversions": 41, "rate": 0.0842, "is_control": true },
      { "variant": "true", "n": 513, "conversions": 67, "rate": 0.1306, "rel_delta": 0.5512, "ci_lower": 0.2845, "ci_upper": 0.8179, "p_win": 0.973, "risk_ctrl": 0.0412, "risk_trt": 0.0012, "is_control": false }
    ],
    "verdict": "strong signal → adopt treatment"
  },
  "guardrails": [
    {
      "event": "chat_opened",
      "metric_type": "proportion",
      "rows": [
        { "variant": "false", "n": 487, "conversions": 38, "rate": 0.078, "is_control": true },
        { "variant": "true", "n": 513, "conversions": 41, "rate": 0.0799, "rel_delta": 0.0244, "ci_lower": -0.0981, "ci_upper": 0.1469, "p_harm": 0.459, "risk_ctrl": 0.0089, "risk_trt": 0.0084, "is_control": false }
      ],
      "verdict": "guardrail healthy"
    }
  ],
  "sample_check": {
    "minimum_per_variant": 487,
    "ok": true,
    "variants": { "false": 487, "true": 513 }
  }
}
```

Do not edit `analysisResult` by hand. Re-run the analysis script if data changes.

---

## Naming the Experiment Slug

Use `<flag-key>-<short-description>`, e.g.:
- `chat-cta-v2`
- `homepage-h1-ai-risk`
- `hero-deploy-buttons`

Kebab-case only. Matches the flag key prefix where possible.
