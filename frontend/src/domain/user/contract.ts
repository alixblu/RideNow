/**
 * User domain contract (LIVE — user-service).
 *
 * The `UserServiceClient` is intentionally confined to exactly two surfaces —
 * create-user and get-user — because user-service exposes only those endpoints
 * (`UserController`: `POST /api/users`, `GET /api/users/{id}`) and the frontend
 * must not surface capabilities the service does not have (Req 8.5).
 *
 * Request/response types mirror the real Java records exactly:
 *   - CreateUserRequest  ← `CreateUserRequest.java`
 *       cognitoSub (@NotBlank), email (@Email @NotBlank), fullName (@NotBlank) are
 *       required; phone and avatarUrl are optional.
 *   - UserResponse       ← `UserResponse.java` (record)
 *       id/cognitoSub/email/fullName are non-null strings; phone/avatarUrl are
 *       nullable; status is the UserStatus enum; timestamps are `Instant`, which
 *       Jackson serializes as ISO-8601 strings.
 *
 * Both the Live_Client and the Mock_Client implement this one interface, so screens
 * stay implementation-agnostic and a live/mock swap is a configuration change only
 * (Req 4.1, 4.3).
 */

/**
 * User account status — a user-owned enum (mirrors user-service `UserStatus`).
 * Defined locally in this domain because it is owned by user-service and is not part
 * of `shared/enums.ts`.
 */
export type UserStatus = "ACTIVE" | "SUSPENDED";

/** Request body for `POST /api/users` (mirrors `CreateUserRequest.java`). */
export interface CreateUserRequest {
  /** Cognito subject identifier — required (@NotBlank). */
  cognitoSub: string;
  /** Email address — required and must be a valid email (@Email @NotBlank). */
  email: string;
  /** Display name — required (@NotBlank). */
  fullName: string;
  /** Optional phone number. */
  phone?: string;
  /** Optional avatar image URL. */
  avatarUrl?: string;
}

/** Response body for user create/get (mirrors the `UserResponse` record). */
export interface UserResponse {
  /** UUID string. */
  id: string;
  cognitoSub: string;
  email: string;
  /** Nullable per the DBML / record (String, no @NotNull). */
  phone: string | null;
  fullName: string;
  /** Nullable per the DBML / record. */
  avatarUrl: string | null;
  status: UserStatus;
  /** Instant serialized as an ISO-8601 string. */
  createdAt: string;
  /** Instant serialized as an ISO-8601 string. */
  updatedAt: string;
}

/**
 * The single user-service contract shared by Live_Client and Mock_Client.
 *
 * Confined to create + get only (Req 8.5) — do not add methods for endpoints the
 * service does not expose.
 */
export interface UserServiceClient {
  /** Create a user. Maps to `POST /api/users` → 201 `UserResponse`. */
  createUser(req: CreateUserRequest): Promise<UserResponse>;
  /** Fetch a user by id. Maps to `GET /api/users/{id}` (404 if missing). */
  getUser(id: string): Promise<UserResponse>;
}
