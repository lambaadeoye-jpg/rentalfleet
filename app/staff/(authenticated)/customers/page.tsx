import { searchCustomers } from "./actions";
import CustomerSearch from "./customer-search";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const customers = await searchCustomers(q ?? "");

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Customers</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Search by name, email, or phone. Click through for the full history -- CRM, rentals,
        payments, insurance, documents, all in one place.
      </p>
      <CustomerSearch initialQuery={q ?? ""} customers={customers} />
    </div>
  );
}
