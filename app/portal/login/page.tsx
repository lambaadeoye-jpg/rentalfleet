import PortalLoginForm from "./portal-login-form";

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <PortalLoginForm inactiveTimeout={reason === "inactive"} />;
}
