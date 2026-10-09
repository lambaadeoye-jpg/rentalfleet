import { describe, it, expect } from "vitest";
import { platformProofProblem } from "./platform-proof";

describe("platformProofProblem", () => {
  it("needs a platform", () => expect(platformProofProblem({ platformCount: 0, hasApproval: true })).toMatch(/at least one platform/));
  it("needs the proof", () => expect(platformProofProblem({ platformCount: 1, hasApproval: false })).toMatch(/approved driver profile/));
  it("passes with both", () => expect(platformProofProblem({ platformCount: 2, hasApproval: true })).toBeNull());
});
