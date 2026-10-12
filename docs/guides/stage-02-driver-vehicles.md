# Stage 2 - Finish driver-service's own domain

Goal: make driver-service genuinely useful at its own boundary before adding more services.
By the end, a driver can register vehicles, you can list them, and you can change a
driver's status. Same layered pattern as Stage 1, repeated until it is muscle memory.

Prerequisites: Stage 1 done. The `driver-db` container runs (`docker compose up -d` in
`driver-service`). You can create and read a driver.

---

## Important conventions for every file you create

- Save Java files as **UTF-8 without BOM**. In VS Code the status bar should say "UTF-8",
  not "UTF-8 with BOM". A BOM makes the Java compiler fail with `illegal character: '\ufeff'`.
- `record` for DTOs. Constructor injection via `@RequiredArgsConstructor`. No field `@Autowired`.
- Controllers stay thin. Business rules and `@Transactional` live in the service.
- Validate request DTOs with Jakarta annotations and `@Valid` at the controller.

---

## Step 2.1 - Add a vehicle creation constructor to the Vehicle entity

**Why:** like `Driver`, the `Vehicle` entity is currently read-only (`@Getter` +
`@NoArgsConstructor`). The service needs a way to build a new vehicle with server-owned
defaults (id, active=true, timestamps).

**Do:** open
`driver-service/src/main/java/cloudnative/microservices/driver/entity/Vehicle.java`
and add this constructor inside the class (after the fields):

```java
    public Vehicle(UUID id, UUID driverId, String plateNumber, VehicleType vehicleType,
                   String brand, String model, String color, Instant now) {
        this.id = id;
        this.driverId = driverId;
        this.plateNumber = plateNumber;
        this.vehicleType = vehicleType;
        this.brand = brand;
        this.model = model;
        this.color = color;
        this.active = true;
        this.createdAt = now;
        this.updatedAt = now;
    }
```

**Verify:** the file still compiles later in Step 2.7. For now just save it.

---

## Step 2.2 - Add a request DTO for creating a vehicle

**Why:** the API boundary needs a validated shape for incoming vehicle data. The client
provides the vehicle facts; the server owns id/active/timestamps.

**Do:** create
`driver-service/src/main/java/cloudnative/microservices/driver/dto/request/CreateVehicleRequest.java`:

```java
package cloudnative.microservices.driver.dto.request;

import cloudnative.microservices.driver.entity.VehicleType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateVehicleRequest(

        @NotBlank(message = "plateNumber is required")
        String plateNumber,

        @NotNull(message = "vehicleType is required (MOTORBIKE or CAR)")
        VehicleType vehicleType,

        String brand,
        String model,
        String color
) {
}
```

Note: `driverId` is NOT in the body - it comes from the URL path (`/drivers/{driverId}/vehicles`),
which ties the vehicle to a driver explicitly.

---

## Step 2.3 - Add repository query methods

**Why:** we must enforce the unique `plate_number` rule and list a driver's vehicles.
Spring Data derives the SQL from the method names.

**Do:** replace the body of
`driver-service/src/main/java/cloudnative/microservices/driver/repository/VehicleRepository.java`:

```java
package cloudnative.microservices.driver.repository;

import cloudnative.microservices.driver.entity.Vehicle;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VehicleRepository extends JpaRepository<Vehicle, UUID> {

    boolean existsByPlateNumber(String plateNumber);

    List<Vehicle> findByDriverId(UUID driverId);
}
```

---

## Step 2.4 - Add service methods

**Why:** business rules live here: the driver must exist, the plate must be unique, and
status changes must be valid. Mapping entity -> response DTO also happens here.

**Do:** open
`driver-service/src/main/java/cloudnative/microservices/driver/service/DriverService.java`
and add these methods (and the imports they need: `java.util.List`,
`CreateVehicleRequest`, `DriverStatus`).

```java
    @Transactional
    public VehicleResponse addVehicle(UUID driverId, CreateVehicleRequest request) {
        // The driver must exist (and is owned by THIS service) before we attach a vehicle.
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
        if (vehicleRepository.existsByPlateNumber(request.plateNumber())) {
            throw new DuplicateResourceException(
                    "Plate number already registered: " + request.plateNumber());
        }

        Vehicle vehicle = new Vehicle(
                UUID.randomUUID(), driverId, request.plateNumber(), request.vehicleType(),
                request.brand(), request.model(), request.color(), java.time.Instant.now());
        Vehicle saved = vehicleRepository.save(vehicle);
        return toVehicleResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<VehicleResponse> listVehicles(UUID driverId) {
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
        return vehicleRepository.findByDriverId(driverId).stream()
                .map(this::toVehicleResponse)
                .toList();
    }

    @Transactional
    public DriverResponse changeStatus(UUID driverId, DriverStatus newStatus) {
        Driver driver = driverRepository.findById(driverId)
                .orElseThrow(() -> new ResourceNotFoundException("Driver", driverId));
        driver.changeStatus(newStatus, java.time.Instant.now());
        return toResponse(driver); // JPA flushes the change on transaction commit
    }

    private VehicleResponse toVehicleResponse(Vehicle v) {
        return new VehicleResponse(
                v.getId(), v.getDriverId(), v.getPlateNumber(), v.getVehicleType(),
                v.getBrand(), v.getModel(), v.getColor(), v.isActive(),
                v.getCreatedAt(), v.getUpdatedAt());
    }
```

