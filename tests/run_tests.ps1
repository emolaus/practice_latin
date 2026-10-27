# Runs the browser test suite headlessly with Chrome or Edge and reports the result.
#   1. Unit tests: tests/index.html
#   2. Smoke test: practice_latin.html loads without script errors and builds its UI
# Usage:  powershell -ExecutionPolicy Bypass -File tests\run_tests.ps1
$ErrorActionPreference = 'Stop'

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { Write-Error 'Neither Chrome nor Edge was found. Open tests/index.html manually.' }

function Get-Dom([string]$file) {
  $path = (Resolve-Path (Join-Path $PSScriptRoot $file)).Path
  $url = 'file:///' + ($path -replace '\\', '/')
  $profileDir = Join-Path ([System.IO.Path]::GetTempPath()) ('pl-tests-' + [guid]::NewGuid())
  # The browser writes harmless log noise to stderr; don't let that abort the script.
  # --no-sandbox: Chromium's own process sandbox cannot start inside some restricted
  # shells; this is a throwaway headless profile that only opens local test pages.
  $ErrorActionPreference = 'Continue'
  $dom = & $browser --headless=new --no-sandbox --disable-gpu --no-first-run --user-data-dir="$profileDir" `
    --virtual-time-budget=10000 --dump-dom $url 2>$null | Out-String
  Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue
  return $dom
}

$failed = $false

# ---- 1. unit tests
$dom = Get-Dom 'index.html'
[regex]::Matches($dom, '<li class="(pass|fail)">(.*?)</li>') |
  ForEach-Object { Write-Output ([System.Net.WebUtility]::HtmlDecode($_.Groups[2].Value)) }
$summary = [regex]::Match($dom, '<title>(.*?)</title>').Groups[1].Value
Write-Output ''
Write-Output "Unit tests: $summary"
if ($summary -notmatch '^PASS') { $failed = $true }

# ---- 2. app smoke test
$app = Get-Dom '..\practice_latin.html'
$checks = [ordered]@{
  'grammar checkboxes rendered (21)' = ([regex]::Matches($app, 'type="checkbox" value="')).Count -eq 21
  'grammar groups rendered (5)'      = ([regex]::Matches($app, '<legend>')).Count -eq 5
  'model list populated'             = $app -match '<option value="gpt-'
  'welcome message shown'            = $app -match 'Welcome!'
}
foreach ($k in $checks.Keys) {
  $ok = $checks[$k]
  Write-Output ((@('FAIL', 'PASS')[[int]$ok]) + '  smoke: ' + $k)
  if (-not $ok) { $failed = $true }
}

Write-Output ''
if ($failed) { Write-Output 'Result: FAIL'; exit 1 } else { Write-Output 'Result: PASS' }
