import { describe, expect, it } from "vitest";
import { parseFiltersResponse } from "./chat";

describe("parseFiltersResponse", () => {
  it("accepts a well-formed catalog intent", () => {
    const result = parseFiltersResponse(JSON.stringify({ intent: "burn", entity: "everest_capital_brevard", from: null, to: null }));
    expect(result).toEqual({ intent: "burn", entity: "everest_capital_brevard", from: null, to: null });
  });

  it("rejects an intent outside the fixed catalog", () => {
    const result = parseFiltersResponse(JSON.stringify({ intent: "DROP TABLE finance.postings", entity: "all" }));
    expect(result.intent).toBeNull();
  });

  it("rejects an entity code outside the allowlist", () => {
    const result = parseFiltersResponse(JSON.stringify({ intent: "burn", entity: "not_a_real_entity" }));
    expect(result.entity).toBeNull();
  });

  it("rejects malformed date strings", () => {
    const result = parseFiltersResponse(JSON.stringify({ intent: "cashflow", from: "not-a-date; DROP TABLE x;--" }));
    expect(result.from).toBeNull();
  });

  it("degrades gracefully on invalid JSON", () => {
    const result = parseFiltersResponse("not json at all");
    expect(result).toEqual({ intent: null, entity: null, from: null, to: null });
  });
});
