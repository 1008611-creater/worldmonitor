param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$keyFile = Join-Path $RepoRoot 'worldmonitor-keys.local.env'
$logDir = Join-Path (Split-Path -Parent $RepoRoot) 'logs'

if (-not (Test-Path -LiteralPath $keyFile)) {
  throw "Missing local key file: $keyFile"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

foreach ($line in Get-Content -LiteralPath $keyFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path ("Env:" + $name) -Value $value
  }
}

$stdout = Join-Path $logDir 'worldmonitor.log'
$stderr = Join-Path $logDir 'worldmonitor.err.log'
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

if ($existing) {
  Write-Output "WorldMonitor already listening on port $Port (PID $($existing[0].OwningProcess))"
  exit 0
}

$process = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$Port") `
  -WorkingDirectory $RepoRoot `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru `
  -WindowStyle Hidden

Set-Content -LiteralPath (Join-Path $logDir 'worldmonitor.pid') -Value $process.Id -Encoding ascii
Write-Output "WorldMonitor started on http://127.0.0.1:$Port (PID $($process.Id))"
