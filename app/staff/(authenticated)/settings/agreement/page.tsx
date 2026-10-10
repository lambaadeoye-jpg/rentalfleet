import Link from "next/link";
import { listAgreementVersions } from "./template-actions";
import AgreementEditor from "./agreement-editor";

export const dynamic = "force-dynamic";

export default async function AgreementTemplatePage() {
  const versions = await listAgreementVersions();
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <Link href="/staff/settings" style={{ color: "var(--teal-dark)", fontSize: 13, fontWeight: 600 }}>← Settings</Link>
      <h1 style={{ fontSize: 24, margin: "8px 0 4px" }}>Rental agreement</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        The text renters sign. A renter can only sign an approved version, and approving locks that version for good so every
        signed copy can be traced to exact wording. To change approved text, make a new draft from it.
      </p>
      <AgreementEditor versions={versions} />
    </div>
  );
}
