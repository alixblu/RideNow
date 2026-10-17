# Requirements Document

## Introduction

RideNow Frontend is a single navigable web application that presents the full RideNow product UI as a three-app shell: a Rider app, a Driver app, and an Admin console. It is a new top-level app in the monorepo (not a Spring Boot service) built with React, TypeScript, and Vite.

The frontend talks to RideNow backend microservices through a single configurable API base URL (gateway-style). Because no gateway exists yet, the application documents a local fallback that maps HTTP path prefixes to individual Spring Boot services. Each backend domain is reached through a per-service client abstraction that is swappable behind configuration: a client is either a real HTTP implementation or a mock implementation of the same documented contract.

Flows backed by implemented endpoints (driver management, vehicle management, driver status change, and user create/get) are LIVE. Flows for trip request, trip lifecycle, matching, payment, and notification are STUBBED: they are mock implementations behind a documented future contract. The LIVE/STUBBED distinction is an internal, architectural concern expressed in code structure; stubbed screens look identical to live ones and carry no visible marker in the UI.

Authentication is out of scope for this feature. A development-only identity switcher sets the current rider, driver, or admin by identifier, and is designed to be replaced by real authentication later.

Per-requirement implementation note: each requirement below is tagged **(LIVE)** or **(STUBBED)** to record whether its underlying data flows are served by implemented backend endpoints or by mock clients behind a documented contract. These tags are internal architecture notes and SHALL NOT surface as visible UI markers.

## Glossary

- **Frontend**: The RideNow Frontend web application described by this document.
- **App_Shell**: The top-level navigable container that hosts the Rider_App, Driver_App, and Admin_Console and provides navigation among them.
- **Rider_App**: The in-shell application area presenting rider-facing flows (trip request, trip lifecycle view, payment view, notifications view).
- **Driver_App**: The in-shell application area presenting driver-facing flows (driver profile, vehicles, status, assigned trips).
- **Admin_Console**: The in-shell application area presenting administrative flows (user management, driver management, cross-domain lookups).
- **Identity_Switcher**: The development-only control that sets the current acting rider, driver, or admin by identifier without authentication.
- **Current_Identity**: The rider, driver, or admin identifier currently selected in the Identity_Switcher, used as the acting principal for requests.
- **Service_Client**: A per-service module exposing a documented contract for one backend domain, implemented as either a real HTTP client or a mock client, selected by configuration.
- **Live_Client**: A Service_Client implementation that performs real HTTP requests against a backend microservice.
- **Mock_Client**: A Service_Client implementation that returns in-memory data conforming to the same documented contract as its Live_Client counterpart.
- **API_Base_URL**: The single configurable base URL used as the gateway-style origin for backend requests.
- **Path_Prefix_Map**: The local fallback configuration that maps request path prefixes to individual backend service origins when no gateway is present.
- **Driver_Status**: The driver lifecycle state, one of ACTIVE or SUSPENDED.
- **Vehicle_Type**: The vehicle category, one of MOTORBIKE or CAR.
- **Trip_Status**: The trip lifecycle state, one of REQUESTED, SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, or CANCELLED.
- **Payment_Status**: The payment lifecycle state, one of PENDING, PROCESSING, PAID, or FAILED.

## Requirements

### Requirement 1: Three-app shell and navigation (LIVE)

**User Story:** As a user of the RideNow demo, I want one application that lets me move between the rider, driver, and admin experiences, so that I can explore the whole product without separate deployments.

#### Acceptance Criteria

1. THE App_Shell SHALL present three selectable application areas: Rider_App, Driver_App, and Admin_Console.
2. WHEN a user selects an application area, THE App_Shell SHALL display that area's primary screen and indicate which area is active.
3. THE App_Shell SHALL preserve the Current_Identity selection when a user navigates between application areas.
4. WHEN a user requests a route that does not exist, THE App_Shell SHALL display a not-found view that includes a visible navigation control that returns the user to a valid application area.
5. THE Frontend SHALL be a top-level application in the monorepo that is built and run independently of any Spring Boot service.

### Requirement 2: Development identity switcher (LIVE)

**User Story:** As a developer demonstrating RideNow, I want to set who I am acting as without logging in, so that I can exercise rider, driver, and admin flows quickly.

#### Acceptance Criteria

1. THE Identity_Switcher SHALL allow selection of a role from rider, driver, and admin.
2. THE Identity_Switcher SHALL allow entry of an identifier value for the selected role to establish the Current_Identity.
3. WHEN the Current_Identity is set, THE Frontend SHALL use the Current_Identity as the acting principal for subsequent requests that require one.
4. WHILE no Current_Identity is set for a role, THE Frontend SHALL display a prompt directing the user to set an identity before performing role-specific actions.
5. THE Identity_Switcher SHALL expose its current selection through a replaceable module boundary so that a real authentication mechanism can supply the Current_Identity later without changing calling screens.
6. THE Frontend SHALL operate without login, signup, session tokens, or credential storage.

