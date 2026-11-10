"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MutationForm } from "@/app/operations/mutation-form";
import runApplicationAction from "@/app/actions";

type Incident = { incident_id: number; summary: string };

export function BedActions({ bedId, bedCode, bedType, bedStatus, assignmentId, assignmentStatus, incidentId, incidents }: { bedId: number; bedCode: string; bedType: string; bedStatus: string; assignmentId: number | null; assignmentStatus: string | null; incidentId: number | null; incidents: Incident[] }) {
  const router = useRouter(); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  async function assign(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); const result = await runApplicationAction({ type: "bed.reserve", id: bedId, values: { incidentId: Number(form.get("incidentId")) } }); setBusy(false); if (!result.ok) { setError(result.error ?? "Reservation failed"); return; } setError(""); router.refresh(); }
  async function transition(status: "OCCUPIED" | "RELEASED") { if (!assignmentId) return; setBusy(true); const result = await runApplicationAction({ type: "bed.assignment.update", id: assignmentId, values: { assignmentStatus: status } }); setBusy(false); if (!result.ok) { setError(result.error ?? "Assignment update failed"); return; } router.refresh(); }
  return <div className="min-w-64 space-y-2"><Link className="text-xs text-teal-800" href={`/beds/${bedId}`}>Assignment history</Link>
    <MutationForm operation="bed.update" id={bedId} buttonLabel="Save bed" fields={[{name:"bedCode",label:"Code",required:true,value:bedCode},{name:"bedType",label:"Type",required:true,value:bedType},...(["AVAILABLE","OUT_OF_SERVICE"].includes(bedStatus)?[{name:"bedStatus",label:"Availability",type:"select" as const,required:true,value:bedStatus,options:[{label:"Available",value:"AVAILABLE"},{label:"Out of service",value:"OUT_OF_SERVICE"}]}]:[])]} className="gap-2 p-2"/>
    {bedStatus === "AVAILABLE" && incidents.length > 0 && <form onSubmit={assign} className="flex gap-1"><select name="incidentId" required className="min-w-0 rounded border p-1 text-xs">{incidents.map((incident) => <option key={incident.incident_id} value={incident.incident_id}>#{incident.incident_id} {incident.summary.slice(0,30)}</option>)}</select><button disabled={busy} className="rounded bg-teal-700 px-2 py-1 text-xs text-white">Reserve</button></form>}
    {assignmentId && ["RESERVED","OCCUPIED"].includes(assignmentStatus ?? "") && <div className="flex gap-1">{assignmentStatus === "RESERVED" && <button disabled={busy} onClick={() => transition("OCCUPIED")} className="rounded border px-2 py-1 text-xs">Mark occupied</button>}<button disabled={busy} onClick={() => transition("RELEASED")} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800">Release</button>{incidentId && <Link href={`/incidents/${incidentId}`} className="p-1 text-xs text-teal-800">Incident #{incidentId}</Link>}</div>}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}
