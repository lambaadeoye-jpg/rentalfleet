import SignInForm from "../sign-in-form";

// Explicit resume path for someone continuing on a NEW device/browser
// where no session persists. Not the default entry to /apply anymore --
// see anonymous-entry.tsx for why. This is where the magic-link flow still
// lives, because there’s no way to resume cross-device without some form
// of identity verification -- that friction is unavoidable here, just no
// longer imposed on every first-time visitor.
export default async function ResumePage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  return (
    <>
      {link === "expired" && (
        <p className="error-text" role="alert" style={{ maxWidth: 480, margin: "24px auto 0", padding: "0 20px" }}>
          That link didn’t work. It may have expired, or it was opened in a different browser than the one you asked from. Enter your email below and we’ll send a new one. Open it on the same phone or computer.
        </p>
      )}
      <SignInForm />
    </>
  );
}
