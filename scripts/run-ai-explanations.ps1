param(
  [ValidateRange(1, 10)]
  [int]$BatchSize = 1
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiBase = "http://127.0.0.1:3001/api"

try {
  $health = Invoke-RestMethod -Uri "$apiBase/health" -Method Get
  if (-not $health.ok) { throw "The local API health check did not succeed." }
} catch {
  throw "The local question-bank API is not running. Start the local site first, then run this script again."
}

try {
  $ollama = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get
  if ($null -eq $ollama.models) { throw "No local models found." }
} catch {
  throw "The local Ollama service is not ready. Start Ollama and download qwen3:4b before running this script."
}

$retry = Invoke-RestMethod -Uri "$apiBase/ai-explanations/retry-failed" -Method Post
if ([int]$retry.retried -gt 0) {
  Write-Host ("Reset {0} previously failed AI jobs." -f $retry.retried)
}

$summary = [ordered]@{ processed = 0; ready = 0; pendingReview = 0; failed = 0 }
while ($true) {
  try {
    $result = Invoke-RestMethod -Uri "$apiBase/ai-explanations/run-pending" -Method Post -ContentType "application/json" -Body (@{ limit = $BatchSize } | ConvertTo-Json -Compress)
  } catch {
    throw "AI generation stopped. Confirm the local question-bank API and Ollama service are running."
  }

  $summary.processed += [int]$result.processed
  $summary.ready += [int]$result.ready
  $summary.pendingReview += [int]$result.pendingReview
  $summary.failed += [int]$result.failed
  Write-Host ("Processed {0}: ready {1}, pending review {2}, failed {3}." -f $summary.processed, $summary.ready, $summary.pendingReview, $summary.failed)

  if ([int]$result.failed -gt 0) {
    throw "AI generation stopped after a failed batch. Remaining questions were not processed."
  }
  if ([int]$result.processed -eq 0) { break }
  Start-Sleep -Milliseconds 250
}

Write-Host ("AI generation finished. Ready {0}, pending review {1}, failed {2}." -f $summary.ready, $summary.pendingReview, $summary.failed)
