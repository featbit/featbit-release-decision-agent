$artifactsDir = "artifacts/demo"

New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null

dotnet run --project src/FeatBit.ReleaseDecision.Cli -- inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out "$artifactsDir/catalog.json"

Write-Host "Next: generate $artifactsDir/plan.json from one brief in examples/ using prompts/planner-system.md"

dotnet run --project src/FeatBit.ReleaseDecision.Cli -- validate-plan --plan "$artifactsDir/plan.json" --catalog "$artifactsDir/catalog.json"
dotnet run --project src/FeatBit.ReleaseDecision.Cli -- run --plan "$artifactsDir/plan.json" --catalog "$artifactsDir/catalog.json" --connection-env FB_DECISION_PG --out "$artifactsDir/results.json" --summary-out "$artifactsDir/summary.md"
dotnet run --project src/FeatBit.ReleaseDecision.Cli -- sync-dry-run --plan "$artifactsDir/plan.json" --out "$artifactsDir/featbit-actions.json"

Write-Host "Artifacts written to $artifactsDir"