import { notFound } from "next/navigation";
import { getRecoveryCaseDetail } from "../actions";
import RecoveryCaseDetailClient from "./recovery-case-detail";

export const dynamic = "force-dynamic";

export default async function RecoveryCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recoveryCase = await getRecoveryCaseDetail(id);
  if (!recoveryCase) notFound();

  return (
    <div className="page">
      <h1 className="page-title">{recoveryCase.customerName}</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Recovery case · opened {new Date(recoveryCase.createdAt).toLocaleDateString()}
      </p>
      <RecoveryCaseDetailClient recoveryCase={recoveryCase} />
    </div>
  );
}
