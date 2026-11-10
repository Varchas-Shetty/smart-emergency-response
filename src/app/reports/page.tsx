import Link from "next/link";
import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { getPostgresPool } from "@/db/postgres";
import { getActor } from "@/lib/auth";
import { ReportForm } from "./form";
import { ReportActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const actor = await getActor();
  const values = actor?.role_name === "ADMIN" ? [] : [actor?.hospital_id];
  const [reports, types, hospitals] = await Promise.all([
    getPostgresPool().query(`SELECT report_id,hospital_id,description,report_status,reported_at FROM citizen_reports ${values.length ? "WHERE hospital_id=$1" : ""} ORDER BY reported_at DESC LIMIT 300`, values),
    getPostgresPool().query("SELECT incident_type_id,type_name FROM incident_types WHERE is_active ORDER BY type_name"),
    actor?.role_name === "ADMIN" ? getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE is_active ORDER BY hospital_name") : Promise.resolve({ rows: [] }),
  ]);
  return <SeraShell><div className="flex justify-between"><PageHeading title="Emergency reports" description="Submit reports, review them, and convert reviewed reports into incidents."/><Link href="/reports/analytics" className="text-sm text-teal-800">Analytics →</Link></div><ReportForm types={types.rows} hospitals={hospitals.rows} admin={actor?.role_name === "ADMIN"}/><DataTable columns={["Report","Hospital","Description","Status","Reported","Actions"]} rows={reports.rows.map((row) => [row.report_id,row.hospital_id,row.description,row.report_status,new Date(row.reported_at).toLocaleString(),<ReportActions key={row.report_id} id={row.report_id} status={row.report_status}/>])}/></SeraShell>;
}