### Requirement 3: Configurable base URL and local path-prefix fallback (LIVE)

**User Story:** As a developer, I want a single configurable backend origin with a documented local fallback to individual services, so that the app works today without a gateway and later points at one by changing configuration.

#### Acceptance Criteria

1. THE Frontend SHALL read a single API_Base_URL from configuration at startup.
2. WHERE a gateway origin is configured as the API_Base_URL, THE Frontend SHALL send backend requests to the API_Base_URL using documented path prefixes.
3. WHERE no gateway is configured, THE Frontend SHALL resolve each request through the Path_Prefix_Map that maps the `/api/drivers` and `/api/vehicles` prefixes to the driver-service origin and the `/api/users` prefix to the user-service origin.
4. THE Path_Prefix_Map SHALL define placeholder entries for the trip, matching, payment, and notification prefixes so that those domains have a documented mapping target when their services exist.
5. WHEN configuration changes the API_Base_URL or Path_Prefix_Map, THE Frontend SHALL route requests according to the changed configuration without source changes to calling screens.

### Requirement 4: Swappable per-service client abstraction (LIVE)

**User Story:** As a developer, I want each backend domain behind a documented client contract that can be a real or mock implementation chosen by configuration, so that unimplemented services are indistinguishable from live ones at the screen level.

#### Acceptance Criteria

1. THE Frontend SHALL define one Service_Client per backend domain, each exposing a documented contract that is identical for its Live_Client and Mock_Client implementations.
2. WHEN a Service_Client is resolved, THE Frontend SHALL select the Live_Client or Mock_Client implementation based on configuration for that domain.
3. THE Frontend SHALL ensure that calling screens depend only on the Service_Client contract and not on whether a Live_Client or Mock_Client is active.
4. THE Mock_Client implementations SHALL return data conforming to the same documented contract as the corresponding Live_Client implementations so that stubbed screens render identically to live screens.
5. THE Frontend SHALL NOT render any visible indicator that distinguishes a Mock_Client-backed screen from a Live_Client-backed screen.

### Requirement 5: Driver profile management (LIVE)

**User Story:** As an admin or driver, I want to create and view driver profiles, so that I can register drivers and inspect their current standing.

#### Acceptance Criteria

1. WHEN a user submits a driver creation form with a user identifier and a license number, THE Driver_App SHALL send a create-driver request to the driver-service and display the created driver on success.
2. IF a driver creation request omits the user identifier or the license number, THEN THE Frontend SHALL prevent submission and display a field-level validation message.
3. WHEN a user opens a driver profile by driver identifier, THE Frontend SHALL request the driver from the driver-service and display the driver identifier, user identifier, license number, Driver_Status, average rating, total trips, and timestamps.
4. IF a requested driver identifier does not exist, THEN THE Frontend SHALL display a not-found message for that driver.
5. IF a driver creation request is rejected because the user identifier or license number already exists, THEN THE Frontend SHALL display the conflict as a user-facing error without exposing backend stack traces.

### Requirement 6: Vehicle management (LIVE)

**User Story:** As a driver or admin, I want to register and list a driver's vehicles, so that I can manage the vehicles associated with a driver.

#### Acceptance Criteria

1. WHEN a user submits a vehicle creation form for a driver with a plate number and a Vehicle_Type, THE Driver_App SHALL send an add-vehicle request to the driver-service for that driver and display the created vehicle on success.
2. IF a vehicle creation request omits the plate number or the Vehicle_Type, THEN THE Frontend SHALL prevent submission and display a field-level validation message.
3. THE Frontend SHALL restrict Vehicle_Type selection to MOTORBIKE and CAR.
4. WHEN a user opens a driver's vehicle list, THE Frontend SHALL request the vehicles for that driver from the driver-service and display each vehicle's plate number, Vehicle_Type, brand, model, color, and active state.
5. WHEN a user opens a vehicle by vehicle identifier, THE Frontend SHALL request the vehicle from the driver-service and display its details.
6. IF a vehicle creation request is rejected because the plate number already exists, THEN THE Frontend SHALL display the conflict as a user-facing error without exposing backend stack traces.

### Requirement 7: Driver status change (LIVE)

**User Story:** As an admin, I want to change a driver's status, so that I can activate or suspend a driver.

#### Acceptance Criteria

