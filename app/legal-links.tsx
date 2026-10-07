import type { CSSProperties } from "react";

// One line, used under every form that collects personal details.
export default function LegalLinks({ style }: { style?: CSSProperties }) {
  return (
    <p className="muted-text" style={{ fontSize: 13, ...style }}>
      By continuing you agree to our <a href="/terms" style={{ textDecoration: "underline" }}>Terms</a> and{" "}
      <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy policy</a>.
    </p>
  );
}
