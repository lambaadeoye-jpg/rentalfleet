import { getTeamData, getRoles } from "./actions";
import InviteForm from "./invite-form";
import TeamList from "./team-list";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const [{ staff, invites }, roles] = await Promise.all([getTeamData(), getRoles()]);

  return (
    <div className="page">
      <h1 className="page-title">Team</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        {staff.length} staff member{staff.length === 1 ? "" : "s"}.
      </p>

      <InviteForm roles={roles} />

      <div style={{ marginTop: 24 }}>
        <TeamList staff={staff} invites={invites} />
      </div>
    </div>
  );
}
