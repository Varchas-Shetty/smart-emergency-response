import Link from "next/link";
import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { getPostgresPool } from "@/db/postgres";
import { getActor } from "@/lib/auth";
import { MutationForm } from "@/app/operations/mutation-form";

export const dynamic = "force-dynamic";
type Search = Promise<{ q?: string; active?: string }>;

export default async function HospitalsPage({ searchParams }: { searchParams: Search }) {
  const actor = await getActor(); const search = await searchParams; const values: (string | number | boolean)[] = []; const where = ["true"];
  if (actor?.role_name !== "ADMIN") { values.push(actor?.hospital_id ?? 0); where.push(`h.hospital_id=$${values.length}`); }
  const q = search.q?.trim(); if (q) { values.push(`%${q}%`); where.push(`(h.hospital_name ILIKE $${values.length} OR h.hospital_code ILIKE $${values.length} OR l.locality ILIKE $${values.length})`); }
  if (actor?.role_name === "ADMIN" && (search.active === "true" || search.active === "false")) { values.push(search.active === "true"); where.push(`h.is_active=$${values.length}`); }
  const hospitals = await getPostgresPool().query(`SELECT h.hospital_id,h.hospital_code,h.hospital_name,h.is_active,l.locality,(SELECT count(*)::int FROM hospital_beds b WHERE b.hospital_id=h.hospital_id) total_beds,(SELECT count(*)::int FROM hospital_beds b WHERE b.hospital_id=h.hospital_id AND b.bed_status='AVAILABLE') available_beds,(SELECT count(*)::int FROM emergency_incidents i WHERE i.hospital_id=h.hospital_id AND i.incident_status NOT IN ('RESOLVED','CLOSED','CANCELLED')) active_incidents,(SELECT coalesce(sum(ri.quantity_on_hand-ri.quantity_reserved),0)::int FROM resource_inventory ri WHERE ri.hospital_id=h.hospital_id) available_units,(SELECT count(*)::int FROM response_teams t WHERE t.hospital_id=h.hospital_id AND t.team_status='AVAILABLE') available_teams,(SELECT count(*)::int FROM vehicles v WHERE v.hospital_id=h.hospital_id AND v.vehicle_status='AVAILABLE') available_vehicles FROM hospitals h JOIN locations l USING(location_id) WHERE ${where.join(" AND ")} ORDER BY h.hospital_name`, values);
  return <SeraShell><PageHeading title="Hospital administration" description="Manage facilities, capacity, readiness, and hospital-specific operational totals."/>
    <form method="get" className="mt-5 flex flex-wrap gap-2"><input name="q" defaultValue={q} placeholder="Search name, code, locality" className="rounded-lg border p-2 text-sm"/><select name="active" defaultValue={search.active ?? "all"} className="rounded-lg border p-2 text-sm"><option value="all">All activity</option><option value="true">Active</option><option value="false">Inactive</option></select><button className="rounded-lg border px-4 text-sm">Filter</button></form>
    {actor?.role_name === "ADMIN" && <MutationForm title="Register hospital" operation="hospital.create" fields={[{name:"hospitalCode",label:"Hospital code",required:true},{name:"hospitalName",label:"Hospital name",required:true},{name:"address",label:"Address",required:true},{name:"locality",label:"Locality",required:true},{name:"latitude",label:"Latitude",type:"number",required:true,min:-90,max:90,step:"any",value:0},{name:"longitude",label:"Longitude",type:"number",required:true,min:-180,max:180,step:"any",value:0},{name:"phone",label:"Phone",nullable:true},{name:"email",label:"Email",type:"email",nullable:true}]}/>}
    <DataTable columns={["Hospital","Code","Locality","Status","Beds","Incidents","Available stock","Teams","Vehicles"]} rows={hospitals.rows.map((h) => [<Link className="font-medium text-teal-800" href={`/hospitals/${h.hospital_id}`} key={h.hospital_id}>{h.hospital_name}</Link>,h.hospital_code,h.locality,h.is_active?"Active":"Inactive",`${h.available_beds}/${h.total_beds}`,h.active_incidents,h.available_units,h.available_teams,h.available_vehicles])}/>
  </SeraShell>;
}
