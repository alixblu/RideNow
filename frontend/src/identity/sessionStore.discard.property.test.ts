/**
 * Feature: frontend-booking-and-password-login, Property 9: A malformed stored Session is always discarded
 *
 * **Validates: Requirements 3.10**
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
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const parses = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

const role = fc.constantFrom("rider", "driver", "admin");
const nonEmptyId = fc.string({ minLength: 1 });
const json = (v: unknown) => JSON.stringify(v);

const malformed = fc.oneof(
  // unparseable JSON
  fc.string().filter((s) => !parses(s)),
  // valid JSON that is not an object
  fc
    .oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.string(), fc.array(fc.integer()))
    .map(json),
  // unrecognized or wrong-typed role
  fc
    .record({
      role: fc.oneof(
        fc.string().filter((s) => !["rider", "driver", "admin"].includes(s)),
        fc.integer(),
        fc.constant(null),
      ),
      id: nonEmptyId,
    })
    .map(json),
  // wrong-typed or empty id
  fc
    .record({ role, id: fc.oneof(fc.integer(), fc.constant(null), fc.boolean(), fc.constant("")) })
    .map(json),
  // missing fields
  fc.oneof(fc.record({ role }), fc.record({ id: nonEmptyId }), fc.constant({})).map(json),
);

describe("Property 9: a malformed stored Session is always discarded", () => {
  it("loadSession returns null and removes the stored value", () => {
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
