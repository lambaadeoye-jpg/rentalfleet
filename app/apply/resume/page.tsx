import SignInForm from "../sign-in-form";

// Explicit resume path for someone continuing on a NEW device/browser
// where no session persists. Not the default entry to /apply anymore --
// see anonymous-entry.tsx for why. This is where the magic-link flow still
// lives, because there's no way to resume cross-device without some form
// of identity verification -- that friction is unavoidable here, just no
// longer imposed on every first-time visitor.
export default function ResumePage() {
  return <SignInForm />;
}
