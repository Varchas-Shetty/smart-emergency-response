import { SeraShell } from "@/app/sera-shell";
import { getPostgresPool } from "@/db/postgres";
import IncidentForm from "./form";
export const dynamic="force-dynamic";
export default async function NewIncidentPage(){const types=await getPostgresPool().query("SELECT incident_type_id,type_name FROM incident_types WHERE is_active ORDER BY type_name");return <SeraShell><div className="mb-6"><p className="text-sm text-teal-700">Incident operations</p><h1 className="mt-1 text-3xl font-semibold">Report an incident</h1><p className="mt-2 text-sm text-slate-500">Create an incident record using synthetic operational information.</p></div><IncidentForm types={types.rows}/></SeraShell>}
