import Link from "next/link";
import { notFound } from "next/navigation";
import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { MutationForm } from "@/app/operations/mutation-form";
import { getPostgresPool } from "@/db/postgres";
import { getActor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HospitalDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const actor = await getActor();
  if (!Number.isSafeInteger(id) || id < 1 || (actor?.role_name !== "ADMIN" && actor?.hospital_id !== id)) notFound();
  const [hospital,beds,resources] = await Promise.all([
    getPostgresPool().query("SELECT h.*,l.address,l.locality,l.latitude,l.longitude,(SELECT count(*)::int FROM hospital_beds b WHERE b.hospital_id=h.hospital_id) total_beds,(SELECT count(*)::int FROM hospital_beds b WHERE b.hospital_id=h.hospital_id AND b.bed_status='AVAILABLE') available_beds,(SELECT count(*)::int FROM emergency_incidents i WHERE i.hospital_id=h.hospital_id AND i.incident_status NOT IN ('RESOLVED','CLOSED','CANCELLED')) active_incidents,(SELECT coalesce(sum(quantity_on_hand-quantity_reserved),0)::int FROM resource_inventory ri WHERE ri.hospital_id=h.hospital_id) available_units,(SELECT count(*)::int FROM response_teams t WHERE t.hospital_id=h.hospital_id AND t.team_status='AVAILABLE') available_teams,(SELECT count(*)::int FROM vehicles v WHERE v.hospital_id=h.hospital_id AND v.vehicle_status='AVAILABLE') available_vehicles FROM hospitals h JOIN locations l USING(location_id) WHERE hospital_id=$1", [id]),
    getPostgresPool().query("SELECT b.bed_id,b.bed_code,b.bed_type,b.bed_status,a.incident_id,a.assignment_status FROM hospital_beds b LEFT JOIN LATERAL (SELECT incident_id,assignment_status FROM bed_assignments WHERE bed_id=b.bed_id ORDER BY reserved_at DESC LIMIT 1) a ON true WHERE b.hospital_id=$1 ORDER BY b.bed_code", [id]),
    getPostgresPool().query("SELECT rt.resource_name,rt.unit,ri.quantity_on_hand,ri.quantity_reserved,ri.quantity_on_hand-ri.quantity_reserved available FROM resource_inventory ri JOIN resource_types rt USING(resource_type_id) WHERE ri.hospital_id=$1 ORDER BY rt.resource_name", [id]),
  ]);
  if (!hospital.rowCount) notFound(); const h = hospital.rows[0];
  return <SeraShell><div className="flex flex-wrap items-start justify-between gap-4"><PageHeading title={h.hospital_name} description={`${h.hospital_code} · ${h.address}, ${h.locality} · ${h.is_active ? "Active" : "Inactive"}`}/><Link href="/hospitals" className="text-sm text-teal-800">← Hospitals</Link></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[["Beds",`${h.available_beds} available / ${h.total_beds}`],["Active incidents",h.active_incidents],["Available stock units",h.available_units],["Available teams",h.available_teams],["Available vehicles",h.available_vehicles],["Contact",h.phone||h.email||"Not set"]].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 font-semibold">{value}</p></div>)}</div>
    {actor?.role_name === "ADMIN" && <MutationForm title="Edit hospital details and activation" operation="hospital.update" id={id} buttonLabel="Save hospital" fields={[{name:"hospitalCode",label:"Hospital code",required:true,value:h.hospital_code},{name:"hospitalName",label:"Hospital name",required:true,value:h.hospital_name},{name:"address",label:"Address",required:true,value:h.address},{name:"locality",label:"Locality",required:true,value:h.locality},{name:"latitude",label:"Latitude",type:"number",required:true,min:-90,max:90,step:"any",value:h.latitude},{name:"longitude",label:"Longitude",type:"number",required:true,min:-180,max:180,step:"any",value:h.longitude},{name:"phone",label:"Phone",nullable:true,value:h.phone},{name:"email",label:"Email",type:"email",nullable:true,value:h.email},{name:"isActive",label:"Hospital active",type:"checkbox",value:h.is_active}]}/>}
    <div className="mt-8 flex items-center justify-between"><h2 className="text-xl font-semibold">Bed capacity</h2><Link className="text-sm text-teal-800" href={`/beds?hospitalId=${id}`}>Manage beds →</Link></div><DataTable columns={["Bed","Type","Status","Active incident"]} rows={beds.rows.map((b)=>[b.bed_code,b.bed_type,b.bed_status,b.incident_id ? <Link className="text-teal-800" href={`/incidents/${b.incident_id}`} key={b.incident_id}>#{b.incident_id} · {b.assignment_status}</Link> : "—"])}/>
    <div className="mt-8 flex items-center justify-between"><h2 className="text-xl font-semibold">Medical inventory</h2><Link className="text-sm text-teal-800" href={`/resources?hospitalId=${id}`}>Manage stock →</Link></div><DataTable columns={["Resource","Unit","On hand","Reserved","Available"]} rows={resources.rows.map((r)=>[r.resource_name,r.unit,r.quantity_on_hand,r.quantity_reserved,r.available])}/>
  </SeraShell>;
}
