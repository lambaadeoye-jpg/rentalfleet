import { getRedFlagEntries, getFlaggedLeads } from "./actions";
import RedFlagManager from "./red-flag-manager";

export const dynamic = "force-dynamic";

export default async function RedFlagsPage() {
  const [entries, flaggedLeads] = await Promise.all([getRedFlagEntries(), getFlaggedLeads()]);

  return (
    <div className="page">
      <h1 className="page-title">Red flag list</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Internal only — never shared with or sourced from other businesses. A match flags a lead
        for review, it never auto-rejects anyone.
      </p>
      <RedFlagManager initialEntries={entries} flaggedLeads={flaggedLeads} />
    </div>
  );
}
