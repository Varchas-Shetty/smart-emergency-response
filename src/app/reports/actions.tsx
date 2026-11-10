"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import runApplicationAction from "@/app/actions";

export function ReportActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const act = async (action: "REVIEWED" | "REJECTED" | "CLOSED" | "CONVERT") => {
    const result = await runApplicationAction({
      type: action === "CONVERT" ? "report.convert" : "report.status",
      id,
      values: action === "CONVERT" ? {} : { reportStatus: action },
    });
    if (!result.ok) { setError(result.error ?? "Report update failed"); return; }
    setError("");
    router.refresh();
  };
  return <div className="flex flex-wrap gap-1">{status === "RECEIVED" && <><button onClick={() => act("REVIEWED")} className="rounded border px-2 py-1 text-xs">Review</button><button onClick={() => act("REJECTED")} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800">Reject</button></>}{status === "REVIEWED" && <><button onClick={() => act("CONVERT")} className="rounded border border-teal-700 px-2 py-1 text-xs text-teal-800">Create incident</button><button onClick={() => act("REJECTED")} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800">Reject</button></>}{["CONVERTED", "REJECTED"].includes(status) && <button onClick={() => act("CLOSED")} className="rounded border px-2 py-1 text-xs">Close</button>}{error && <span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}
