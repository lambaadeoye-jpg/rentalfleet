import { Suspense } from "react";
import type { Metadata } from "next";
import GetStartedFlow from "./get-started-flow";

export const metadata: Metadata = {
  title: "Get started",
  description: "Answer a few quick questions and we’ll call you to get you on the road.",
  robots: { index: false }, // a lead-capture flow, not content meant to rank on its own
};

export default function GetStartedPage() {
  return (
    <Suspense fallback={null}>
      <GetStartedFlow />
    </Suspense>
  );
}
