param([ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.partyup-server'
$recordPath = Join-Path $runtimeDirectory 'process.json'
$serverPath = Join-Path $projectRoot 'server/index.mjs'
$envPath = Join-Path $projectRoot '.env'
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $runtimeDirectory -Force > $null
# Serialize launch/stop operations; never launch a second server from simultaneous clicks.
$controlLock = $null
try {
    $controlLock = [IO.File]::Open((Join-Path $runtimeDirectory 'control.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $serverProcess = $null
    if (Test-Path -LiteralPath $recordPath) {
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        $candidate = Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue
        # A reused PID or a record from another directory must never stop an unrelated process.
        if ($candidate -and $record.ServerPath -eq $serverPath -and
            $candidate.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.StartTicks -and
            $candidate.Path -eq $record.NodePath) {
            $serverProcess = $candidate
        }
    }
    if ($Action -eq 'Status') {
        if ($serverProcess) { Write-Output ('PartyUp server is running (PID ' + $serverProcess.Id + ').') }
        else { Write-Output 'PartyUp server is stopped (no managed process).'; }
        return
    }
    if ($Action -eq 'Stop') {
        if ($serverProcess) {
            Stop-Process -InputObject $serverProcess
            $serverProcess.WaitForExit()
            Write-Output 'PartyUp server stopped.'
        } else { Write-Output 'PartyUp server is already stopped (no managed process).' }
        if (Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
        return
    }
    if ($serverProcess) {
        Write-Output ('PartyUp server is already running (PID ' + $serverProcess.Id + ').')
        return
    }
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw 'Create .env from .env.http.example or .env.example before starting the server.'
    }
    $nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $nodeVersion = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
        throw 'PartyUp requires Node.js 24 or newer.'
    }
    New-Item -ItemType Directory -Path $logDirectory -Force > $null
    $stdoutPath = Join-Path $logDirectory 'server.log'
    $stderrPath = Join-Path $logDirectory 'server-error.log'
    foreach ($logPath in @($stdoutPath, $stderrPath)) {
        if (Test-Path -LiteralPath $logPath) { Copy-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force }
    }
    $started = Start-Process -FilePath $nodePath -ArgumentList @('--env-file="' + $envPath + '"', '"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    try {
        $record = @{
            ProcessId = $started.Id
            StartTicks = $started.StartTime.ToUniversalTime().Ticks.ToString()
            NodePath = $nodePath
            ServerPath = $serverPath
        }
        $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
        Start-Sleep -Milliseconds 1200
        $started.Refresh()
        if ($started.HasExited) { throw ('Server exited. See ' + $stderrPath) }
    } catch {
        if (-not $started.HasExited) { Stop-Process -InputObject $started }
        if (Test-Path -LiteralPath $recordPath) { Remove-Item -LiteralPath $recordPath }
        throw
    }
    Write-Output ('PartyUp server started without a window (PID ' + $started.Id + '). Logs: ' + $logDirectory)
} finally {
    if ($controlLock) { $controlLock.Dispose() }
}
