/**
 * Feature: production-grade-frontend, Property 3: Malformed sessions are rejected and deleted
 *
 * **Validates: Requirements 2.9**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SESSION_KEY, loadSession } from "./sessionStore";

function fakeStorage(initial: string): Storage {
  const map = new Map<string, string>([[SESSION_KEY, initial]]);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const isValidJson = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

const notJson = fc.string().filter((s) => !isValidJson(s));

const nonObjectJson = fc
  .oneof(
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.string(),
    fc.array(fc.oneof(fc.string(), fc.integer())),
  )
  .map((v) => JSON.stringify(v));

const badRole = fc.oneof(
  fc.string().filter((s) => !["rider", "driver", "admin"].includes(s)),
  fc.integer(),
  fc.constant(null),
);

const badRoleObject = fc
  .record({ role: badRole, id: fc.string({ minLength: 1 }) })
  .map((v) => JSON.stringify(v));

const emptyIdObject = fc
  .record({ role: fc.constantFrom("rider", "driver", "admin"), id: fc.constant("") })
  .map((v) => JSON.stringify(v));

const badIdTypeObject = fc
  .record({
    role: fc.constantFrom("rider", "driver", "admin"),
    id: fc.oneof(fc.integer(), fc.constant(null), fc.boolean()),
  })
  .map((v) => JSON.stringify(v));

const missingFieldObject = fc
  .oneof(
    fc.record({ role: fc.constantFrom("rider", "driver", "admin") }),
    fc.record({ id: fc.string({ minLength: 1 }) }),
    fc.constant({}),
  )
  .map((v) => JSON.stringify(v));

const malformed = fc.oneof(
  notJson,
  nonObjectJson,
  badRoleObject,
  emptyIdObject,
  badIdTypeObject,
  missingFieldObject,
);

describe("Property 3: malformed sessions are rejected and deleted", () => {
  it("returns null and removes the stored value for any malformed session", () => {
    fc.assert(
      fc.property(malformed, (raw) => {
        const storage = fakeStorage(raw);
        expect(loadSession(storage)).toBeNull();
        expect(storage.getItem(SESSION_KEY)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
