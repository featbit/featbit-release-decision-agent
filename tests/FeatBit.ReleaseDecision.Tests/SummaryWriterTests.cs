using Core.Models;
using Core.Services;

namespace FeatBit.ReleaseDecision.Tests;

public sealed class SummaryWriterTests
{
    private readonly SummaryWriter summaryWriter = new();

    [Fact]
    public void Create_IncludesRecommendationAndGuardrails()
    {
        var summary = summaryWriter.Create(new EvaluationResult
        {
            DecisionKey = "homepage_message_test",
            Recommendation = RecommendationNames.Continue,
            RecommendedNextRolloutPercentage = 25,
            PrimaryMetric = new MetricEvaluation
            {
                Name = "task_success_rate",
                BaselineVariant = "homepage_current",
                CandidateVariant = "homepage_candidate",
                RelativeDelta = 0.091
            },
            Guardrails =
            [
                new GuardrailEvaluation { Name = "avg_cost", Status = "pass", RelativeDelta = 0.02 },
                new GuardrailEvaluation { Name = "p95_latency_ms", Status = "pass", RelativeDelta = -0.01 }
            ]
        });

        Assert.Contains("# Release Decision Summary", summary, StringComparison.Ordinal);
        Assert.Contains("Continue rollout to **25%**.", summary, StringComparison.Ordinal);
        Assert.Contains("avg_cost: pass", summary, StringComparison.Ordinal);
    }
}