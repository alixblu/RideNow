/**
 * Configuration module (Req 3.1).
 *
 * Reads the single gateway-style `API_Base_URL` and the per-domain Live/Mock
 * client modes from Vite env vars once at startup. `apiBaseUrl` being null means
 * "no gateway" — the request layer falls back to the Path_Prefix_Map (Req 3.3).
 *
 * Per-domain modes default by domain classification: LIVE domains (driver,
 * vehicle, user) default to `live`; STUBBED domains (trip, matching, payment,
 * notification) default to `mock`. An env override (`VITE_CLIENT_<DOMAIN>`) wins
 * when it is a recognized mode.
 */

/** Every backend domain the frontend reaches through a Service_Client. */
export type DomainKey =
  | "driver"
  | "vehicle"
  | "user"
  | "trip"
  | "matching"
  | "payment"
  | "notification";

/** Resolution mode for a single domain's Service_Client. */
export type ClientMode = "live" | "mock";

export interface DomainClientMode {
  mode: ClientMode;
}

export interface AppConfig {
  /** Gateway origin; null => use the Path_Prefix_Map fallback. */
  apiBaseUrl: string | null;
  /** Per-domain Live/Mock selection. */
  clients: Record<DomainKey, DomainClientMode>;
}

/** Default mode per domain: LIVE domains serve `live`, STUBBED serve `mock`. */
const DEFAULT_MODES: Record<DomainKey, ClientMode> = {
  driver: "live",
  vehicle: "live",
  user: "live",
  trip: "mock",
  matching: "mock",
  payment: "mock",
  notification: "mock",
};

/** Env var that overrides each domain's mode, e.g. VITE_CLIENT_DRIVER. */
const CLIENT_ENV_KEYS: Record<DomainKey, string> = {
  driver: "VITE_CLIENT_DRIVER",
  vehicle: "VITE_CLIENT_VEHICLE",
  user: "VITE_CLIENT_USER",
  trip: "VITE_CLIENT_TRIP",
  matching: "VITE_CLIENT_MATCHING",
  payment: "VITE_CLIENT_PAYMENT",
  notification: "VITE_CLIENT_NOTIFICATION",
};

function isClientMode(value: string | undefined): value is ClientMode {
  return value === "live" || value === "mock";
}

/** A blank or unset base URL means "no gateway configured". */
function readApiBaseUrl(env: ImportMetaEnv): string | null {
  const raw = env.VITE_API_BASE_URL;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDomainMode(env: ImportMetaEnv, domain: DomainKey): ClientMode {
  const override = env[CLIENT_ENV_KEYS[domain]];
  return isClientMode(override) ? override : DEFAULT_MODES[domain];
}

/**
 * Build an {@link AppConfig} from an env source. Pure and side-effect free, so
 * tests can exercise parsing and defaults with crafted env objects. The
 * exported `appConfig` singleton is produced by calling this once with
 * `import.meta.env` at module load (Req 3.1).
 */
export function buildConfig(env: ImportMetaEnv): AppConfig {
  const clients = {} as Record<DomainKey, DomainClientMode>;
  for (const domain of Object.keys(DEFAULT_MODES) as DomainKey[]) {
    clients[domain] = { mode: resolveDomainMode(env, domain) };
  }
  return {
    apiBaseUrl: readApiBaseUrl(env),
    clients,
  };
}

/**
 * The resolved configuration, read once from `import.meta.env` at module load
 * (Req 3.1). Import this singleton rather than reading env vars elsewhere.
 */
export const appConfig: AppConfig = buildConfig(import.meta.env);
