param(
    [Parameter(Mandatory = $true)][int] $CreatorPid,
    [Parameter(Mandatory = $true)][string] $StagedDirectory,
    [Parameter(Mandatory = $true)][string] $LiveDirectory,
    [Parameter(Mandatory = $true)][string] $PackageSha256
)

$ErrorActionPreference = "Stop"
if ($CreatorPid -le 0) { throw "CreatorPid must be a positive PID" }
if (-not (Test-Path -LiteralPath $StagedDirectory)) { throw "staged directory missing" }
if (-not (Test-Path -LiteralPath $LiveDirectory)) { throw "live directory missing" }
if ($PackageSha256 -notmatch '^[a-f0-9]{64}$') { throw "package hash must be 64 hex chars" }

Write-Output ("state=wait pid={0} hash={1}" -f $CreatorPid, $PackageSha256)
Wait-Process -Id $CreatorPid -ErrorAction SilentlyContinue

$liveParent = Split-Path -Parent $LiveDirectory
$swapName = (Split-Path -Leaf $LiveDirectory) + ".prev"
$backup = Join-Path $liveParent $swapName
if (Test-Path -LiteralPath $backup) { throw "backup directory already exists; refusing swap" }

Rename-Item -LiteralPath $LiveDirectory -NewName $swapName
try {
    Rename-Item -LiteralPath $StagedDirectory -NewName (Split-Path -Leaf $LiveDirectory)
} catch {
    Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $LiveDirectory)
    throw
}
Write-Output ("state=swapped hash={0}" -f $PackageSha256)
