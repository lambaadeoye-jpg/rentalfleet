import type { Metadata } from "next";
import LegalPage from "../legal-page";
import { MINIMUM_AGE } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms for using the Zivo website and messaging program.",
  alternates: { canonical: "/terms" },
};

const h = { fontSize: 20, margin: "32px 0 8px" } as const;

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms cover your use of rentzivo.com and our messaging program. Renting a vehicle is governed by the
        separate rental agreement you review and sign before pickup. If the two differ, the rental agreement controls for
        your rental.
      </p>

      <h2 style={h}>Using the site</h2>
      <ul>
        <li>You must be at least {MINIMUM_AGE} years old with a valid driver&rsquo;s license to apply for a rental.</li>
        <li>Give us accurate information. Submitting a request or application does not guarantee approval or that a vehicle is available.</li>
        <li>Do not misuse the site, try to access other people&rsquo;s information, or interfere with how it works.</li>
      </ul>

      <h2 style={h}>Applications and rentals</h2>
      <p>
        We review each application and may approve, ask for more information, or decline it. Rates, deposits, payment
        schedule, cancellation and refund terms, and your responsibilities for the vehicle are stated in your rental
        agreement and in the payment page you see before you pay. By signing the agreement electronically you confirm you
        agree to do business electronically.
      </p>

      <h2 style={h}>Text message program</h2>
      <p>
        Zivo sends text messages about rental requests, applications, pickup, payments, and your rental. You join only by
        checking the consent box on our forms or by messaging us first. Consent is not a condition of renting. Message
        frequency varies. Message and data rates may apply. Reply STOP to opt out at any time and HELP for help. Carriers
        are not liable for delayed or undelivered messages. See our <a href="/privacy">Privacy policy</a> for how we
        handle your information.
      </p>

      <h2 style={h}>Payments</h2>
      <p>
        Card payments are processed by Stripe. By saving a card you authorize Zivo to charge it for amounts you owe under
        your rental agreement, as that agreement describes.
      </p>

      <h2 style={h}>Disclaimers and limits</h2>
      <p>
        The site is provided &ldquo;as is.&rdquo; To the extent the law allows, Zivo is not liable for indirect or
        consequential losses from using the site. Nothing here limits rights that cannot be limited by law or what your
        rental agreement says about the vehicle.
      </p>

      <h2 style={h}>Governing law</h2>
      <p>These terms are governed by the laws of the State of Tennessee.</p>

      <h2 style={h}>Changes</h2>
      <p>We may update these terms. The date above shows the latest version.</p>
    </LegalPage>
  );
}
