import { SeraShell } from "@/app/sera-shell";
import { DataTable, PageHeading } from "@/app/data-table";
import { MutationForm } from "@/app/operations/mutation-form";
import { getActor } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { TeamManage } from "./manage";

export const dynamic = "force-dynamic";
type Search = Promise<{ q?: string; status?: string; hospitalId?: string }>;

export default async function TeamsPage({ searchParams }: { searchParams: Search }) {
  const actor=await getActor();const search=await searchParams;const values:(string|number)[]=[];const where=["true"];
  if(actor?.role_name!=="ADMIN"){values.push(actor?.hospital_id??0);where.push(`t.hospital_id=$${values.length}`)}
  const hospitalId=search.hospitalId;if(actor?.role_name==="ADMIN"&&hospitalId&&hospitalId!=="all"){const id=Number(hospitalId);if(Number.isSafeInteger(id)&&id>0){values.push(id);where.push(`t.hospital_id=$${values.length}`)}}
  if(search.q?.trim()){values.push(`%${search.q.trim()}%`);where.push(`t.team_name ILIKE $${values.length}`)}
  if(search.status&&["AVAILABLE","DISPATCHED","OFF_DUTY"].includes(search.status)){values.push(search.status);where.push(`t.team_status=$${values.length}`)}
  const [teams,hospitals,staff]=await Promise.all([
    getPostgresPool().query(`SELECT t.team_id,t.hospital_id,t.team_name,t.team_status,h.hospital_name,(SELECT count(*)::int FROM team_members tm WHERE tm.team_id=t.team_id AND tm.left_at IS NULL) active_members,(SELECT count(*)::int FROM dispatches d WHERE d.team_id=t.team_id AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) active_dispatches FROM response_teams t LEFT JOIN hospitals h USING(hospital_id) WHERE ${where.join(" AND ")} ORDER BY h.hospital_name NULLS FIRST,t.team_name`,values),
    actor?.role_name==="ADMIN"?getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE is_active ORDER BY hospital_name"):getPostgresPool().query("SELECT hospital_id,hospital_name FROM hospitals WHERE hospital_id=$1 AND is_active",[actor?.hospital_id??0]),
    getPostgresPool().query(`SELECT u.user_id,u.username,u.hospital_id FROM users u JOIN roles r USING(role_id) WHERE u.is_active AND r.role_name='HOSPITAL_STAFF' ${actor?.role_name==="ADMIN"?"":"AND u.hospital_id=$1"} ORDER BY u.username`,actor?.role_name==="ADMIN"?[]:[actor?.hospital_id??0]),
  ]);
  const members=await getPostgresPool().query("SELECT tm.team_member_id,tm.team_id,tm.user_id,u.username,tm.member_role FROM team_members tm JOIN users u USING(user_id) WHERE tm.left_at IS NULL ORDER BY u.username");
  return <SeraShell><PageHeading title="Response team management" description="Create teams, set readiness, manage hospital staff membership, and inspect active assignments."/>
    <form method="get" className="mt-5 flex flex-wrap gap-2"><input name="q" defaultValue={search.q} placeholder="Search teams" className="rounded-lg border p-2 text-sm"/><select name="hospitalId" defaultValue={hospitalId??"all"} className="rounded-lg border p-2 text-sm"><option value="all">All hospitals</option>{hospitals.rows.map(h=><option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}</select><select name="status" defaultValue={search.status??""} className="rounded-lg border p-2 text-sm"><option value="">All statuses</option>{["AVAILABLE","DISPATCHED","OFF_DUTY"].map(status=><option key={status}>{status}</option>)}</select><button className="rounded-lg border px-4 text-sm">Filter</button></form>
    <MutationForm title="Create response team" operation="team.create" fields={[{name:"teamName",label:"Team name",required:true},...(actor?.role_name==="ADMIN"?[{name:"hospitalId",label:"Home hospital",type:"select" as const,valueType:"number" as const,required:true,options:hospitals.rows.map(h=>({label:h.hospital_name,value:String(h.hospital_id)}))}]:[])]}/>
    <DataTable columns={["Team","Hospital","Status","Members","Active assignments","Manage team / members"]} rows={teams.rows.map(team=>[team.team_name,team.hospital_name??"Unassigned",team.team_status,team.active_members,team.active_dispatches,<TeamManage key={team.team_id} id={team.team_id} hospitalId={team.hospital_id} name={team.team_name} status={team.team_status} members={members.rows.filter(m=>m.team_id===team.team_id)} staff={staff.rows}/>])}/>
  </SeraShell>;
}
