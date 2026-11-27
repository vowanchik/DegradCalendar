param([string]$Version = '0.3.1')
$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
$repoName = 'vowanchik/DegradCalendar'
$tagName = 'v' + $Version
$apiBase = 'https://api.github.com/repos/' + $repoName
$commit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read HEAD' }
$tagCommit = (git rev-list -n 1 $tagName).Trim()
if ($LASTEXITCODE -ne 0 -or $tagCommit -ne $commit) { throw 'Release tag must point to HEAD' }
if (git status --porcelain) { throw 'Commit all changes before publishing' }
$assetNames = @("PartyUp-$Version-Windows.exe", "PartyUp-$Version-Android.apk", "PartyUp-$Version-Server.zip", 'SHA256SUMS.txt')
$checksumText = [IO.File]::ReadAllText((Join-Path $projectRoot 'release/SHA256SUMS.txt'))
foreach ($assetName in $assetNames) {
    $assetPath = Join-Path $projectRoot ('release/' + $assetName)
    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw ('Missing asset: ' + $assetName) }
    if ($assetName -ne 'SHA256SUMS.txt') {
        $digest = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if (-not $checksumText.Contains($digest + '  ' + $assetName)) { throw ('Checksum manifest mismatch: ' + $assetName) }
    }
}
# Use the existing Git credential manager; never write or print the credential.
$credentialLines = "protocol=https`nhost=github.com`nusername=vowanchik`n`n" | git -c credential.interactive=never credential fill 2>$null
if ($LASTEXITCODE -ne 0) { throw 'GitHub credentials unavailable' }
$credentialFields = @{}
foreach ($line in $credentialLines) { $pair = $line -split '=', 2; if ($pair.Count -eq 2) { $credentialFields[$pair[0]] = $pair[1] } }
$headers = @{ Authorization = 'Bearer ' + $credentialFields['password']; Accept = 'application/vnd.github+json'; 'User-Agent' = 'PartyUp-Release' }
$remoteCommit = Invoke-RestMethod -Uri ($apiBase + '/commits/main') -Headers $headers
$remoteTag = Invoke-RestMethod -Uri ($apiBase + '/commits/' + $tagName) -Headers $headers
if ($remoteCommit.sha -ne $commit -or $remoteTag.sha -ne $commit) { throw 'Push main and the release tag before publishing' }
$release = $null
try { $release = Invoke-RestMethod -Uri ($apiBase + '/releases/tags/' + $tagName) -Headers $headers }
catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
if ($release -and -not $release.draft) { throw 'Release is already published; assets will not be replaced' }
if (-not $release) {
    $body = @{ tag_name = $tagName; target_commitish = $commit; name = "PartyUp $Version"; body = [IO.File]::ReadAllText((Join-Path $projectRoot "docs/releases/$tagName.md")); draft = $true; prerelease = $false } | ConvertTo-Json -Compress
    $release = Invoke-RestMethod -Method Post -Uri ($apiBase + '/releases') -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))
}
$uploadBase = $release.upload_url -replace '\{\?name,label\}$', ''
foreach ($assetName in $assetNames) {
    $assetPath = Join-Path $projectRoot ('release/' + $assetName)
    $file = Get-Item -LiteralPath $assetPath
    $digest = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $existing = @($release.assets | Where-Object { $_.name -eq $assetName })
    if ($existing.Count -gt 1) { throw ('Duplicate asset: ' + $assetName) }
    if ($existing.Count -eq 1) { $asset = $existing[0] }
    else {
        Write-Output ('Uploading ' + $assetName + ' (' + $file.Length + ' bytes)')
        $asset = Invoke-RestMethod -Method Post -Uri ($uploadBase + '?name=' + [Uri]::EscapeDataString($assetName)) -Headers $headers -ContentType 'application/octet-stream' -InFile $assetPath -TimeoutSec 900
    }
    if ($asset.state -ne 'uploaded' -or $asset.size -ne $file.Length -or $asset.digest -ne ('sha256:' + $digest)) { throw ('Upload size or SHA-256 mismatch: ' + $assetName) }
    Write-Output ('Verified SHA-256: ' + $assetName)
}
$publishBody = @{ draft = $false; make_latest = 'true' } | ConvertTo-Json -Compress
$published = Invoke-RestMethod -Method Patch -Uri ($apiBase + '/releases/' + $release.id) -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($publishBody))
if ($published.draft -or $published.assets.Count -ne $assetNames.Count) { throw 'Published release verification failed' }
$state = $published | Select-Object id,tag_name,target_commitish,draft,prerelease,html_url,@{ Name='assets'; Expression={ $_.assets | Select-Object name,size,state,digest,browser_download_url } }
[IO.File]::WriteAllText((Join-Path $projectRoot "release/$tagName-release.json"), ($state | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output ('Published: ' + $published.html_url)
