/**
 * User domain Live_Client — talks to the real user-service over HTTP.
 *
 * Every call goes through `httpRequest`, so URL resolution (gateway vs
 * Path_Prefix_Map), principal attachment, and error normalization into a sanitized
 * `ApiError` all happen in one place (design: "Request layer"). This client only
 * maps the two documented user-service operations to their endpoints:
 *   - createUser → `POST /api/users`
 *   - getUser    → `GET  /api/users/{id}`
 *
 * It is confined to create + get only (Req 8.5); no other surfaces exist here.
 */
import { httpRequest } from "../../http/httpClient";
import type { Page } from "../../shared/page";
import type {
  CreateUserRequest,
  ListUsersParams,
  UserResponse,
  UserServiceClient,
} from "./contract";

/** Base path for the user-service users resource (resolved by the request layer). */
const USERS_PATH = "/api/users";

/**
 * Construct the user-service Live_Client. Returned as a `UserServiceClient` so callers
 * depend only on the shared contract, never on these concrete methods.
 */
export function createUserLiveClient(): UserServiceClient {
  return {
    createUser(req: CreateUserRequest): Promise<UserResponse> {
      return httpRequest<UserResponse>(USERS_PATH, {
        method: "POST",
        body: req,
      });
    },

    getUser(id: string): Promise<UserResponse> {
      return httpRequest<UserResponse>(`${USERS_PATH}/${encodeURIComponent(id)}`);
    },

    listUsers(params: ListUsersParams): Promise<Page<UserResponse>> {
      const query = new URLSearchParams();
      if (params.limit !== undefined) {
        query.set("limit", String(params.limit));
      }
      if (params.offset !== undefined) {
        query.set("offset", String(params.offset));
      }
      const qs = query.toString();
      return httpRequest<Page<UserResponse>>(
        `${USERS_PATH}${qs.length > 0 ? `?${qs}` : ""}`,
      );
    },
  };
}
