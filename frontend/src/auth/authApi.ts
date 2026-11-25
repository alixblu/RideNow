/**
 * authApi — thin client over POST /api/auth/register and /api/auth/login.
 *
 * Goes through the shared `httpRequest` wrapper. The password is only ever placed
 * in the request body; nothing here persists or logs it (Req 3.12).
 */
import { httpRequest, type HttpRequestOptions } from "../http/httpClient";
import type { Role } from "../identity/types";

export type AccountType = "RIDER" | "DRIVER";

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  accountType: AccountType;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  accountType: AccountType;
}

/** Maps the backend Account_Type to the Frontend role. Admin is never reachable here. */
export function roleForAccountType(accountType: AccountType): Exclude<Role, "admin"> {
  return accountType === "DRIVER" ? "driver" : "rider";
}

type Options = Pick<HttpRequestOptions, "config">;

export function register(request: RegisterRequest, options: Options = {}): Promise<AuthUser> {
  return httpRequest<AuthUser>("/api/auth/register", {
    ...options,
    method: "POST",
    body: request,
  });
}

export function login(request: LoginRequest, options: Options = {}): Promise<AuthUser> {
  return httpRequest<AuthUser>("/api/auth/login", {
    ...options,
    method: "POST",
    body: request,
  });
}
