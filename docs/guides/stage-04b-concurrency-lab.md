# Stage 4B - The Concurrency Lab (accept-ride)  [BUILT & VERIFIED]

The signature problem of the whole project: one ride is offered to several nearby drivers.
If two tap **Accept** at the same instant, the system must guarantee **exactly one winner**.

This stage is already implemented and proven in `trip-service`. This guide explains what
was built, why it works, and how to re-run the proof. Conceptual background and diagrams:
`../PLAN_LOCAL_VS_CLOUD.md` section 3.

---

## Result (the proof)

A test fires 50 drivers accepting the same trip simultaneously:

```
WINNERS=1 LOSERS=49
Tests run: 1, Failures: 0, Errors: 0
```

Database afterwards - one assignment, version incremented exactly once:

```
     status      |              driver_id               | version
-----------------+--------------------------------------+---------
 DRIVER_ASSIGNED | 3c381056-...-6b9fe7391e96            |       1
```

---

## The mechanism: optimistic locking

`trip-service` uses the `version` column from the DBML (`@Version` on the `Trip` entity).

**Flow of a single accept** (`TripService.acceptTrip`, one `@Transactional`):
1. Load the trip.
2. `trip.acceptBy(driverId, now)` throws `TripNotAcceptableException` if status is not
   SEARCHING (the business guard).
3. On commit JPA runs:
   `UPDATE trips SET driver_id=?, status=?, version=version+1 WHERE id=? AND version=?`

**Why exactly one wins under a race:** even if two threads both read `version=0` and both
pass the SEARCHING guard, only ONE `UPDATE ... WHERE version=0` matches a row. The first to
commit bumps the version to 1. The second matches 0 rows, and JPA throws
`OptimisticLockingFailureException`. The loser is rejected with 409; it can never overwrite
the winner. The ride is never assigned twice.

---

## Files involved

- `entity/Trip.java` - already had `@Version`; added a creation constructor and
  `acceptBy(driverId, now)` holding the SEARCHING guard.
- `exception/TripNotAcceptableException.java` - new; -> 409.
- `exception/GlobalExceptionHandler.java` - maps `TripNotAcceptableException` AND
  `OptimisticLockingFailureException` to 409 (both mean "someone else won").
- `dto/request/CreateTripRequest.java` - new; minimal trip creation.
- `service/TripService.java` - added `createTrip` and the concurrency-critical `acceptTrip`.
- `controller/TripController.java` - added `POST /api/trips` and `POST /api/trips/{id}/accept`.
- `src/test/.../service/AcceptTripConcurrencyTest.java` - the 50-driver race proof.
- `docker-compose.yml` + `application.yaml` - trip-db on port 5435, service on port 8082.

---

## Re-run the proof

```powershell
cd d:\GitRepo\RideNow\trip-service
docker compose up -d                 # start trip-db (port 5435)
.\mvnw.cmd test "-Dtest=AcceptTripConcurrencyTest"
```

Look for `WINNERS=1 LOSERS=49` and `Failures: 0`.

Inspect the database:

```powershell
docker exec trip-db psql -U trip -d trip_service -c "SELECT status, driver_id, version FROM trips WHERE status = 'DRIVER_ASSIGNED';"
```

Try it live (two terminals):

```powershell
# start the service
.\mvnw.cmd spring-boot:run

# create a SEARCHING trip
$t = Invoke-RestMethod -Uri "http://localhost:8082/api/trips" -Method Post -ContentType "application/json" `
  -Body (@{ passengerId=[guid]::NewGuid().ToString(); rideType="CAR"; pickupLat=10.76; pickupLng=106.66; destinationLat=10.77; destinationLng=106.70 } | ConvertTo-Json)

# first driver wins (200), second gets 409
Invoke-RestMethod -Uri "http://localhost:8082/api/trips/$($t.id)/accept?driverId=$([guid]::NewGuid())" -Method Post
Invoke-RestMethod -Uri "http://localhost:8082/api/trips/$($t.id)/accept?driverId=$([guid]::NewGuid())" -Method Post  # 409
```

---

## Optimistic vs pessimistic (the comparison)

- **Optimistic (used here):** no lock held; the version check at commit decides the winner.
  Best for "many readers, rare conflict" - exactly the one-ride-many-drivers shape. Scales well.
- **Pessimistic (`SELECT ... FOR UPDATE`):** the row is locked while one driver decides; others
  wait. Simpler to reason about, but holds a lock and can bottleneck under heavy contention.
  Try it as an experiment: a `@Lock(LockModeType.PESSIMISTIC_WRITE)` finder and compare.

---

## Local -> cloud

Nothing here changes in the cloud. `@Version`, transactions, and `FOR UPDATE` are
PostgreSQL + JPA features; they behave identically on local Postgres and on Amazon RDS.
You solved the signature problem once, locally, and it carries straight to production.

---

## Definition of Done  [met]

- [x] Trip has a `@Version` optimistic lock
- [x] accept-ride is one `@Transactional` method in trip-service
- [x] version conflict -> clean 409 ("taken by another driver")
- [x] concurrency test proves exactly one of 50 simultaneous accepts wins
- [x] database confirms a single assignment