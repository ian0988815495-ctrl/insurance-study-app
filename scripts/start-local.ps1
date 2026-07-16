$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$portableNode = Join-Path $root "tools\node-v22.23.1-win-x64\node.exe"
$systemNode = Get-Command node -ErrorAction SilentlyContinue
$node = if (Test-Path -LiteralPath $portableNode) { $portableNode } elseif ($systemNode) { $systemNode.Source } else { throw "Node.js 22 was not found." }
$npm = Join-Path (Split-Path -Parent $node) "npm.cmd"

function Start-QuestionBankService([string]$arguments) {
  $command = 'cd /d "{0}" && start "" /b "{1}" {2}' -f $root, $node, $arguments
  & $env:ComSpec /d /s /c $command
}

function Test-SqliteDriver {
  & $node "-e" "require('better-sqlite3')" *> $null
  return $LASTEXITCODE -eq 0
}

Push-Location $root
try {
  if (-not (Test-SqliteDriver)) {
    if (-not (Test-Path -LiteralPath $npm)) { throw "npm was not found. The local SQLite component cannot be rebuilt." }
    Write-Host "Rebuilding the local question-bank component. Please wait..."
    & $npm rebuild better-sqlite3 --foreground-scripts
    if ($LASTEXITCODE -ne 0 -or -not (Test-SqliteDriver)) { throw "The local SQLite component could not be rebuilt. Reinstall the project packages and try again." }
  }

  Start-QuestionBankService "node_modules\tsx\dist\cli.mjs watch src\server\index.ts"
  Start-QuestionBankService "node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173"
  Write-Host "Question bank web: http://127.0.0.1:5173"
  Write-Host "Local API: http://127.0.0.1:3001/api/health"
} finally {
  Pop-Location
}
