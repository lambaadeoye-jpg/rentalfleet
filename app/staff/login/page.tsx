import StaffLoginForm from "./staff-login-form";

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <StaffLoginForm inactiveTimeout={reason === "inactive"} />;
}