**Also** refactor the existing `getVehicle` to reuse `toVehicleResponse` (optional tidy-up).

---

## Step 2.5 - Add the status-change behavior to the Driver entity

**Why:** state changes belong on the entity, not scattered in the service. Keeping
"how a driver changes status" in one place is good domain modeling.

**Do:** add to `Driver.java`:

```java
    public void changeStatus(DriverStatus newStatus, Instant now) {
        this.status = newStatus;
        this.updatedAt = now;
    }
```

---

## Step 2.6 - Add the controller endpoints

**Do:** add to `DriverController.java` (and import `CreateVehicleRequest`, `DriverStatus`,
`java.util.List`, `PatchMapping`, `PostMapping`):

```java
    @PostMapping("/drivers/{driverId}/vehicles")
    public ResponseEntity<VehicleResponse> addVehicle(
            @PathVariable UUID driverId,
            @Valid @RequestBody CreateVehicleRequest request) {
        VehicleResponse created = driverService.addVehicle(driverId, request);
        return ResponseEntity
                .created(URI.create("/api/vehicles/" + created.id()))
                .body(created);
    }

    @GetMapping("/drivers/{driverId}/vehicles")
    public List<VehicleResponse> listVehicles(@PathVariable UUID driverId) {
        return driverService.listVehicles(driverId);
    }

    @PatchMapping("/drivers/{driverId}/status")
    public DriverResponse changeStatus(
            @PathVariable UUID driverId,
            @RequestParam DriverStatus status) {
        return driverService.changeStatus(driverId, status);
    }
```

---

## Step 2.7 - Compile

```powershell
cd d:\GitRepo\RideNow\driver-service
.\mvnw.cmd -q compile
```

Expect no output and exit code 0. If you see `illegal character: '\ufeff'`, a file was
saved with a BOM - re-save it as UTF-8 (no BOM).

---

## Step 2.8 - Run and test the full flow

Start the service:

```powershell
cd d:\GitRepo\RideNow\driver-service
.\mvnw.cmd spring-boot:run
```

In a SECOND terminal, create a driver, then a vehicle, then list it:

```powershell
# 1. Create a driver
$uid = [guid]::NewGuid().ToString()
$drv = Invoke-RestMethod -Uri "http://localhost:8080/api/drivers" -Method Post `
  -ContentType "application/json" `
  -Body (@{ userId=$uid; licenseNumber=("LIC-"+(Get-Random)) } | ConvertTo-Json)
$drv

# 2. Add a vehicle to that driver
$veh = Invoke-RestMethod -Uri "http://localhost:8080/api/drivers/$($drv.id)/vehicles" -Method Post `
  -ContentType "application/json" `
  -Body (@{ plateNumber=("51A-"+(Get-Random -Max 99999)); vehicleType="CAR"; brand="Toyota"; model="Vios"; color="white" } | ConvertTo-Json)
$veh

# 3. List the driver's vehicles
Invoke-RestMethod -Uri "http://localhost:8080/api/drivers/$($drv.id)/vehicles"

# 4. Suspend the driver
Invoke-RestMethod -Uri "http://localhost:8080/api/drivers/$($drv.id)/status?status=SUSPENDED" -Method Patch
```

**Verify in the database:**

```powershell
docker exec driver-db psql -U driver -d driver_service -c "SELECT plate_number, vehicle_type, active FROM vehicles;"
```

Stop the service with Ctrl+C in its terminal when done.

---

## Step 2.9 - Error cases to try (prove the rules work)

```powershell
# Duplicate plate -> 409 Conflict
# (repeat step 2 with the same plateNumber)

# Vehicle for a non-existent driver -> 404
Invoke-RestMethod -Uri "http://localhost:8080/api/drivers/00000000-0000-0000-0000-000000000000/vehicles" -Method Post -ContentType "application/json" -Body (@{ plateNumber="X"; vehicleType="CAR" } | ConvertTo-Json)

# Missing plateNumber -> 400 Bad Request
Invoke-RestMethod -Uri "http://localhost:8080/api/drivers/$($drv.id)/vehicles" -Method Post -ContentType "application/json" -Body (@{ vehicleType="CAR" } | ConvertTo-Json)
```

---

## Step 2.10 - Write unit tests for the service rules

**Why:** the AGENTS.md rule: add focused tests with behavior changes. Prefer unit tests
for service rules. Mock the repositories so the test does not need a database.

Create `driver-service/src/test/java/cloudnative/microservices/driver/service/DriverServiceTest.java`
with tests for: addVehicle rejects duplicate plate (409), addVehicle rejects unknown
driver (404), listVehicles returns mapped responses. Use Mockito `@Mock` for the
repositories and `@InjectMocks` for `DriverService`.

Run:

```powershell
.\mvnw.cmd test
```

---

## Definition of Done

- [ ] A driver and their vehicle(s) can be created and listed over HTTP
- [ ] Duplicate plate -> 409, unknown driver -> 404, missing field -> 400
- [ ] Driver status can be changed and persists
- [ ] Service-rule unit tests pass

When all four pass, mark Stage 2 `[x]` in `../LEARNING_PATH.md` and move to Stage 3.