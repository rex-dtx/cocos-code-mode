import { describe, expect, it } from "vitest";
import { assertCanaryPromotion, nextCanaryCohort } from "../../src/cc-bridge/canary.ts";

describe("CC Bridge canary 1→3→10", () => {
  it("selects the next cohort from healthy device count", () => {
    expect(nextCanaryCohort(0)).toBe(1);
    expect(nextCanaryCohort(1)).toBe(3);
    expect(nextCanaryCohort(3)).toBe(10);
    expect(nextCanaryCohort(10)).toBe("ga");
  });

  it("rejects skipped promotions", () => {
    expect(() => assertCanaryPromotion(1, 10)).toThrow(/1→3→10/);
    expect(() => assertCanaryPromotion(1, 3)).not.toThrow();
    expect(() => assertCanaryPromotion(3, 10)).not.toThrow();
    expect(() => assertCanaryPromotion(10, "ga")).not.toThrow();
  });
});
