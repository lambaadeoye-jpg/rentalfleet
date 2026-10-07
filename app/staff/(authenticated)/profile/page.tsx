import { getMyStaffProfile } from "./actions";
import StaffProfileForm from "./staff-profile-form";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage() {
  const profile = await getMyStaffProfile();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>My profile</h1>
      <StaffProfileForm initialFullName={profile.fullName} email={profile.email} isAdmin={profile.isAdmin} />
    </div>
  );
}
