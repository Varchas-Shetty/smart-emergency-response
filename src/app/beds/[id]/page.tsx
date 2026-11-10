import { notFound } from "next/navigation";
import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { getActor } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { BedActions } from "../actions";

export const dynamic = "force-dynamic";

export default async function BedHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const actor = await getActor();
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const bed = await getPostgresPool().query("SELECT b.*,h.hospital_name FROM hospital_beds b JOIN hospitals h USING(hospital_id) WHERE bed_id=$1 AND ($2='ADMIN' OR hospital_id=$3)", [id,actor?.role_name ?? "",actor?.hospital_id]);
  if (!bed.rowCount) notFound(); const current = bed.rows[0];
  const [history,incidents] = await Promise.all([
    getPostgresPool().query("SELECT a.bed_assignment_id,a.incident_id,i.summary,a.assignment_status,a.reserved_at,a.occupied_at,a.released_at,a.release_reason,u.username assigned_by,ru.username released_by FROM bed_assignments a JOIN emergency_incidents i USING(incident_id) JOIN users u ON u.user_id=a.assigned_by_user_id LEFT JOIN users ru ON ru.user_id=a.released_by_user_id WHERE a.bed_id=$1 ORDER BY a.reserved_at DESC", [id]),
    getPostgresPool().query("SELECT incident_id,hospital_id,summary FROM emergency_incidents WHERE hospital_id=$1 AND incident_status NOT IN ('RESOLVED','CLOSED','CANCELLED') ORDER BY created_at DESC", [current.hospital_id]),
  ]);
  const latest = history.rows[0];
  return <SeraShell><PageHeading title={`Bed ${current.bed_code}`} description={`${current.hospital_name} · ${current.bed_type} · ${current.bed_status}`}/><div className="mt-5 max-w-3xl"><BedActions bedId={id} bedCode={current.bed_code} bedType={current.bed_type} bedStatus={current.bed_status} assignmentId={latest?.bed_assignment_id ?? null} assignmentStatus={latest?.assignment_status ?? null} incidentId={latest?.incident_id ?? null} incidents={incidents.rows}/></div><h2 className="mt-8 text-xl font-semibold">Assignment history</h2><DataTable columns={["Incident","Status","Reserved","Occupied","Released","Assigned by","Released by","Reason"]} rows={history.rows.map((row) => [<a className="text-teal-800" href={`/incidents/${row.incident_id}`} key={row.incident_id}>#{row.incident_id} · {row.summary}</a>,row.assignment_status,new Date(row.reserved_at).toLocaleString(),row.occupied_at ? new Date(row.occupied_at).toLocaleString() : "—",row.released_at ? new Date(row.released_at).toLocaleString() : "—",row.assigned_by,row.released_by ?? "—",row.release_reason ?? "—"])}/></SeraShell>;
}
