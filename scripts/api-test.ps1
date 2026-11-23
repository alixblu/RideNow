<#
  End-to-end API test for the local RideNow stack (docker compose up --build).

  Drives every service over HTTP exactly as the apps do, and checks the async
  pieces (SNS -> SQS -> consumers, Redis Pub/Sub -> SSE) by their visible effects.
  Creates its own users and drivers, so it can be re-run against a stack that
  already holds data.

  Usage (PowerShell 5.1 or 7, from the repo root):
      ./scripts/api-test.ps1
  Exit code: 0 when every check passes, 1 otherwise.
#>
param(
  [string]$UserUrl     = 'http://localhost:8081',
  [string]$DriverUrl   = 'http://localhost:8080',
  [string]$TripUrl     = 'http://localhost:8082',
  [string]$PaymentUrl  = 'http://localhost:8083',
  [string]$NotifyUrl   = 'http://localhost:8084',
  [string]$MatchUrl    = 'http://localhost:8085',
  [string]$GatewayUrl  = 'http://localhost:8086',
  # Point every public service at one origin, e.g. the ALB:
  #   ./scripts/api-test.ps1 -BaseUrl http://<alb-host> -MatchUrl http://localhost:18085 -SkipHealth
  # matching-service has no public route, so reach it with kubectl port-forward.
  [string]$BaseUrl     = '',
  # The ALB does not route /actuator/health; on EKS the readiness probes cover it.
  [switch]$SkipHealth
)

if ($BaseUrl) {
  $UserUrl = $BaseUrl; $DriverUrl = $BaseUrl; $TripUrl = $BaseUrl
  $PaymentUrl = $BaseUrl; $NotifyUrl = $BaseUrl; $GatewayUrl = $BaseUrl
}

$ErrorActionPreference = 'Stop'
$script:Pass = 0
$script:Fail = 0
$script:Failures = @()

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { $script:Pass++; Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else {
    $script:Fail++; $script:Failures += $Name
    Write-Host ("  FAIL  {0}  {1}" -f $Name, $Detail) -ForegroundColor Red
  }
}

# One HTTP call through curl.exe (works the same in PowerShell 5.1 and 7).
# Returns Status (int) and Body (string); Json parses the body when it is JSON.
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

function Section([string]$Title) { Write-Host ""; Write-Host "== $Title" -ForegroundColor Cyan }

