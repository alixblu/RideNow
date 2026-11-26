<#
  Creates known test accounts (riders and drivers) so the real frontend can log in.

  RDS stores only BCrypt hashes, so passwords cannot be exported. This script
  registers accounts through POST /api/auth/register with a password you choose,
  then writes the credentials to .tmp/test-accounts.csv (gitignored, plaintext).

  Each driver also gets a driver profile, a vehicle, ONLINE status and a location,
  so it can receive trip offers right away.

  Safe to re-run: accounts that already exist (409) are logged in to fetch their
  ids, and existing driver profiles and vehicles are reused. Nothing is deleted.

  Usage (PowerShell 5.1 or 7, from the repo root):
      ./scripts/seed-test-accounts.ps1                       # local stack
      ./scripts/seed-test-accounts.ps1 -BaseUrl http://<alb-host>
#>
param(
  [string]$UserUrl   = 'http://localhost:8081',
  [string]$DriverUrl = 'http://localhost:8080',
  # Point every service at one origin, e.g. the ALB.
  [string]$BaseUrl   = '',
  # 8-72 characters (user-service validation).
  [string]$Password  = 'Test@12345',
  [int]$Count        = 3,
  [string]$OutFile   = ''
)

if ($BaseUrl) { $UserUrl = $BaseUrl; $DriverUrl = $BaseUrl }
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) { $OutFile = Join-Path $repoRoot '.tmp/test-accounts.csv' }

# One HTTP call through curl.exe (same behavior in PowerShell 5.1 and 7).
function Call([string]$Method, [string]$Url, [string]$Body = $null) {
  $a = @('-s', '-m', '30', '-w', '|%{http_code}', '-X', $Method, $Url)
  $tmp = $null
  if ($Body) {
    $tmp = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmp, $Body)
    $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$tmp")
  }
  $out = & curl.exe @a
  if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  $i = $out.LastIndexOf('|')
  $text = $out.Substring(0, $i)
  $json = $null
  try { if ($text) { $json = $text | ConvertFrom-Json } } catch { }
  [pscustomobject]@{ Status = [int]$out.Substring($i + 1); Body = $text; Json = $json }
}

# Returns the user id; registers the account, or logs in when it already exists.
function EnsureUser([string]$Email, [string]$FullName, [string]$Role) {
  $reg = Call POST "$UserUrl/api/auth/register" (@{ email = $Email; password = $Password; fullName = $FullName; accountType = $Role } | ConvertTo-Json)
  if ($reg.Status -eq 201 -or $reg.Status -eq 200) { return @{ Id = $reg.Json.id; Created = $true } }
  if ($reg.Status -ne 409) { throw "register $Email failed: status=$($reg.Status) $($reg.Body)" }
  $login = Call POST "$UserUrl/api/auth/login" (@{ email = $Email; password = $Password } | ConvertTo-Json)
  if ($login.Status -ne 200) {
    throw "$Email exists but login with the given password failed (status=$($login.Status)). It was created with another password."
  }
  return @{ Id = $login.Json.id; Created = $false }
}

function EnsureDriver([string]$UserId, [int]$N) {
  # Older driver-service builds ignore ?userId=, so match on userId here as well.
  $existing = Call GET "$DriverUrl/api/drivers?userId=$UserId&limit=1000"
  $mine = $null
  if ($existing.Status -eq 200 -and $existing.Json.items) {
    $mine = @($existing.Json.items) | Where-Object { $_.userId -eq $UserId } | Select-Object -First 1
  }
  if ($mine) {
    $id = $mine.id
  } else {
    $r = Call POST "$DriverUrl/api/drivers" (@{ userId = $UserId; licenseNumber = "LIC-TEST-$N" } | ConvertTo-Json)
    if ($r.Status -ne 201 -and $r.Status -ne 200) { throw "create driver $N failed: status=$($r.Status) $($r.Body)" }
    $id = $r.Json.id
  }
  $veh = Call GET "$DriverUrl/api/drivers/$id/vehicles"
  if ($veh.Status -eq 200 -and @($veh.Json).Count -eq 0) {
    $r = Call POST "$DriverUrl/api/drivers/$id/vehicles" (@{ plateNumber = "51A-TEST-$N"; vehicleType = 'CAR'; brand = 'Toyota'; model = 'Vios'; color = 'white' } | ConvertTo-Json)
    if ($r.Status -ne 201 -and $r.Status -ne 200) { throw "create vehicle $N failed: status=$($r.Status) $($r.Body)" }
  }
  $r = Call POST "$DriverUrl/api/drivers/$id/online" '{}'
  if ($r.Status -ge 300) { throw "set driver $N online failed: status=$($r.Status) $($r.Body)" }
  $r = Call POST "$DriverUrl/api/drivers/$id/location" (@{ lat = 10.7769; lng = 106.7009 } | ConvertTo-Json)
  if ($r.Status -ge 300) { throw "post location for driver $N failed: status=$($r.Status) $($r.Body)" }
  return $id
}

$rows = @()
$created = 0
for ($n = 1; $n -le $Count; $n++) {
  $u = EnsureUser "rider$n@ridenow.test" "Test Rider $n" 'RIDER'
  if ($u.Created) { $created++ }
  $rows += [pscustomobject]@{ email = "rider$n@ridenow.test"; password = $Password; role = 'RIDER'; userId = $u.Id; driverId = '' }
}
for ($n = 1; $n -le $Count; $n++) {
  $u = EnsureUser "driver$n@ridenow.test" "Test Driver $n" 'DRIVER'
  if ($u.Created) { $created++ }
  $did = EnsureDriver $u.Id $n
  $rows += [pscustomobject]@{ email = "driver$n@ridenow.test"; password = $Password; role = 'DRIVER'; userId = $u.Id; driverId = $did }
}

# Verify every row can log in.
foreach ($row in $rows) {
  $l = Call POST "$UserUrl/api/auth/login" (@{ email = $row.email; password = $row.password } | ConvertTo-Json)
  if ($l.Status -ne 200) { throw "login check failed for $($row.email): status=$($l.Status)" }
}

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$rows | Export-Csv -Path $OutFile -NoTypeInformation -Encoding UTF8

$rows | Format-Table -AutoSize
Write-Host "Accounts created this run: $created (others already existed). All $($rows.Count) logins verified."
Write-Host "Credentials written to $OutFile"