1. THE Frontend SHALL restrict driver status selection to ACTIVE and SUSPENDED.
2. WHEN a user submits a status change for a driver, THE Frontend SHALL send a status-change request to the driver-service for that driver with the selected Driver_Status and display the updated driver on success.
3. IF a status change request targets a driver identifier that does not exist, THEN THE Frontend SHALL display a not-found message for that driver.

### Requirement 8: User create and view (LIVE)

**User Story:** As an admin, I want to create and view users, so that I can register riders and inspect user records.

#### Acceptance Criteria

1. WHEN a user submits a user creation form, THE Admin_Console SHALL send a create-user request to the user-service and display the created user on success.
2. IF a user creation request fails field validation, THEN THE Frontend SHALL prevent submission and display field-level validation messages.
3. WHEN a user opens a user record by user identifier, THE Frontend SHALL request the user from the user-service and display the returned user details.
4. IF a requested user identifier does not exist, THEN THE Frontend SHALL display a not-found message for that user.
5. THE Frontend SHALL confine user-facing surfaces to the create-user and get-user capabilities that the user-service currently provides.

### Requirement 9: Rider trip request and trip lifecycle (STUBBED)

**User Story:** As a rider, I want to request a trip and follow its progress, so that I can experience the booking flow before the trip service exists.

#### Acceptance Criteria

1. WHEN a rider submits a trip request with pickup coordinates, destination coordinates, and a ride type, THE Rider_App SHALL send the request through the trip Service_Client and display the created trip with Trip_Status REQUESTED.
2. THE Rider_App SHALL display the Trip_Status using the defined set REQUESTED, SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, and CANCELLED.
3. WHEN a rider opens an existing trip, THE Rider_App SHALL request the trip through the trip Service_Client and display its current Trip_Status and trip details.
4. WHEN a rider cancels an in-progress-eligible trip, THE Rider_App SHALL send a cancellation through the trip Service_Client and display the trip with Trip_Status CANCELLED.
5. THE trip Service_Client contract SHALL be defined so that its Mock_Client and a future Live_Client expose identical request and response shapes.
6. THE Rider_App SHALL exclude live-location and real-time map features from trip lifecycle screens.

### Requirement 10: Matching view (STUBBED)

**User Story:** As a rider or admin, I want to see matching progress for a trip, so that I can understand how a driver is selected.

#### Acceptance Criteria

1. WHILE a trip has Trip_Status SEARCHING, THE Rider_App SHALL display a matching-in-progress view sourced from the matching Service_Client.
2. WHEN matching resolves to an assigned driver, THE Rider_App SHALL display the assigned driver summary and present the trip with Trip_Status DRIVER_ASSIGNED.
3. THE matching Service_Client contract SHALL be defined so that its Mock_Client and a future Live_Client expose identical request and response shapes.

### Requirement 11: Payment view (STUBBED)

**User Story:** As a rider, I want to see the payment outcome for a completed trip, so that I can confirm the fare was charged.

#### Acceptance Criteria

1. WHEN a rider opens the payment view for a trip, THE Rider_App SHALL request the payment through the payment Service_Client and display the amount, currency, method, and Payment_Status.
2. THE Rider_App SHALL display the Payment_Status using the defined set PENDING, PROCESSING, PAID, and FAILED.
3. IF the payment Service_Client reports a failed payment, THEN THE Rider_App SHALL display the failure reason as a user-facing message.
4. THE payment Service_Client contract SHALL be defined so that its Mock_Client and a future Live_Client expose identical request and response shapes.

### Requirement 12: Notifications view (STUBBED)

**User Story:** As a rider or driver, I want to see notifications related to my trips, so that I stay informed of trip events.

#### Acceptance Criteria

1. WHEN a user opens the notifications view for the Current_Identity, THE Frontend SHALL request notifications through the notification Service_Client and display each notification's message and timestamp.
2. WHERE no notifications exist for the Current_Identity, THE Frontend SHALL display an empty-state view.
3. THE notification Service_Client contract SHALL be defined so that its Mock_Client and a future Live_Client expose identical request and response shapes.

### Requirement 13: Error handling and request feedback (LIVE)

**User Story:** As a user, I want clear feedback when requests are loading or fail, so that I understand the state of the application.

#### Acceptance Criteria

1. WHILE a backend request is in progress, THE Frontend SHALL display a loading indicator for the affected screen area.
2. IF a backend request fails with a client error, THEN THE Frontend SHALL display a user-facing message describing the failure without exposing backend stack traces or persistence internals.
3. IF a backend request fails because the target service is unreachable, THEN THE Frontend SHALL display a service-unavailable message and allow the user to retry.
