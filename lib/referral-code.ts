import { randomBytes } from "crypto";

// Short, shareable, human-typeable referral code -- not a UUID (too long
// to read out loud or type from a text message). 8 chars from an
// unambiguous alphabet (no 0/O, 1/I/L confusion) keeps collision
// probability negligible for a business this size while staying easy to
// actually use.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateReferralCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
