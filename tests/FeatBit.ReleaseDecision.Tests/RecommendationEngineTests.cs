using Core.Models;
using Core.Services;

namespace FeatBit.ReleaseDecision.Tests;

public sealed class RecommendationEngineTests
{
    private readonly RecommendationEngine engine = new();

    [Fact]
    public void Apply_ReturnsContinue_WhenPrimaryImprovesAndGuardrailsPass()
    {
        var result = CreateResult(relativeDelta: 0.12, guardrailStatus: "pass");

        var evaluated = engine.Apply(result, 10);

        Assert.Equal(RecommendationNames.Continue, evaluated.Recommendation);
        Assert.Equal(25, evaluated.RecommendedNextRolloutPercentage);
    }

    [Fact]
    public void Apply_ReturnsPause_WhenAnyGuardrailFails()
    {
        var result = CreateResult(relativeDelta: 0.12, guardrailStatus: "fail");

        var evaluated = engine.Apply(result, 10);

        Assert.Equal(RecommendationNames.Pause, evaluated.Recommendation);
        Assert.Equal(10, evaluated.RecommendedNextRolloutPercentage);
    }

    [Fact]
    public void Apply_ReturnsRollbackCandidate_WhenPrimaryWorsens()
    {
        var result = CreateResult(relativeDelta: -0.05, guardrailStatus: "pass");

        var evaluated = engine.Apply(result, 10);

        Assert.Equal(RecommendationNames.RollbackCandidate, evaluated.Recommendation);
        Assert.Equal(0, evaluated.RecommendedNextRolloutPercentage);
    }

    private static EvaluationResult CreateResult(double relativeDelta, string guardrailStatus)
    {
        return new EvaluationResult
        {
            DecisionKey = "test_decision",
            PrimaryMetric = new MetricEvaluation
            {
                Name = "task_success_rate",
                BaselineVariant = "a",
                CandidateVariant = "b",
                RelativeDelta = relativeDelta
            },
            Guardrails =
            [
                new GuardrailEvaluation
                {
                    Name = "avg_cost",
                    Status = guardrailStatus
                }
            ]
        };
    }
}