"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchCustomers, type CustomerListItem } from "./actions";
import { sentenceCase } from "@/lib/format-label";
import { formatPhone } from "@/lib/format-phone";

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
        <table className="data-table">
          <thead>
            <tr>
              {["Name", "Email", "Phone", "Status"].map((h) => (
                <th key={h}>
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
                <td className="cell-strong">
                  {c.firstName} {c.lastName}
                </td>
                <td className="cell-muted">{c.email ?? "—"}</td>
                <td className="cell-muted">{c.phone ? formatPhone(c.phone) : "—"}</td>
                <td>{sentenceCase(c.status)}</td>
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
