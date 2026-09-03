import { describe, expect, it } from "vitest";
import { bucketRange, bucketStart, resolveRange } from "./dates";

describe("bucketStart", () => {
  it("passes day grain through unchanged", () => {
    expect(bucketStart("2026-03-17", "day")).toBe("2026-03-17");
  });

  it("truncates to first of month", () => {
    expect(bucketStart("2026-03-17", "month")).toBe("2026-03-01");
  });

  it("truncates to Monday for week grain", () => {
    // 2026-03-17 is a Tuesday
    expect(bucketStart("2026-03-17", "week")).toBe("2026-03-16");
  });

  it("Sunday rolls back 6 days to the preceding Monday", () => {
    // 2026-03-15 is a Sunday
    expect(bucketStart("2026-03-15", "week")).toBe("2026-03-09");
  });
});

describe("bucketRange", () => {
  it("generates one entry per day inclusive", () => {
    expect(bucketRange("2026-01-01", "2026-01-03", "day")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("generates one entry per month inclusive", () => {
    expect(bucketRange("2026-01-15", "2026-03-05", "month")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("resolveRange", () => {
  it("defaults to a 90-day window ending today when nothing is given", () => {
    const { from, to } = resolveRange(null, null, null, "2020-01-01");
    expect(to.length).toBe(10);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    expect(days).toBe(90);
  });

  it("honors an explicit from date over any preset", () => {
    const { from, to } = resolveRange("2026-01-01", "2026-02-01", "30d", "2020-01-01");
    expect(from).toBe("2026-01-01");
    expect(to).toBe("2026-02-01");
  });

  it("ytd starts at Jan 1 of the `to` year", () => {
    const { from, to } = resolveRange(null, "2026-06-15", "ytd", "2020-01-01");
    expect(from).toBe("2026-01-01");
    expect(to).toBe("2026-06-15");
  });

  it("all uses the earliest known date", () => {
    const { from } = resolveRange(null, "2026-06-15", "all", "2020-05-05");
    expect(from).toBe("2020-05-05");
  });
});
