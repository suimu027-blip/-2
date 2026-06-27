param(
  [string]$BaseUrl = $(if ($env:VERIVOTE_API_BASE_URL) { $env:VERIVOTE_API_BASE_URL } else { "http://localhost:3001" }),
  [string]$OutDir = "docs/evaluation/aggregator_reports/powershell_api"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function ConvertTo-JsonUtf8File {
  param(
    [Parameter(Mandatory = $true)] $Value,
    [Parameter(Mandatory = $true)] [string] $Path
  )

  $json = $Value | ConvertTo-Json -Depth 80
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $Path)).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $Path), $json + "`n", $utf8NoBom)
}

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)] [string] $Method,
    [Parameter(Mandatory = $true)] [string] $Path,
    $Body = $null
  )

  $uri = "$BaseUrl$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -ErrorAction Stop
  }

  $jsonBody = $Body | ConvertTo-Json -Depth 40
  return Invoke-RestMethod -Method $Method -Uri $uri -Body $jsonBody -ContentType "application/json" -ErrorAction Stop
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)] [bool] $Condition,
    [Parameter(Mandatory = $true)] [string] $Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function New-FixtureElection {
  param([Parameter(Mandatory = $true)] [string] $CaseName)

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $election = (Invoke-Json "POST" "/elections" @{
    title = "A-track PowerShell $CaseName $stamp"
    description = "4 candidates / 8 votes seeded by scripts/aggregator-api-powershell-smoke.ps1"
  }).election

  $candidateIds = @()
  foreach ($name in @("Alice", "Bob", "Carol", "Dave")) {
    $candidate = (Invoke-Json "POST" "/elections/$($election.id)/candidates" @{
      name = $name
    }).candidate
    $candidateIds += $candidate.id
  }

  for ($index = 0; $index -lt 8; $index += 1) {
    $user = (Invoke-Json "POST" "/users/register" @{
      name = "PowerShell User $CaseName $($index + 1)"
    }).user
    $candidateId = $candidateIds[$index % $candidateIds.Count]
    [void](Invoke-Json "POST" "/elections/$($election.id)/vote" @{
      userId = $user.id
      candidateId = $candidateId
    })
  }

  return $election.id
}

function Save-AggregatorCase {
  param(
    [Parameter(Mandatory = $true)] [string] $CaseName,
    [Parameter(Mandatory = $true)] [string] $ElectionId,
    [string] $ExpectedReason = ""
  )

  $run = Invoke-Json "POST" "/aggregator/elections/$ElectionId/run"
  $report = $run.report
  Assert-True ($run.integrityCheck.verified -eq $true) "$CaseName integrityCheck.verified was not true."
  Assert-True ($report.proofStatus -eq "not-generated") "$CaseName proofStatus was not not-generated."
  Assert-True ($null -ne $report.partitionAudit -and $report.partitionAudit.buckets.Count -eq 4) "$CaseName partitionAudit buckets missing."
  Assert-True ($report.validVoteIds.Count -eq $report.validVotes) "$CaseName validVoteIds count mismatch."
  Assert-True ($report.invalidVoteIds.Count -eq $report.invalidVotes) "$CaseName invalidVoteIds count mismatch."
  foreach ($bucket in $report.partitionAudit.buckets) {
    Assert-True ($null -ne $bucket.tokenHashes) "$CaseName bucket tokenHashes missing."
  }
  if ($ExpectedReason.Length -gt 0) {
    $reasons = @($report.invalidVoteDiagnostics | ForEach-Object { $_.reason })
    Assert-True ($reasons -contains $ExpectedReason) "$CaseName missing expected diagnostic reason $ExpectedReason."
  }

  $fileName = if ($CaseName -eq "normal") {
    "aggregator_report.normal.json"
  } else {
    "aggregator_report.attack-$CaseName.json"
  }
  $filePath = Join-Path $OutDir $fileName
  ConvertTo-JsonUtf8File $report $filePath

  return @{
    case = $CaseName
    electionId = $ElectionId
    file = $fileName
    proofStatus = $report.proofStatus
    validVotes = $report.validVotes
    invalidVotes = $report.invalidVotes
    duplicateVotes = $report.duplicateVotes
    receiptChainVerified = $report.receiptChainVerified
    diagnosticReasons = @($report.invalidVoteDiagnostics | ForEach-Object { $_.reason } | Sort-Object -Unique)
    auditHash = $report.auditHash
    partitionHash = $report.partitionHash
    diagnosticsHash = $report.diagnosticsHash
    integrityVerified = $run.integrityCheck.verified
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
[void](Invoke-Json "GET" "/health")

$summaries = @()

$normalElectionId = New-FixtureElection "normal"
$summaries += Save-AggregatorCase "normal" $normalElectionId

$attackCases = @(
  @{ case = "duplicate-token"; endpoint = "inject-duplicate-vote"; reason = "duplicate-token" },
  @{ case = "invalid-candidate"; endpoint = "inject-invalid-vote"; reason = "invalid-candidate" },
  @{ case = "non-one-hot"; endpoint = "inject-non-one-hot-vote"; reason = "invalid-one-hot" },
  @{ case = "candidate-vector-mismatch"; endpoint = "inject-candidate-vector-mismatch"; reason = "candidate-vector-mismatch" },
  @{ case = "commitment-tamper"; endpoint = "tamper-commitment"; reason = "commitment-opening-failed" },
  @{ case = "receipt-chain-delete"; endpoint = "delete-vote"; reason = "receipt-chain-break" }
)

foreach ($attack in $attackCases) {
  $electionId = New-FixtureElection $attack.case
  [void](Invoke-Json "POST" "/attack/elections/$electionId/$($attack.endpoint)")
  $summaries += Save-AggregatorCase $attack.case $electionId $attack.reason
}

$publicInputs = Invoke-Json "GET" "/elections/$normalElectionId/export/public_inputs.json"
ConvertTo-JsonUtf8File $publicInputs (Join-Path $OutDir "public_inputs.normal.json")

$bundleResponse = Invoke-Json "GET" "/elections/$normalElectionId/export-bundle"
ConvertTo-JsonUtf8File $bundleResponse.bundle (Join-Path $OutDir "export_bundle.normal.json")

$manifest = [ordered]@{
  schemaVersion = "verivote.aggregator-powershell-api-smoke.v1"
  generatedBy = "scripts/aggregator-api-powershell-smoke.ps1"
  baseUrl = $BaseUrl
  normalElectionId = $normalElectionId
  caseCount = $summaries.Count
  allIntegrityVerified = (@($summaries | Where-Object { $_.integrityVerified -ne $true }).Count -eq 0)
  files = @(
    "aggregator_report.normal.json",
    "aggregator_report.attack-duplicate-token.json",
    "aggregator_report.attack-invalid-candidate.json",
    "aggregator_report.attack-non-one-hot.json",
    "aggregator_report.attack-candidate-vector-mismatch.json",
    "aggregator_report.attack-commitment-tamper.json",
    "aggregator_report.attack-receipt-chain-delete.json",
    "public_inputs.normal.json",
    "export_bundle.normal.json"
  )
  cases = $summaries
}
ConvertTo-JsonUtf8File $manifest (Join-Path $OutDir "manifest.json")

Write-Host "Wrote PowerShell API AggregatorReport v2 evidence to $OutDir"
