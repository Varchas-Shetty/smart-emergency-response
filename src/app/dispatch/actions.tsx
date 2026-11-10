"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import runApplicationAction from "@/app/actions";

const next: Record<string, string> = { QUEUED: "DISPATCHED", DISPATCHED: "EN_ROUTE", EN_ROUTE: "ON_SCENE", ON_SCENE: "COMPLETED", TRANSPORTING: "COMPLETED" };

export function DispatchActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const action = next[status];
  if (!action) return <span className="text-slate-500">—</span>;
  async function update(dispatchStatus:string) {
    const result=await runApplicationAction({type:"dispatch.update",id,values:{dispatchStatus}});
    if(!result.ok){setError(result.error??"Dispatch update failed");return}
    setError("");
    router.refresh();
  }
  return <div className="flex items-center gap-2"><button className="rounded border border-teal-700 px-2 py-1 text-xs text-teal-800" onClick={() => update(action)}>{action.replaceAll("_", " ")}</button>{["QUEUED", "DISPATCHED", "EN_ROUTE"].includes(status) && <button className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800" onClick={() => update("CANCELLED")}>Cancel</button>}{error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}
