"use client";

import { useState } from "react";

type Dispatch = { dispatch_id:number;incident_id:number;summary:string;dispatch_status:string;created_at:string|Date;team_name:string };
export function VehicleHistory({dispatches}:{dispatches:Dispatch[]}){
 const [open,setOpen]=useState(false);
 return <div><button onClick={()=>setOpen(!open)} className="text-xs text-teal-800">{open?"Hide":"View"} dispatch history</button>{open&&<ul className="mt-2 space-y-1 text-xs">{dispatches.map(r=><li key={r.dispatch_id}>#{r.dispatch_id} · incident #{r.incident_id} · {r.summary} · {r.dispatch_status} · {r.team_name} · {new Date(r.created_at).toLocaleString()}</li>)}{dispatches.length===0&&<li>No dispatch history.</li>}</ul>}</div>;
}
