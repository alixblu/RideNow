import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createNotificationMockClient } from "./mockClient";
import type { NotificationResponse } from "./contract";

/**
 * Mock responses conform to the shared contract (notification domain), and the
 * mock behaves like the inbox API: per-user, oldest first, `since` returns only
 * newer items, `markRead` keeps the first read time.
 */

const EXPECTED_KEYS = [
  "id",
  "userId",
  "type",
  "message",
  "tripId",
  "occurredAt",
  "createdAt",
  "readAt",
].sort();

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function assertConforms(value: unknown, userId: string): asserts value is NotificationResponse {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  const n = value as Record<string, unknown>;
  expect(Object.keys(n).sort()).toEqual(EXPECTED_KEYS);
  expect(typeof n.id).toBe("string");
  expect(n.userId).toBe(userId);
  expect(typeof n.type).toBe("string");
  expect((n.message as string).length).toBeGreaterThan(0);
  expect(n.tripId === null || typeof n.tripId === "string").toBe(true);
  expect(n.occurredAt === null || isIsoTimestamp(n.occurredAt)).toBe(true);
  expect(isIsoTimestamp(n.createdAt)).toBe(true);
  expect(n.readAt === null || isIsoTimestamp(n.readAt)).toBe(true);
}

const userId = fc.uuid();
const messages = fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 0, maxLength: 8 });

describe("notification mock client", () => {
  it("returns contract-conforming items for the user only, oldest first", async () => {
    await fc.assert(
      fc.asyncProperty(userId, userId, messages, async (me, other, texts) => {
        fc.pre(me !== other);
        const client = createNotificationMockClient();
        const pushed = texts.map((message) =>
          client.push({ userId: me, type: "trip.started", message, tripId: null, occurredAt: null }),
        );
        client.push({ userId: other, type: "trip.started", message: "x", tripId: null, occurredAt: null });

        const listed = await client.listSince(me);
        expect(listed.map((n) => n.id)).toEqual(pushed.map((n) => n.id));
        listed.forEach((n) => assertConforms(n, me));
      }),
      { numRuns: 50 },
    );
  });

  it("listSince returns only the items after the cursor", async () => {
    const client = createNotificationMockClient();
    const me = crypto.randomUUID();
    const a = client.push({ userId: me, type: "trip.requested", message: "a", tripId: null, occurredAt: null });
    const b = client.push({ userId: me, type: "driver.accepted", message: "b", tripId: null, occurredAt: null });

    expect((await client.listSince(me, a.id)).map((n) => n.id)).toEqual([b.id]);
    expect(await client.listSince(me, b.id)).toEqual([]);
    await expect(client.listSince(me, crypto.randomUUID())).rejects.toBeDefined();
  });

  it("markRead sets readAt once", async () => {
    const client = createNotificationMockClient();
    const n = client.push({ userId: "u", type: "trip.started", message: "m", tripId: null, occurredAt: null });

    const first = await client.markRead(n.id);
    const second = await client.markRead(n.id);

    expect(first.readAt).not.toBeNull();
    expect(second.readAt).toBe(first.readAt);
    await expect(client.markRead("missing")).rejects.toBeDefined();
  });
});
