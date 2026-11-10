import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { MutationForm } from "@/app/operations/mutation-form";
import { getActor } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { VehicleHistory } from "./history";

export const dynamic="force-dynamic";
type Search=Promise<{q?:string;status?:string;hospitalId?:string}>;
export default async function VehiclesPage({searchParams}:{searchParams:Search}){
 const actor=await getActor();const search=await searchParams;const values:(string|number)[]=[];const where=["true"];
 if(actor?.role_name!=="ADMIN"){values.push(actor?.hospital_id??0);where.push(`v.hospital_id=$${values.length}`)}
 const hospitalId=search.hospitalId;if(actor?.role_name==="ADMIN"&&hospitalId&&hospitalId!=="all"){const id=Number(hospitalId);if(Number.isSafeInteger(id)&&id>0){values.push(id);where.push(`v.hospital_id=$${values.length}`)}}
 if(search.q?.trim()){values.push(`%${search.q.trim()}%`);where.push(`(v.registration_number ILIKE $${values.length} OR v.vehicle_type ILIKE $${values.length})`)}
 if(search.status&&["AVAILABLE","DISPATCHED","MAINTENANCE"].includes(search.status)){values.push(search.status);where.push(`v.vehicle_status=$${values.length}`)}
 const [vehicles,hospitals]=await Promise.all([
  getPostgresPool().query(`SELECT v.vehicle_id,v.hospital_id,v.registration_number,v.vehicle_type,v.vehicle_status,h.hospital_name,(SELECT count(*)::int FROM dispatches d WHERE d.vehicle_id=v.vehicle_id AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) active_dispatches FROM vehicles v LEFT JOIN hospitals h USING(hospital_id) WHERE ${where.join(" AND ")} ORDER BY h.hospital_name NULLS FIRST,v.registration_number`,values),
  actor?.role_name==="ADMIN"?getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE is_active ORDER BY hospital_name"):getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE hospital_id=$1 AND is_active",[actor?.hospital_id??0]),
 ]);
 const vehicleIds=vehicles.rows.map((vehicle)=>vehicle.vehicle_id);
 const histories=await getPostgresPool().query(
  `WITH ranked_dispatches AS (
    SELECT d.vehicle_id,d.dispatch_id,d.incident_id,i.summary,d.dispatch_status,d.created_at,t.team_name,
      row_number() OVER (PARTITION BY d.vehicle_id ORDER BY d.created_at DESC) AS history_rank
    FROM dispatches d
    JOIN emergency_incidents i USING(incident_id)
    JOIN response_teams t USING(team_id)
    WHERE d.vehicle_id=ANY($1::int[])
  )
  SELECT vehicle_id,dispatch_id,incident_id,summary,dispatch_status,created_at,team_name
  FROM ranked_dispatches WHERE history_rank<=200 ORDER BY vehicle_id,created_at DESC`,
  [vehicleIds],
 );
 const historyByVehicle=new Map<number,typeof histories.rows>();
 for(const history of histories.rows){
  const entries=historyByVehicle.get(history.vehicle_id)??[];
  entries.push(history);
  historyByVehicle.set(history.vehicle_id,entries);
 }
 return <SeraShell><PageHeading title="Vehicle management" description="Register vehicles, update readiness, search by hospital, and inspect dispatch history."/>
  <form method="get" className="mt-5 flex flex-wrap gap-2"><input name="q" defaultValue={search.q} placeholder="Search registration or type" className="rounded-lg border p-2 text-sm"/><select name="hospitalId" defaultValue={hospitalId??"all"} className="rounded-lg border p-2 text-sm"><option value="all">All hospitals</option>{hospitals.rows.map(h=><option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}</select><select name="status" defaultValue={search.status??""} className="rounded-lg border p-2 text-sm"><option value="">All statuses</option>{["AVAILABLE","DISPATCHED","MAINTENANCE"].map(status=><option key={status}>{status}</option>)}</select><button className="rounded-lg border px-4 text-sm">Filter</button></form>
  <MutationForm title="Register vehicle" operation="vehicle.create" fields={[{name:"registrationNumber",label:"Registration number",required:true},{name:"vehicleType",label:"Vehicle type",required:true},...(actor?.role_name==="ADMIN"?[{name:"hospitalId",label:"Home hospital",type:"select" as const,valueType:"number" as const,required:true,options:hospitals.rows.map(h=>({label:h.hospital_name,value:String(h.hospital_id)}))}]:[])]}/>
  <DataTable columns={["Registration","Type","Hospital","Status","Active dispatches","Manage","History"]} rows={vehicles.rows.map(v=>[v.registration_number,v.vehicle_type,v.hospital_name??"Unassigned",v.vehicle_status,v.active_dispatches,<MutationForm key={v.vehicle_id} operation="vehicle.update" id={v.vehicle_id} buttonLabel="Save vehicle" className="p-2" fields={[{name:"registrationNumber",label:"Registration",required:true,value:v.registration_number},{name:"vehicleType",label:"Vehicle type",required:true,value:v.vehicle_type},...(v.vehicle_status==="DISPATCHED"?[]:[{name:"vehicleStatus",label:"Status",type:"select" as const,required:true,value:v.vehicle_status,options:[{label:"Available",value:"AVAILABLE"},{label:"Maintenance",value:"MAINTENANCE"}]}])]}/>,<VehicleHistory key={`history-${v.vehicle_id}`} dispatches={historyByVehicle.get(v.vehicle_id)??[]}/>])}/>
 </SeraShell>;
}
