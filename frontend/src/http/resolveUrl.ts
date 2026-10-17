/**
 * resolveUrl — turns a documented API path into a concrete absolute URL.
 *
 * Two modes, driven entirely by `AppConfig` and the `Path_Prefix_Map`, so changing
 * configuration reroutes requests without touching any calling screen (Req 3.5):
 *
 *   - Gateway mode (`config.apiBaseUrl` set): the origin is `apiBaseUrl` and the
 *     documented path is preserved unchanged. Any trailing slash on the base is
 *     trimmed so we never emit a double slash (Req 3.2).
 *
 *   - Fallback mode (`config.apiBaseUrl` null): pick the LONGEST matching prefix in
 *     `PATH_PREFIX_MAP` and use its origin (Req 3.3). A matched-but-null origin is a
 *     documented placeholder for a service that does not exist yet (Req 3.4); it
 *     throws `ApiError.unavailable` so a stubbed-but-configured-live domain fails
 *     cleanly instead of hitting a wrong host.
 *
 * This module only depends on the config contract (the `AppConfig` type and the
 * `PATH_PREFIX_MAP` table), never on screens.
 */
import type { AppConfig } from "../config/appConfig";
import { PATH_PREFIX_MAP } from "../config/pathPrefixMap";
import { ApiError } from "./ApiError";

export function resolveUrl(path: string, config: AppConfig): string {
  // Gateway mode: single configured origin, path preserved (trailing slash trimmed).
  if (config.apiBaseUrl) {
    return config.apiBaseUrl.replace(/\/$/, "") + path;
  }

  // Fallback mode: longest matching prefix in the Path_Prefix_Map wins.
  const prefix = Object.keys(PATH_PREFIX_MAP)
    .filter((p) => path === p || path.startsWith(p + "/") || path.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];

  const origin = prefix !== undefined ? PATH_PREFIX_MAP[prefix] : undefined;

  // No mapped prefix, or a documented null placeholder origin -> unavailable.
  if (!origin) {
    throw ApiError.unavailable(`No origin mapped for ${path}`);
  }

  return origin + path;
}
