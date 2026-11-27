$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $projectRoot ('test-results/server windows smoke ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'scripts') -Force > $null
Copy-Item -LiteralPath (Join-Path $projectRoot 'server') -Destination $fixtureRoot -Recurse
foreach ($name in @('Start-Server.vbs', 'Stop-Server.vbs')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $fixtureRoot
}
$control = Join-Path $fixtureRoot 'scripts/server-windows.ps1'
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/server-windows.ps1') -Destination $control
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$settings = @("PORT=$testPort", 'HOST=127.0.0.1', 'DATA_DIR=./data', 'DEMO_MODE=false', 'GOOGLE_APPLICATION_CREDENTIALS=')
$settings | Set-Content -LiteralPath (Join-Path $fixtureRoot '.env') -Encoding ASCII
$recordPath = Join-Path $fixtureRoot '.partyup-server/process.json'
try {
    & $control -Action Start
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $api = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/api/health"
    if (-not $api.ok -or $api.demo -or $api.pushConfigured) { throw 'Unexpected API health' }
    if ((Get-Process -Id $record.ProcessId).MainWindowHandle -ne 0) { throw 'Server has a visible main window' }
    & $control -Action Start
    $repeated = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    if ($record.ProcessId -ne $repeated.ProcessId) { throw 'Repeated launch created another process' }
    & $control -Action Status
    & $control -Action Stop
    if (Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue) { throw 'Managed process is still running' }
    # A stale/reused PID record must not terminate an unrelated process (this PowerShell).
    $record.ProcessId = $PID
    $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
    & $control -Action Stop
    & $control -Action Status
    # Exercise the actual double-click launchers, including a working directory with spaces.
    & wscript.exe //B //T:15 (Join-Path $fixtureRoot 'Start-Server.vbs')
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $recordPath) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not (Test-Path -LiteralPath $recordPath)) { throw 'VBS launcher did not start' }
    Start-Sleep -Milliseconds 1500
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    if (-not (Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/api/health").ok) { throw 'VBS server unhealthy' }
    & wscript.exe //B //T:15 (Join-Path $fixtureRoot 'Stop-Server.vbs')
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    while ((Test-Path -LiteralPath $recordPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue) { throw 'VBS launcher did not stop' }
    # Bad startup must be detected and leave no stale PID.
    $occupied = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $testPort)
    $occupied.Start()
    try {
        $failed = $false
        try { & $control -Action Start } catch { $failed = $true }
        if (-not $failed -or (Test-Path -LiteralPath $recordPath)) { throw 'Failed launch was not cleaned up' }
    } finally { $occupied.Stop() }
    Write-Output 'PASS: hidden launch, logs, health, double-click VBS, duplicate prevention, safe stop, stale PID and port conflict in a directory with spaces.'
} finally {
    & $control -Action Stop
}
