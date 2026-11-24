/**
 * Identity module types — the replaceable boundary for the Current_Identity.
 *
 * There are no tokens or credentials in this module. An `Identity` is a role plus
 * an opaque identifier string chosen through the mock sign-in flow and persisted
 * as the Session.
 *
 * `IdentityApi` is the stable contract (design: "Identity module boundary"). Today
 * `SessionIdentityProvider` implements it over localStorage; later a real auth
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
  /** The active Session identity, or null when signed out. */
  readonly identity: Identity | null;
  /** Establish the Session identity. */
  signIn(identity: Identity): void;
  /** End the Session. The caller navigates to the sign-in route. */
  signOut(): void;
  /** Back-compat accessor: the identity when its role matches, else null. */
  current(role: Role): Identity | null;
}
