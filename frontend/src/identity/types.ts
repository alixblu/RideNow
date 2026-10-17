/**
 * Identity module types — the replaceable boundary for the Current_Identity.
 *
 * Authentication is out of scope for this feature (Req 2.6): there are no tokens,
 * credentials, sessions, or login/signup flows anywhere in this module. An
 * `Identity` is nothing more than a role plus an opaque identifier string chosen
 * through the dev-only Identity_Switcher.
 *
 * `IdentityApi` is the stable contract (design: "Identity module boundary"). Today
 * `DevIdentityProvider` implements it with in-memory React state; later a real auth
 * provider (e.g. Cognito) can implement the same `IdentityApi` and be mounted in its
 * place without any calling screen changing (Req 2.5). Screens never touch this type
 * directly — they consume it through `useCurrentIdentity()`.
 */

/** The acting role selected in the Identity_Switcher (Req 2.1). */
export type Role = "rider" | "driver" | "admin";

/** A selected acting principal: a role and its opaque identifier (Req 2.2). */
export interface Identity {
  role: Role;
  id: string;
}

/**
 * The contract screens depend on, decoupled from its implementation (Req 2.5).
 *
 * A real authentication provider may implement only `current` and omit `set`
 * (the dev switcher is what calls `set`); keeping both on the interface lets the
 * dev provider satisfy it today while leaving the door open for a read-only auth
 * provider later.
 */
export interface IdentityApi {
  /** The Current_Identity for a role, or null when none has been set (Req 2.4). */
  current(role: Role): Identity | null;
  /** Establish the Current_Identity for a role (dev switcher only). */
  set(identity: Identity): void;
}
