import { describe, expect, it } from "vitest";

import { deriveStatus } from "@/lib/match-status";

/**
 * The lifecycle rule the whole product hangs off: a fixture's status is a pure
 * function of its time window. Every boundary is pinned here because
 * `server.mjs` mirrors this implementation (see `npm run check:contract`).
 */
describe("deriveStatus", () => {
  const start = new Date("2026-01-01T12:00:00.000Z");
  const end = new Date("2026-01-01T14:00:00.000Z");

  it("is scheduled before kick-off", () => {
    expect(deriveStatus(start, end, new Date("2026-01-01T11:59:59.999Z"))).toBe("scheduled");
  });

  it("becomes live exactly at kick-off", () => {
    expect(deriveStatus(start, end, new Date("2026-01-01T12:00:00.000Z"))).toBe("live");
  });

  it("is live mid-fixture", () => {
    expect(deriveStatus(start, end, new Date("2026-01-01T13:00:00.000Z"))).toBe("live");
  });

  it("is still live one millisecond before the end", () => {
    expect(deriveStatus(start, end, new Date("2026-01-01T13:59:59.999Z"))).toBe("live");
  });

  it("is finished exactly at the end time", () => {
    expect(deriveStatus(start, end, new Date("2026-01-01T14:00:00.000Z"))).toBe("finished");
  });

  it("stays finished long after the end", () => {
    expect(deriveStatus(start, end, new Date("2026-01-02T14:00:00.000Z"))).toBe("finished");
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(deriveStatus(start.toISOString(), end.toISOString(), new Date("2026-01-01T13:00:00Z"))).toBe(
      "live"
    );
  });

  it("defaults `now` to the current instant", () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    expect(deriveStatus(past, future)).toBe("live");
  });
});