# Poll until $Test returns a truthy value, up to $Seconds. Async effects (queues,
# Redis) are not instant, so the checks wait for them instead of sleeping blindly.
function WaitFor([scriptblock]$Test, [int]$Seconds = 20) {
  $end = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $end) {
    $r = & $Test
    if ($r) { return $r }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

$run = [guid]::NewGuid().ToString('N').Substring(0, 8)
$uuidNone = '00000000-0000-0000-0000-000000000000'

# Every run works at its own random spot (inside Ho Chi Minh City) so drivers left
# online by an earlier or aborted run cannot crowd this run's matching offers.
$latA = [math]::Round(10.50 + (Get-Random -Minimum 0 -Maximum 4000) / 10000.0, 4)
$lngA = [math]::Round(106.50 + (Get-Random -Minimum 0 -Maximum 4000) / 10000.0, 4)
$latB = [math]::Round($latA + 0.0002, 4); $lngB = [math]::Round($lngA + 0.0002, 4)
$pickLat = [math]::Round($latA + 0.0001, 4); $pickLng = [math]::Round($lngA + 0.0001, 4)
$destLat = [math]::Round($latA + 0.05, 4); $destLng = [math]::Round($lngA + 0.05, 4)
$destLat2 = [math]::Round($latA + 0.02, 4); $destLng2 = [math]::Round($lngA + 0.02, 4)

function NewUser([string]$Role) {
  (Call POST "$UserUrl/api/users" (@{ cognitoSub = "$Role-$run-$([guid]::NewGuid().ToString('N').Substring(0,6))"; email = "$Role.$run.$([guid]::NewGuid().ToString('N').Substring(0,6))@test.com"; fullName = "$Role $run" } | ConvertTo-Json)).Json
}
function NewDriver([string]$Tag, [bool]$WithVehicle = $true) {
  $u = NewUser "drv$Tag"
  $d = (Call POST "$DriverUrl/api/drivers" (@{ userId = $u.id; licenseNumber = "LIC-$run-$Tag" } | ConvertTo-Json)).Json
  if ($WithVehicle) {
    Call POST "$DriverUrl/api/drivers/$($d.id)/vehicles" (@{ plateNumber = "51A-$run-$Tag"; vehicleType = 'CAR'; brand = 'Toyota'; model = 'Vios'; color = 'white' } | ConvertTo-Json) | Out-Null
  }
  $d
}

# ---------------------------------------------------------------------------
Section '1. Health of every service'
$healthTargets = @(@('driver', $DriverUrl), @('user', $UserUrl), @('trip', $TripUrl), @('payment', $PaymentUrl), @('notification', $NotifyUrl), @('matching', $MatchUrl), @('realtime-gateway', $GatewayUrl))
if ($SkipHealth) { Write-Host '  skip  health checks (-SkipHealth)'; $healthTargets = @() }
foreach ($svc in $healthTargets) {
  $r = Call GET "$($svc[1])/actuator/health"
  Check "$($svc[0]) /actuator/health is UP" ($r.Status -eq 200 -and $r.Json.status -eq 'UP') "status=$($r.Status) body=$($r.Body)"
}

# ---------------------------------------------------------------------------
Section '2. user-service'
$email = "rider.$run@test.com"
$phone = '09' + (Get-Random -Minimum 10000000 -Maximum 99999999)
$body = @{ cognitoSub = "rider-$run"; email = $email; phone = $phone; fullName = "Rider $run" } | ConvertTo-Json
$r = Call POST "$UserUrl/api/users" $body
Check 'create user returns 201' ($r.Status -eq 201) "status=$($r.Status) $($r.Body)"
$rider = $r.Json
Check 'created user has id, ACTIVE status, same email' ($rider.id -and $rider.status -eq 'ACTIVE' -and $rider.email -eq $email)
$r = Call GET "$UserUrl/api/users/$($rider.id)"
Check 'get user by id returns 200 with the same user' ($r.Status -eq 200 -and $r.Json.id -eq $rider.id)
$r = Call GET "$UserUrl/api/users?limit=5"
Check 'list users returns a page (items, total)' ($r.Status -eq 200 -and $r.Json.items -and $r.Json.total -ge 1)
$r = Call POST "$UserUrl/api/users" $body
Check 'duplicate user returns 409' ($r.Status -eq 409) "status=$($r.Status) $($r.Body)"
$r = Call POST "$UserUrl/api/users" (@{ cognitoSub = "x-$run"; fullName = 'No Email' } | ConvertTo-Json)
Check 'missing email returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$UserUrl/api/users" '{"cognitoSub": '
Check 'malformed JSON returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$UserUrl/api/users/$uuidNone"
Check 'unknown user id returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$r = Call GET "$UserUrl/api/users/not-a-uuid"
Check 'bad user id returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$UserUrl/api/users" (@{ cognitoSub = "dupphone-$run"; email = "dupphone.$run@test.com"; phone = $phone; fullName = 'Dup Phone' } | ConvertTo-Json)
Check 'duplicate phone returns 409' ($r.Status -eq 409) "status=$($r.Status)"

# ---------------------------------------------------------------------------
Section '3. driver-service (validates the user over HTTP, live state in Redis)'
$driverUser = NewUser 'drvA'
$r = Call POST "$DriverUrl/api/drivers" (@{ userId = $driverUser.id; licenseNumber = "LIC-$run-A" } | ConvertTo-Json)
Check 'create driver returns 201' ($r.Status -eq 201) "status=$($r.Status) $($r.Body)"
$driverA = $r.Json
$r = Call POST "$DriverUrl/api/drivers" (@{ userId = $driverUser.id; licenseNumber = "LIC-$run-A2" } | ConvertTo-Json)
Check 'a second driver for the same user returns 409' ($r.Status -eq 409) "status=$($r.Status)"
$r = Call POST "$DriverUrl/api/drivers" (@{ userId = $uuidNone; licenseNumber = "LIC-$run-ghost" } | ConvertTo-Json)
Check 'driver for an unknown user is rejected (user-service lookup)' ($r.Status -in 404, 400, 422) "status=$($r.Status) $($r.Body)"
$r = Call POST "$DriverUrl/api/drivers" (@{ licenseNumber = 'x' } | ConvertTo-Json)
Check 'driver without userId returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/drivers/$($driverA.id)"
Check 'get driver returns 200' ($r.Status -eq 200 -and $r.Json.id -eq $driverA.id)
$r = Call GET "$DriverUrl/api/drivers?limit=3"
Check 'list drivers returns a page' ($r.Status -eq 200 -and $r.Json.items)

$noVehicle = NewDriver 'NV' $false
$r = Call POST "$DriverUrl/api/drivers/$($noVehicle.id)/online" '{}'
Check 'going online with no vehicle returns 409' ($r.Status -eq 409) "status=$($r.Status) $($r.Body)"

$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/vehicles" (@{ plateNumber = "51A-$run-A"; vehicleType = 'CAR'; brand = 'Toyota'; model = 'Vios'; color = 'white' } | ConvertTo-Json)
Check 'create vehicle returns 201' ($r.Status -eq 201 -and $r.Json.id -and $r.Json.active) "status=$($r.Status) $($r.Body)"
$vehicleA = $r.Json
$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/vehicles" '{"plateNumber":"X","vehicleType":"SPACESHIP"}'
Check 'invalid vehicleType returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/drivers/$($driverA.id)/vehicles"
Check 'list vehicles of a driver returns 200' ($r.Status -eq 200)
$r = Call GET "$DriverUrl/api/vehicles/$($vehicleA.id)"
Check 'get vehicle returns 200' ($r.Status -eq 200 -and $r.Json.id -eq $vehicleA.id)

$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/online" '{}'
Check 'go online returns 200 ONLINE with the vehicle type' ($r.Status -eq 200 -and $r.Json.availability -eq 'ONLINE' -and $r.Json.vehicleType -eq 'CAR') "status=$($r.Status) $($r.Body)"
$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/location" (@{ lat = $latA; lng = $lngA } | ConvertTo-Json)
Check 'post location returns 200 with lat/lng' ($r.Status -eq 200 -and $r.Json.lat -eq $latA) "status=$($r.Status) $($r.Body)"
$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/location" '{"lat":123,"lng":106.7}'
Check 'latitude out of range returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/drivers/$($driverA.id)/live"
Check 'live state is readable from Redis' ($r.Status -eq 200 -and $r.Json.availability -eq 'ONLINE' -and $r.Json.lng -eq $lngA) "status=$($r.Status) $($r.Body)"
$r = Call PATCH "$DriverUrl/api/drivers/$($driverA.id)/status?status=ACTIVE"
Check 'change driver status returns 200' ($r.Status -eq 200 -and $r.Json.status -eq 'ACTIVE') "status=$($r.Status) $($r.Body)"
$r = Call PATCH "$DriverUrl/api/drivers/$($driverA.id)/status?status=NOPE"
Check 'invalid driver status returns 400' ($r.Status -eq 400) "status=$($r.Status)"

# A second online driver, near the first, so the accept race has a loser.
$driverB = NewDriver 'B'
Call POST "$DriverUrl/api/drivers/$($driverB.id)/online" '{}' | Out-Null
Call POST "$DriverUrl/api/drivers/$($driverB.id)/location" (@{ lat = $latB; lng = $lngB } | ConvertTo-Json) | Out-Null

# ---------------------------------------------------------------------------
Section '4. Trip request: sync payment authorize, async matching and inbox'
$tripBody = @{ passengerId = $rider.id; rideType = 'CAR'; pickupLat = $pickLat; pickupLng = $pickLng; destinationLat = $destLat; destinationLng = $destLng; paymentMethod = 'SIMULATED_CARD' } | ConvertTo-Json
$r = Call POST "$TripUrl/api/trips" $tripBody
Check 'create trip returns 201 SEARCHING with an estimated fare' ($r.Status -eq 201 -and $r.Json.status -eq 'SEARCHING' -and $r.Json.estimatedFare -gt 0) "status=$($r.Status) $($r.Body)"
$trip = $r.Json
$r = Call POST "$TripUrl/api/trips" ('{"passengerId":"' + $rider.id + '"}')
Check 'trip with missing fields returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$TripUrl/api/trips" '{"nope":'
Check 'trip with malformed JSON returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$TripUrl/api/trips/$($trip.id)"
Check 'get trip returns 200' ($r.Status -eq 200 -and $r.Json.id -eq $trip.id)
$r = Call GET "$TripUrl/api/trips?passengerId=$($rider.id)"
Check 'list trips filtered by passenger finds the trip' ($r.Status -eq 200 -and ($r.Json.items | Where-Object { $_.id -eq $trip.id }))
$r = Call GET "$TripUrl/api/trips/$uuidNone"
Check 'unknown trip returns 404' ($r.Status -eq 404) "status=$($r.Status)"

$pay = Call GET "$PaymentUrl/api/payments?tripId=$($trip.id)"
Check 'payment exists and is AUTHORIZED (sync authorize)' ($pay.Status -eq 200 -and $pay.Json.status -eq 'AUTHORIZED' -and $pay.Json.amount -eq $trip.estimatedFare) "status=$($pay.Status) $($pay.Body)"
$payment = $pay.Json
$r = Call GET "$PaymentUrl/api/payments/$($payment.id)"
Check 'get payment by id returns 200' ($r.Status -eq 200 -and $r.Json.tripId -eq $trip.id)

$offers = WaitFor { $o = Call GET "$MatchUrl/api/matching/trips/$($trip.id)/offers"; if ($o.Json -and @($o.Json).Count -ge 1) { $o } }
Check 'matching consumed trip.requested and made offers' ($null -ne $offers) 'no offers within 20s'
$driverIds = @($offers.Json | ForEach-Object { $_.driverId })
Check 'offer list includes both nearby online drivers' (($driverIds -contains $driverA.id) -and ($driverIds -contains $driverB.id)) "got $($driverIds -join ',')"
Check 'every offer is PENDING' (@($offers.Json | Where-Object { $_.status -ne 'PENDING' }).Count -eq 0)

$inbox = WaitFor { $i = Call GET "$NotifyUrl/api/notifications?userId=$($driverA.id)"; if ($i.Json | Where-Object { $_.type -eq 'match.offered' }) { $i } }
Check 'offered driver gets a match.offered notification' ($null -ne $inbox) 'not in driver inbox within 20s'
$inbox = WaitFor { $i = Call GET "$NotifyUrl/api/notifications?userId=$($rider.id)"; if ($i.Json | Where-Object { $_.type -eq 'trip.requested' }) { $i } }
Check 'rider gets a trip.requested notification' ($null -ne $inbox) 'not in rider inbox within 20s'

# ---------------------------------------------------------------------------
Section '5. Accept race: exactly one winner (optimistic lock)'
$tripId = $trip.id
$jobs = @($driverA.id, $driverB.id) | ForEach-Object {
  Start-Job -ArgumentList $TripUrl, $tripId, $_ -ScriptBlock { param($u, $t, $d) (& curl.exe -s -o NUL -w '%{http_code}' -X POST "$u/api/trips/$t/accept?driverId=$d") }
}
$codes = @($jobs | Wait-Job | Receive-Job)
$jobs | Remove-Job
Check 'two simultaneous accepts: one 200 and one 409' (($codes -contains '200') -and ($codes -contains '409') -and $codes.Count -eq 2) "codes=$($codes -join ',')"
$r = Call GET "$TripUrl/api/trips/$tripId"
Check 'trip is DRIVER_ASSIGNED with a driver' ($r.Json.status -eq 'DRIVER_ASSIGNED' -and $r.Json.driverId) "status=$($r.Json.status)"
$winner = $r.Json.driverId
Check 'the winner is one of the two drivers' ($winner -in @($driverA.id, $driverB.id))
$r = Call POST "$TripUrl/api/trips/$tripId/accept?driverId=$uuidNone"
Check 'accepting an already assigned trip returns 409' ($r.Status -eq 409) "status=$($r.Status)"

# ---------------------------------------------------------------------------
Section '6. Live location over SSE (realtime-gateway)'
$sse = Join-Path $env:TEMP "sse-$run.txt"
$stranger = NewUser 'stranger'
$r = Call GET "$GatewayUrl/live/trips/not-a-uuid/location?userId=$($rider.id)"
Check 'SSE with a bad tripId returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$ok = WaitFor { (Call GET "$GatewayUrl/live/trips/$tripId/location?userId=$($stranger.id)").Status -eq 403 } 15
Check 'SSE for someone who is not the passenger returns 403 (after pairing is written)' ([bool]$ok)
$r = Call GET "$GatewayUrl/live/trips/$([guid]::NewGuid())/location?userId=$($rider.id)"
Check 'SSE for a trip with no tracking returns 410' ($r.Status -eq 410) "status=$($r.Status)"

$proc = Start-Process -FilePath curl.exe -ArgumentList @('-sN', '-m', '40', '-o', $sse, "$GatewayUrl/live/trips/$tripId/location?userId=$($rider.id)") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
foreach ($p in @(@(($latA + 0.0005), ($lngA + 0.0005)), @(($latA + 0.0010), ($lngA + 0.0010)), @(($latA + 0.0020), ($lngA + 0.0020)))) {
  Call POST "$DriverUrl/api/drivers/$winner/location" (@{ lat = $p[0]; lng = $p[1] } | ConvertTo-Json) | Out-Null
  Start-Sleep -Milliseconds 1200
}
$got = WaitFor { (Test-Path $sse) -and ((Get-Content $sse -Raw) -match 'event:\s*location') } 10
Check 'passenger receives location events while the trip is active' ([bool]$got)
$text = if (Test-Path $sse) { Get-Content $sse -Raw } else { '' }
Check 'location event carries driverId, tripId, lat and lng' ($text -match $winner -and $text -match $tripId -and $text -match '"lat"' -and $text -match '"lng"')
Check 'location events have no id: line (latest value wins)' (-not ($text -match '(?m)^id:'))

# ---------------------------------------------------------------------------
Section '7. Trip lifecycle: arrive, start, complete'
$r = Call POST "$TripUrl/api/trips/$tripId/start"
Check 'starting before arriving returns 409 (state machine)' ($r.Status -eq 409) "status=$($r.Status)"
$r = Call POST "$TripUrl/api/trips/$tripId/arrive"
Check 'arrive returns 200 DRIVER_ARRIVED' ($r.Status -eq 200 -and $r.Json.status -eq 'DRIVER_ARRIVED') "status=$($r.Status) $($r.Body)"
$r = Call POST "$TripUrl/api/trips/$tripId/start"
Check 'start returns 200 IN_PROGRESS' ($r.Status -eq 200 -and $r.Json.status -eq 'IN_PROGRESS') "status=$($r.Status) $($r.Body)"
$r = Call POST "$TripUrl/api/trips/$tripId/complete"
Check 'complete returns 200 COMPLETED with a final fare' ($r.Status -eq 200 -and $r.Json.status -eq 'COMPLETED' -and $r.Json.finalFare -gt 0) "status=$($r.Status) $($r.Body)"
$r = Call POST "$TripUrl/api/trips/$tripId/cancel"
Check 'cancelling a completed trip returns 409' ($r.Status -eq 409) "status=$($r.Status)"

$ended = WaitFor { (Test-Path $sse) -and ((Get-Content $sse -Raw) -match 'event:\s*trip-ended') } 15
Check 'passenger stream receives trip-ended' ([bool]$ended)
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
$r = WaitFor { $x = Call GET "$GatewayUrl/live/trips/$tripId/location?userId=$($rider.id)"; if ($x.Status -eq 410) { $x } } 10
Check 'reconnecting after the trip ended returns 410' ($null -ne $r)
Remove-Item $sse -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
Section '8. Async capture and the full rider inbox'
$paid = WaitFor { $x = Call GET "$PaymentUrl/api/payments/$($payment.id)"; if ($x.Json.status -eq 'PAID') { $x } } 20
Check 'payment moved AUTHORIZED -> PAID with no HTTP call (trip.completed event)' ($null -ne $paid) 'still not PAID after 20s'
$want = 'trip.requested', 'driver.accepted', 'driver.arrived', 'trip.started', 'trip.completed', 'payment.succeeded'
$full = WaitFor { $i = Call GET "$NotifyUrl/api/notifications?userId=$($rider.id)"; $types = @($i.Json | ForEach-Object { $_.type }); if (@($want | Where-Object { $types -notcontains $_ }).Count -eq 0) { $i } } 25
Check 'rider inbox has every lifecycle event' ($null -ne $full) 'missing events after 25s'
$types = @($full.Json | ForEach-Object { $_.type })
# The inbox contract is "oldest first by arrival" (createdAt). Arrival order is not
# always lifecycle order: SQS standard queues do not keep order, so on AWS
# payment.succeeded (trip.completed -> payment queue -> payment-service -> topic) can
# arrive before trip.completed itself. Check the contract, and report the lifecycle
# order separately as information.
$created = @($full.Json | ForEach-Object { [datetime]$_.createdAt })
$sorted = @($created | Sort-Object)
Check 'inbox lists items oldest first (by arrival)' ((($created | ForEach-Object { $_.Ticks }) -join ',') -eq (($sorted | ForEach-Object { $_.Ticks }) -join ',')) "createdAt not ascending"
$order = @($want | ForEach-Object { [array]::IndexOf($types, $_) })
if (($order -join ',') -ne (($order | Sort-Object) -join ',')) {
  Write-Host "  info  arrival order differs from lifecycle order: $($types -join ', ')" -ForegroundColor Yellow
}
$mid = $full.Json[1].id
$r = Call GET "$NotifyUrl/api/notifications?userId=$($rider.id)&since=$($full.Json[0].id)"
Check '?since= returns only items after that id' ($r.Status -eq 200 -and @($r.Json).Count -eq (@($full.Json).Count - 1) -and $r.Json[0].id -eq $mid)
$r = Call POST "$NotifyUrl/api/notifications/$($full.Json[0].id)/read"
Check 'mark notification read returns 2xx and sets readAt' ($r.Status -in 200, 204 -and ($r.Status -eq 204 -or $r.Json.readAt))
$r = Call GET "$NotifyUrl/api/notifications?userId=$($rider.id)&limit=1"
Check 'limit=1 returns a single item' ($r.Status -eq 200 -and @($r.Json).Count -eq 1)
$r = Call GET "$NotifyUrl/api/notifications?userId=not-a-uuid"
Check 'inbox with a bad userId returns 400' ($r.Status -eq 400) "status=$($r.Status)"

# ---------------------------------------------------------------------------
Section '9. Cancellation releases the hold'
$rider2 = NewUser 'rider2'
$r = Call POST "$TripUrl/api/trips" (@{ passengerId = $rider2.id; rideType = 'CAR'; pickupLat = $pickLat; pickupLng = $pickLng; destinationLat = $destLat2; destinationLng = $destLng2; paymentMethod = 'SIMULATED_CARD' } | ConvertTo-Json)
$trip2 = $r.Json
Check 'second trip created' ($r.Status -eq 201) "status=$($r.Status) $($r.Body)"
$r = Call POST "$TripUrl/api/trips/$($trip2.id)/cancel"
Check 'cancel returns 200 CANCELLED' ($r.Status -eq 200 -and $r.Json.status -eq 'CANCELLED') "status=$($r.Status) $($r.Body)"
$rel = WaitFor { $x = Call GET "$PaymentUrl/api/payments?tripId=$($trip2.id)"; if ($x.Json.status -eq 'RELEASED') { $x } } 20
Check 'payment moved AUTHORIZED -> RELEASED (trip.cancelled event)' ($null -ne $rel) 'not RELEASED after 20s'
$c = WaitFor { $i = Call GET "$NotifyUrl/api/notifications?userId=$($rider2.id)"; if ($i.Json | Where-Object { $_.type -eq 'trip.cancelled' }) { $i } } 20
Check 'rider is told the trip was cancelled' ($null -ne $c)

# ---------------------------------------------------------------------------
Section '10. payment-service validation'
$r = Call POST "$PaymentUrl/api/payments" ('{"tripId":"' + $uuidNone + '"}')
Check 'payment with missing fields returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$PaymentUrl/api/payments" (@{ tripId = $uuidNone; amount = -5; currency = 'VND'; method = 'CASH'; idempotencyKey = "k-$run" } | ConvertTo-Json)
Check 'payment with a negative amount returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$PaymentUrl/api/payments/$uuidNone"
Check 'unknown payment returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$idem = @{ tripId = [guid]::NewGuid().ToString(); amount = 50000; currency = 'VND'; method = 'SIMULATED_CARD'; idempotencyKey = "idem-$run"; passengerId = $rider.id } | ConvertTo-Json
$a1 = Call POST "$PaymentUrl/api/payments" $idem
$a2 = Call POST "$PaymentUrl/api/payments" $idem
Check 'same idempotencyKey twice returns the same payment (no double hold)' ($a1.Status -in 200, 201 -and $a2.Status -in 200, 201 -and $a1.Json.id -eq $a2.Json.id) "ids=$($a1.Json.id) / $($a2.Json.id) status=$($a1.Status),$($a2.Status)"

# ---------------------------------------------------------------------------
Section '11. Going offline removes the driver from matching'
$r = Call POST "$DriverUrl/api/drivers/$($driverA.id)/offline" '{}'
Check 'go offline returns 204' ($r.Status -eq 204) "status=$($r.Status) $($r.Body)"
$r = Call GET "$DriverUrl/api/drivers/$($driverA.id)/live"
Check 'live state is gone after going offline (404)' ($r.Status -eq 404) "status=$($r.Status) $($r.Body)"
Call POST "$DriverUrl/api/drivers/$($driverB.id)/offline" '{}' | Out-Null
Start-Sleep -Seconds 2
$rider3 = NewUser 'rider3'
$r = Call POST "$TripUrl/api/trips" (@{ passengerId = $rider3.id; rideType = 'CAR'; pickupLat = $pickLat; pickupLng = $pickLng; destinationLat = $destLat2; destinationLng = $destLng2; paymentMethod = 'CASH' } | ConvertTo-Json)
Check 'trip with CASH payment is created' ($r.Status -eq 201) "status=$($r.Status) $($r.Body)"
$t3 = $r.Json
Start-Sleep -Seconds 4
$o = Call GET "$MatchUrl/api/matching/trips/$($t3.id)/offers"
$offered = @($o.Json | ForEach-Object { $_.driverId })
Check 'offline drivers receive no offer' (($offered -notcontains $driverA.id) -and ($offered -notcontains $driverB.id)) "offered=$($offered -join ',')"
if ($t3.id) { Call POST "$TripUrl/api/trips/$($t3.id)/cancel" | Out-Null }

# ---------------------------------------------------------------------------
Section '12. matching-service direct API (positions, match)'
$mDriver = [guid]::NewGuid().ToString()
$mLat = [math]::Round($latA + 0.1, 4); $mLng = [math]::Round($lngA + 0.1, 4)
$r = Call POST "$MatchUrl/api/matching/positions" (@{ driverId = $mDriver; vehicleType = 'CAR'; lat = $mLat; lng = $mLng } | ConvertTo-Json)
Check 'report a driver position returns 2xx' ($r.Status -in 200, 202, 204) "status=$($r.Status) $($r.Body)"
$r = Call POST "$MatchUrl/api/matching/positions" (@{ driverId = $mDriver; vehicleType = 'CAR'; lat = 999; lng = $mLng } | ConvertTo-Json)
Check 'position with latitude out of range returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$mTrip = [guid]::NewGuid().ToString()
$r = Call POST "$MatchUrl/api/matching/match" (@{ tripId = $mTrip; vehicleType = 'CAR'; pickupLat = $mLat; pickupLng = $mLng; radiusMeters = 2000; limit = 3 } | ConvertTo-Json)
Check 'match returns 200 and finds the reported driver' ($r.Status -eq 200 -and $r.Body -match $mDriver) "status=$($r.Status) $($r.Body)"
$r = Call GET "$MatchUrl/api/matching/trips/$mTrip/offers"
Check 'offers for a matched trip can be read back' ($r.Status -eq 200 -and @($r.Json).Count -ge 1) "status=$($r.Status) $($r.Body)"
$r = Call POST "$MatchUrl/api/matching/match" (@{ vehicleType = 'CAR' } | ConvertTo-Json)
Check 'match with missing fields returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$MatchUrl/api/matching/match" (@{ tripId = $mTrip; vehicleType = 'CAR'; pickupLat = $mLat; pickupLng = $mLng; limit = 0 } | ConvertTo-Json)
Check 'match with limit 0 returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$MatchUrl/api/matching/trips/not-a-uuid/offers"
Check 'offers with a bad trip id returns 400' ($r.Status -eq 400) "status=$($r.Status)"

# ---------------------------------------------------------------------------
Section '13. Input validation across services'
$r = Call GET "$TripUrl/api/trips/not-a-uuid"
Check 'trip: bad id returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$TripUrl/api/trips?limit=-1"
Check 'trip: negative limit returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$TripUrl/api/trips?status=NOPE"
Check 'trip: unknown status filter returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$TripUrl/api/trip-offers/$uuidNone"
Check 'trip offer: unknown id returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/drivers/not-a-uuid"
Check 'driver: bad id returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/drivers/$uuidNone"
Check 'driver: unknown id returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$r = Call GET "$DriverUrl/api/vehicles/$uuidNone"
Check 'vehicle: unknown id returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$r = Call GET "$PaymentUrl/api/payments/not-a-uuid"
Check 'payment: bad id returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call GET "$NotifyUrl/api/notifications"
Check 'notifications: missing userId returns 400' ($r.Status -eq 400) "status=$($r.Status)"
$r = Call POST "$NotifyUrl/api/notifications/$uuidNone/read"
Check 'notifications: marking an unknown id read returns 404' ($r.Status -eq 404) "status=$($r.Status)"
$r = Call GET "$UserUrl/api/users?limit=-1"
Check 'user: negative limit returns 400' ($r.Status -eq 400) "status=$($r.Status)"

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:Pass, $script:Fail) -ForegroundColor $(if ($script:Fail -eq 0) { 'Green' } else { 'Red' })
if ($script:Fail -gt 0) { $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }; exit 1 }
exit 0
