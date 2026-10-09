import type { Metadata } from "next";
import { MINIMUM_AGE } from "@/lib/site-config";
import LegalPage from "../../legal-page";

export const metadata: Metadata = {
  title: "How to sign up to drive or deliver",
  description: "Step-by-step guide to getting approved on rideshare, delivery, courier and medical courier platforms before you rent from Zivo.",
  alternates: { canonical: "/guides/driver-signup" },
};

const h = { fontSize: 20, margin: "32px 0 8px" } as const;

const LINKS: { name: string; url: string; note: string }[] = [
  { name: "Uber (rideshare)", url: "https://www.uber.com/us/en/drive/", note: "Sign up as a driver, upload your documents, pass the background check." },
  { name: "Lyft (rideshare)", url: "https://www.lyft.com/driver", note: "Apply, upload your documents, pass the background check." },
  { name: "Uber Eats (delivery)", url: "https://www.uber.com/us/en/deliver/", note: "Delivery by car. Usually faster to approve than rideshare." },
  { name: "DoorDash (delivery)", url: "https://dasher.doordash.com/", note: "Sign up as a Dasher and complete the background check." },
  { name: "Instacart (grocery delivery)", url: "https://shoppers.instacart.com/", note: "Apply as a shopper and complete the background check." },
  { name: "Amazon Flex (package delivery)", url: "https://flex.amazon.com/", note: "Delivery blocks. Approval can take longer and may have a waitlist." },
];

export default function DriverSignupGuide() {
  return (
    <LegalPage title="How to sign up to drive or deliver">
      <p>
        To rent from Zivo you need an approved driver profile on at least one platform. This guide walks you through getting
        approved. Each platform sets its own rules and can change them, so always check the platform&rsquo;s own site for the
        latest.
      </p>

      <h2 style={h}>Before you start</h2>
      <ul>
        <li>A valid driver&rsquo;s license that you have held for the time the platform requires (usually a year or more).</li>
        <li>A smartphone, your Social Security number for the background check, and an email address you check often.</li>
        <li>You must be at least {MINIMUM_AGE} to rent from Zivo. Some platforms require more.</li>
        <li>Platforms usually need to see the car you will drive. You can apply first and add the car once you have it, or ask us what you need to show.</li>
      </ul>

      <h2 style={h}>Step by step</h2>
      <ol>
        <li>Pick the platform or platforms you want to work for. Many drivers sign up to two or three so they always have work.</li>
        <li>Create your account and enter your details exactly as they appear on your license.</li>
        <li>Upload your license and any other documents the platform asks for.</li>
        <li>Agree to the background check and driving record check. Results usually take a few days, sometimes longer.</li>
        <li>Wait for the approval message in the app or by email.</li>
        <li>Take a screenshot of your approved profile showing your name and the &ldquo;approved&rdquo; or &ldquo;active&rdquo; status.</li>
        <li>Upload that screenshot with your Zivo application.</li>
      </ol>

      <h2 style={h}>Rideshare and delivery platforms</h2>
      <ul>
        {LINKS.map((l) => (
          <li key={l.name}>
            <a href={l.url} target="_blank" rel="noreferrer noopener">{l.name}</a>. {l.note}
          </li>
        ))}
      </ul>

      <h2 style={h}>Courier and medical courier work</h2>
      <p>
        Courier and medical courier companies hire independent drivers directly, so there is no single sign-up site. Search
        for courier and medical courier companies in Nashville and Murfreesboro, then:
      </p>
      <ul>
        <li>Apply as an independent contractor driver, with your license and a clean driving record.</li>
        <li>Expect a background check, and for medical work often a short privacy (HIPAA) training and sometimes a drug screen.</li>
        <li>Ask the company in writing whether you can use a rental car, and keep their reply.</li>
        <li>When you are approved, screenshot your profile or save the approval email, and upload it with your Zivo application.</li>
      </ul>

      <h2 style={h}>What counts as proof</h2>
      <ul>
        <li>A screenshot of your approved driver profile or dashboard, with your name visible.</li>
        <li>For courier companies, the approval email or onboarding confirmation.</li>
        <li>A screenshot that shows only a pending application does not count yet. Come back when you are approved.</li>
      </ul>

      <h2 style={h}>Tips</h2>
      <ul>
        <li>Apply to more than one platform. Approval times differ.</li>
        <li>Fix any problem with your driving record before you apply. It is the most common reason for a rejection.</li>
        <li>Do not pay anyone to sign you up. The platforms above are free to join.</li>
      </ul>

      <p style={{ marginTop: 24 }}>
        Ready? <a href="/apply">Continue your Zivo application</a>.
      </p>
    </LegalPage>
  );
}
