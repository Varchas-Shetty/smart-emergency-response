import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { MutationForm } from "@/app/operations/mutation-form";
import { getPostgresPool } from "@/db/postgres";
import { getActor } from "@/lib/auth";
import { BedActions } from "./actions";

export const dynamic = "force-dynamic";
type Search = Promise<{ q?: string; type?: string; status?: string; hospitalId?: string }>;

export default async function BedsPage({ searchParams }: { searchParams: Search }) {
  const actor = await getActor(); const search = await searchParams; const values: (string | number)[] = []; const where = ["true"];
  if (actor?.role_name !== "ADMIN") { values.push(actor?.hospital_id ?? 0); where.push(`b.hospital_id=$${values.length}`); }
  const hospitalId = search.hospitalId; if (actor?.role_name === "ADMIN" && hospitalId && hospitalId !== "all") { const id = Number(hospitalId); if (Number.isSafeInteger(id) && id > 0) { values.push(id); where.push(`b.hospital_id=$${values.length}`); } }
  if (search.q?.trim()) { values.push(`%${search.q.trim()}%`); where.push(`(b.bed_code ILIKE $${values.length} OR b.bed_type ILIKE $${values.length})`); }
  if (search.type) { values.push(search.type); where.push(`b.bed_type=$${values.length}`); }
  if (search.status && ["AVAILABLE","RESERVED","OCCUPIED","OUT_OF_SERVICE"].includes(search.status)) { values.push(search.status); where.push(`b.bed_status=$${values.length}`); }
  const [beds,hospitals,incidents] = await Promise.all([
    getPostgresPool().query(`SELECT b.bed_id,b.hospital_id,h.hospital_name,b.bed_code,b.bed_type,b.bed_status,a.bed_assignment_id,a.incident_id,a.assignment_status FROM hospital_beds b JOIN hospitals h USING(hospital_id) LEFT JOIN LATERAL (SELECT bed_assignment_id,incident_id,assignment_status FROM bed_assignments WHERE bed_id=b.bed_id ORDER BY reserved_at DESC LIMIT 1) a ON true WHERE ${where.join(" AND ")} ORDER BY h.hospital_name,b.bed_code`, values),
    actor?.role_name === "ADMIN" ? getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE is_active ORDER BY hospital_name") : getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE hospital_id=$1 AND is_active", [actor?.hospital_id ?? 0]),
    getPostgresPool().query(`SELECT incident_id,hospital_id,summary FROM emergency_incidents WHERE hospital_id IS NOT NULL AND incident_status NOT IN ('CLOSED','CANCELLED','RESOLVED') ${actor?.role_name === "ADMIN" ? "" : "AND hospital_id=$1"} ORDER BY created_at DESC`, actor?.role_name === "ADMIN" ? [] : [actor?.hospital_id ?? 0]),
  ]);
  const bedTypes = [...new Set(beds.rows.map((bed) => bed.bed_type as string))];
  return <SeraShell><PageHeading title="Bed administration" description="Create and update beds, reserve capacity for incidents, and review assignment history."/>
    <form method="get" className="mt-5 flex flex-wrap gap-2"><input name="q" defaultValue={search.q} placeholder="Search bed code or type" className="rounded-lg border p-2 text-sm"/><select name="hospitalId" defaultValue={hospitalId ?? "all"} className="rounded-lg border p-2 text-sm"><option value="all">All hospitals</option>{hospitals.rows.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}</select><select name="type" defaultValue={search.type ?? ""} className="rounded-lg border p-2 text-sm"><option value="">All types</option>{bedTypes.map((type) => <option key={type}>{type}</option>)}</select><select name="status" defaultValue={search.status ?? ""} className="rounded-lg border p-2 text-sm"><option value="">All statuses</option>{["AVAILABLE","RESERVED","OCCUPIED","OUT_OF_SERVICE"].map((status) => <option key={status}>{status}</option>)}</select><button className="rounded-lg border px-4 text-sm">Filter</button></form>
    <MutationForm title="Add a hospital bed" operation="bed.create" fields={[{name:"hospitalId",label:"Hospital",type:"select",required:true,pathOnly:true,options:hospitals.rows.map((h) => ({label:h.hospital_name,value:String(h.hospital_id)}))}, {name:"bedCode",label:"Bed code",required:true},{name:"bedType",label:"Bed type",required:true}]}/>
    <DataTable columns={["Hospital","Bed","Type","Status","Latest assignment","Manage"]} rows={beds.rows.map((bed) => [bed.hospital_name,bed.bed_code,bed.bed_type,bed.bed_status,bed.incident_id ? `Incident #${bed.incident_id} · ${bed.assignment_status}` : "No assignment",<BedActions key={bed.bed_id} bedId={bed.bed_id} bedCode={bed.bed_code} bedType={bed.bed_type} bedStatus={bed.bed_status} assignmentId={bed.bed_assignment_id} assignmentStatus={bed.assignment_status} incidentId={bed.incident_id} incidents={incidents.rows.filter((incident) => incident.hospital_id === bed.hospital_id)}/>])}/>
  </SeraShell>;
}
