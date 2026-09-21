"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchCustomers, type CustomerListItem } from "./actions";

export default function CustomerSearch({
  initialQuery,
  customers: initialCustomers,
}: {
  initialQuery: string;
  customers: CustomerListItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [customers, setCustomers] = useState(initialCustomers);
  const [isPending, startTransition] = useTransition();

  async function handleSearch(value: string) {
    setQuery(value);
    const results = await searchCustomers(value);
    setCustomers(results);
  }

  return (
    <div>
      <div style={{ position: "relative", maxWidth: 400, marginBottom: 20 }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-secondary)" }} />
        <input
          value={query}
          onChange={(e) => startTransition(() => handleSearch(e.target.value))}
          placeholder="Search customers..."
          style={{ paddingLeft: 36 }}
        />
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              {["Name", "Email", "Phone", "Status"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/staff/customers/${c.id}`)}
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
              >
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                  {c.firstName} {c.lastName}
                </td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{c.email ?? "—"}</td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{c.phone ?? "—"}</td>
                <td style={{ padding: "12px 16px", textTransform: "capitalize" }}>{c.status}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {isPending ? "Searching..." : "No customers found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
