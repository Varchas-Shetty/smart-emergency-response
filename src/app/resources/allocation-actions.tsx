"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import runApplicationAction from "@/app/actions";

export function AllocationActions({ id, status }: { id: number; status: string }) {
  const router = useRouter(); const [error,setError] = useState("");
  if (status !== "RESERVED") return <span className="text-slate-500">{status.toLowerCase()}</span>;
  async function update(allocationStatus: "CONSUMED" | "RELEASED") {
    const result = await runApplicationAction({ type: "allocation.update", id, values: { allocationStatus } });
    if (!result.ok) { setError(result.error ?? "Allocation update failed"); return; } router.refresh();
  }
  return <div className="flex gap-1"><button onClick={() => update("CONSUMED")} className="rounded border border-teal-700 px-2 py-1 text-xs text-teal-800">Consume</button><button onClick={() => update("RELEASED")} className="rounded border px-2 py-1 text-xs">Release</button>{error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}
