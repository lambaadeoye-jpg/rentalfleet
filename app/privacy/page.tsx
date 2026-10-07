import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Zivo collects, uses, and protects your information.",
  alternates: { canonical: "/privacy" },
};

const h = { fontSize: 20, margin: "32px 0 8px" } as const;

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what Zivo Mobility LLC (&ldquo;Zivo,&rdquo; &ldquo;we&rdquo;) collects when you request or
        rent a vehicle through rentzivo.com, how we use it, and the choices you have.
      </p>

      <h2 style={h}>What we collect</h2>
      <ul>
        <li>Contact details: name, mobile number, and email.</li>
        <li>Rental details: the driving platforms you work for, your desired start date, vehicle preferences, and your messages to us.</li>
        <li>Application and rental documents you choose to upload, such as a driver&rsquo;s license and proof of insurance, and the agreement you sign.</li>
        <li>Payment details. Card numbers are handled by our payment processor, Stripe. We keep only the card brand, last four digits, and expiry date.</li>
        <li>How you reached us: the page, link, or ad that brought you here, and basic technical data such as IP address and browser type.</li>
        <li>Text messages and call records between you and Zivo.</li>
      </ul>

      <h2 style={h}>How we use it</h2>
      <ul>
        <li>To respond to your request, review your application, and prepare your rental.</li>
        <li>To collect rent, deposits, and other amounts you owe under your rental agreement, and to send receipts and payment reminders.</li>
        <li>To text or call you about your request or rental. Marketing or follow-up texts are sent only if you checked the optional consent box.</li>
        <li>To keep our service safe, prevent fraud, and meet legal and insurance requirements.</li>
        <li>To understand which of our channels bring in renters, so we can improve them.</li>
      </ul>

      <h2 style={h}>Texts and calls</h2>
      <p>
        If you opt in, we send text messages about your rental request and rental. Message frequency varies. Message and
        data rates may apply. Reply STOP at any time to stop texts, or HELP for help. Consent to marketing messages is not
        required to rent a vehicle. <strong>We do not share your mobile number or text-messaging opt-in with third parties
        or affiliates for their marketing or promotional purposes.</strong> Some of our calls may be placed or answered by
        an automated voice assistant, and calls may be recorded or transcribed to help us serve you.
      </p>

      <h2 style={h}>Who we share it with</h2>
      <p>
        We share information only with service providers that help us run Zivo, and only for that purpose: payment
        processing (Stripe), text messaging and calling, email delivery, cloud hosting and database, and document storage.
        We may also disclose information when the law requires it, to protect rights and safety, or to our insurers
        regarding a claim. If we run online ads, advertising and analytics tools from Meta and Google may record that you visited our site or submitted a request (never your name, phone, or email) so we can measure whether our ads work. We do not sell your personal information.
      </p>

      <h2 style={h}>How long we keep it</h2>
      <p>
        We keep rental, payment, and agreement records for as long as needed to run your rental, handle disputes and
        claims, and satisfy legal, tax, and insurance obligations. Requests that never become a rental are kept for a
        limited time, then deleted or anonymized.
      </p>

      <h2 style={h}>Security</h2>
      <p>
        We use access controls, encryption in transit, and private storage for uploaded documents. No system is perfectly
        secure, so please use a strong email password and do not share your sign-in links.
      </p>

      <h2 style={h}>Your choices</h2>
      <ul>
        <li>Stop texts any time by replying STOP.</li>
        <li>Ask us to see, correct, or delete your information by contacting us below. We will honor what the law requires and tell you if we must keep something.</li>
      </ul>

      <h2 style={h}>Children</h2>
      <p>Our service is for adults. We do not knowingly collect information from anyone under 18.</p>

      <h2 style={h}>Changes</h2>
      <p>We will post updates here and change the date above.</p>
    </LegalPage>
  );
}
