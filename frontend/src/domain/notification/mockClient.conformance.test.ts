import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createNotificationMockClient } from "./mockClient";
import type { NotificationResponse } from "./contract";

/**
 * Property 11: Mock responses conform to the shared contract (notification domain).
 *
 * Validates: Requirements 4.4, 4.5, 12.1.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 *
 * For any identityId (non-empty string), `listForIdentity` returns an array, and every
 * element conforms to the documented NotificationResponse shape used by the notifications
 * view to render each message and when it arrived: `id` is a non-empty string,
 * `recipientId` equals the requested identityId, `message` is a non-empty string, and
 * `createdAt` is an ISO-8601 timestamp string. An empty array (the empty-state bucket) is
 * valid and conforms trivially. A fresh createNotificationMockClient() is used per run, and
 * determinism is asserted by calling listForIdentity twice and comparing the results.
 */

// A non-empty identity identifier.
const identityId = fc.string({ minLength: 1, maxLength: 36 });

/** True when `value` is an ISO-8601 string that round-trips through Date. */
function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Runtime conformance check: asserts `value` has exactly the documented
 * NotificationResponse keys, each with the correct type, and that `recipientId`
 * equals the requested identity. Throws via expect on the first violation.
 */
function assertConformsToContract(
  value: unknown,
  expectedRecipientId: string,
): asserts value is NotificationResponse {
  // Must be a plain, non-null object.
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  const notification = value as Record<string, unknown>;

  // Exactly the documented keys — no missing and no extra fields.
  const expectedKeys = ["id", "recipientId", "message", "createdAt"].sort();
  expect(Object.keys(notification).sort()).toEqual(expectedKeys);

  // id: non-empty string.
  expect(typeof notification.id).toBe("string");
  expect((notification.id as string).length).toBeGreaterThan(0);

  // recipientId: non-empty string equal to the requested identity.
  expect(typeof notification.recipientId).toBe("string");
  expect(notification.recipientId).toBe(expectedRecipientId);

  // message: non-empty string (what the view renders).
  expect(typeof notification.message).toBe("string");
  expect((notification.message as string).length).toBeGreaterThan(0);

  // createdAt: ISO-8601 timestamp string (when it arrived).
  expect(isIsoTimestamp(notification.createdAt)).toBe(true);
}

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("returns contract-conforming notification arrays for any identity (empty or not)", async () => {
    await fc.assert(
      fc.asyncProperty(identityId, async (id) => {
        // Fresh client per run keeps each run isolated.
        const client = createNotificationMockClient();

        const notifications = await client.listForIdentity(id);

        // Always an array; an empty array conforms trivially.
        expect(Array.isArray(notifications)).toBe(true);

        for (const notification of notifications) {
          assertConformsToContract(notification, id);
        }

        // Determinism: calling twice yields deeply-equal results.
        const again = await client.listForIdentity(id);
        expect(again).toEqual(notifications);
      }),
      { numRuns: 100 },
    );
  });
});
