import { describe, expect, it } from "vitest";
import { parseSignInLink } from "./sign-in-link";

const p = (q: string) => new URLSearchParams(q);

describe("parseSignInLink", () => {
  it("reads a PKCE code", () => {
    expect(parseSignInLink(p("code=abc&next=/portal"))).toEqual({ kind: "code", code: "abc" });
  });
  it("reads a token hash with a known type, so the link works in any browser", () => {
    expect(parseSignInLink(p("next=/staff/onboard&token_hash=h123&type=email"))).toEqual({ kind: "otp", tokenHash: "h123", type: "email" });
  });
  it("prefers the code when both are present", () => {
    expect(parseSignInLink(p("code=abc&token_hash=h&type=email"))).toEqual({ kind: "code", code: "abc" });
  });
  it("rejects unknown types, a missing type or a missing hash", () => {
    expect(parseSignInLink(p("token_hash=h&type=bogus"))).toBeNull();
    expect(parseSignInLink(p("token_hash=h"))).toBeNull();
    expect(parseSignInLink(p("type=email"))).toBeNull();
    expect(parseSignInLink(p("next=/portal"))).toBeNull();
  });
});
