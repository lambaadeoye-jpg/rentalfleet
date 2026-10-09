import { createClient } from "@/lib/supabase/server";
import ReportForms from "./report-forms";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle").select("id, year, make, model, plate").not("status", "in", "(sold)").order("created_at", { ascending: true });
  const vehicles = (data ?? []).map((v: any) => ({
    id: v.id as string,
    label: `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}${v.plate ? ` · ${v.plate}` : ""}`,
  }));

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1 className="page-title">Report</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>Tell the office about a problem with a car, or log a toll or ticket you found. The office takes it from here.</p>
      <ReportForms vehicles={vehicles} />
    </div>
  );
}
