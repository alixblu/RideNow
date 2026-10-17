/**
 * User domain Mock_Client — an in-memory implementation of `UserServiceClient`.
 *
 * It implements the exact same contract as the Live_Client, returning objects that
 * satisfy `UserResponse`, so a screen renders identically regardless of mode and shows
 * no mock/live marker (Req 4.4, 4.5). State lives in a per-instance in-memory store so
 * create-then-get round-trips work offline with no backend.
 *
 * Failure modes mirror the live client's sanitized errors: a missing user surfaces
 * `ApiError.notFound`, matching what the request layer produces for a 404.
 */
import { ApiError } from "../../http/ApiError";
import type { CreateUserRequest, UserResponse, UserServiceClient } from "./contract";

/** A tiny, dependency-free UUID-ish id generator for mock records. */
function mockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return "mock-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * Build the in-memory user Mock_Client. Each call creates an isolated store, so tests
 * and screens do not leak state into one another.
 */
export function createUserMockClient(): UserServiceClient {
  const store = new Map<string, UserResponse>();

  return {
    createUser(req: CreateUserRequest): Promise<UserResponse> {
      const now = new Date().toISOString();
      const user: UserResponse = {
        id: mockId(),
        cognitoSub: req.cognitoSub,
        email: req.email,
        phone: req.phone ?? null,
        fullName: req.fullName,
        avatarUrl: req.avatarUrl ?? null,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      store.set(user.id, user);
      return Promise.resolve(user);
    },

    getUser(id: string): Promise<UserResponse> {
      const user = store.get(id);
      if (user === undefined) {
        return Promise.reject(ApiError.notFound());
      }
      return Promise.resolve(user);
    },
  };
}
