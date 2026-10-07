import { getMyStaffProfile } from "./actions";
import StaffProfileForm from "./staff-profile-form";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage() {
  const profile = await getMyStaffProfile();

  return (
    <div className="page">
      <h1 className="page-title" style={{ marginBottom: 20 }}>My profile</h1>
      <StaffProfileForm initialFullName={profile.fullName} email={profile.email} isAdmin={profile.isAdmin} />
    </div>
  );
}
