param(
  [Parameter(Mandatory = $false)]
  [string]$DatabaseUrl,

  [Parameter(Mandatory = $false)]
  [string]$SandboxUrl = "https://sandbox.featbit.ai",

  [Parameter(Mandatory = $false)]
  [string]$TsdbBaseUrl = "https://tsdb.featbit.ai"
)

$ErrorActionPreference = "Stop"

Write-Host "[deploy] starting Cloudflare deployment for agent/web..."

if (-not $DatabaseUrl) {
  if ($env:DATABASE_URL) {
    $DatabaseUrl = $env:DATABASE_URL
  } else {
    throw "DATABASE_URL is required. Pass -DatabaseUrl or set env:DATABASE_URL."
  }
}

Write-Host "[deploy] setting Cloudflare secret DATABASE_URL..."
$DatabaseUrl | npx wrangler secret put DATABASE_URL | Out-Host

Write-Host "[deploy] deploying worker + container..."
npx wrangler deploy | Out-Host

Write-Host "[deploy] health checks..."
try {
  curl.exe -I https://featbit.ai | Out-Host
  curl.exe -I https://www.featbit.ai | Out-Host
  curl.exe -I https://featbit.ai/experiments | Out-Host
  curl.exe -I https://www.featbit.ai/experiments | Out-Host
} catch {
  Write-Warning "Health check failed: $($_.Exception.Message)"
}

Write-Host "[deploy] done."
