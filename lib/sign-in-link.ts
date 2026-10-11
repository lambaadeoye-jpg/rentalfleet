// A sign-in link can carry either a PKCE `code` (works only in the browser that asked for the link) or a
// `token_hash` + `type` (works in any browser, which is what an invite needs: the admin asked for it, the invitee opens it).

export const OTP_TYPES = ["email", "magiclink", "signup", "invite", "recovery", "email_change"] as const;
export type OtpType = (typeof OTP_TYPES)[number];

export type SignInLink =
  | { kind: "code"; code: string }
  | { kind: "otp"; tokenHash: string; type: OtpType }
  | null;

export function parseSignInLink(params: URLSearchParams): SignInLink {
  const code = params.get("code");
  if (code) return { kind: "code", code };
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type && (OTP_TYPES as readonly string[]).includes(type)) {
    return { kind: "otp", tokenHash, type: type as OtpType };
  }
  return null;
}
