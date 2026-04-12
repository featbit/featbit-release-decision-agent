using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace FRD.DataServer.Services;

/// <summary>
/// Calls <c>analyze-bayesian.py --pipe</c> via stdin/stdout JSON pipe.
///
/// stdin  → JSON payload with MetricSummary + experiment config
/// stdout ← JSON analysis result
/// </summary>
public sealed class PythonAnalyzer
{
    private readonly ExperimentWorkerOptions _opts;
    private readonly ILogger<PythonAnalyzer> _logger;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public PythonAnalyzer(IOptions<ExperimentWorkerOptions> opts, ILogger<PythonAnalyzer> logger)
    {
        _opts = opts.Value;
        _logger = logger;
    }

    public async Task<JsonElement?> AnalyzeAsync(PythonAnalysisInput input, CancellationToken ct)
    {
        var inputJson = JsonSerializer.Serialize(input, JsonOpts);

        var scriptPath = _opts.PythonScriptPath;

        var psi = new ProcessStartInfo
        {
            FileName = _opts.PythonPath,
            Arguments = $"\"{scriptPath}\" --pipe",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        using var process = new Process { StartInfo = psi };

        try
        {
            process.Start();

            // Write JSON to stdin and close
            await process.StandardInput.WriteAsync(inputJson);
            process.StandardInput.Close();

            // Read stdout and stderr concurrently
            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = process.StandardError.ReadToEndAsync(ct);

            // Wait for exit with timeout
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(60));

            await process.WaitForExitAsync(cts.Token);

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (process.ExitCode != 0)
            {
                _logger.LogError("Python analyzer exited with code {Code}. stderr: {Stderr}",
                    process.ExitCode, stderr);
                return null;
            }

            if (!string.IsNullOrWhiteSpace(stderr))
            {
                _logger.LogWarning("Python analyzer stderr: {Stderr}", stderr);
            }

            if (string.IsNullOrWhiteSpace(stdout))
            {
                _logger.LogError("Python analyzer produced empty output");
                return null;
            }

            return JsonSerializer.Deserialize<JsonElement>(stdout);
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Python analyzer timed out or was cancelled");
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to run Python analyzer");
            return null;
        }
    }
}

// ── Input model for the Python --pipe mode ──────────────────────────────────

public sealed class PythonAnalysisInput
{
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    [JsonPropertyName("metrics")]
    public required Dictionary<string, object> Metrics { get; init; }

    [JsonPropertyName("control")]
    public required string Control { get; init; }

    [JsonPropertyName("treatments")]
    public required string[] Treatments { get; init; }

    [JsonPropertyName("inverse")]
    public bool Inverse { get; init; }

    [JsonPropertyName("observation_start")]
    public string? ObservationStart { get; init; }

    [JsonPropertyName("observation_end")]
    public string? ObservationEnd { get; init; }

    [JsonPropertyName("prior_proper")]
    public bool PriorProper { get; init; }

    [JsonPropertyName("prior_mean")]
    public double PriorMean { get; init; }

    [JsonPropertyName("prior_stddev")]
    public double PriorStddev { get; init; }

    [JsonPropertyName("minimum_sample")]
    public int MinimumSample { get; init; }

    [JsonPropertyName("guardrail_events")]
    public string[]? GuardrailEvents { get; init; }
}
