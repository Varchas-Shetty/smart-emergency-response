"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import runApplicationAction from "@/app/actions";

export type MutationField = { name: string; label: string; type?: "text" | "email" | "number" | "checkbox" | "select"; valueType?: "number"; required?: boolean; nullable?: boolean; min?: string | number; max?: string | number; step?: string; value?: string | number | boolean | null; options?: { label: string; value: string }[]; pathOnly?: boolean };

export function MutationForm({ title, operation, id, fields, buttonLabel = "Save", className = "" }: { title?: string; operation: string; id?: number; fields: MutationField[]; buttonLabel?: string; className?: string }) {
  const router = useRouter(); const [error,setError] = useState(""); const [message,setMessage] = useState("");
  return <form className={`grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 ${className}`} onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const body: Record<string, unknown> = {};
    for (const field of fields) {
      const control = form.elements.namedItem(field.name) as HTMLInputElement | HTMLSelectElement | null;
      if (!control) continue;
      let value: unknown = field.type === "checkbox" ? (control as HTMLInputElement).checked : values.get(field.name);
      if ((field.type === "number" || field.valueType === "number") && value !== null && value !== "") value = Number(value);
      if (field.nullable && value === "") value = null;
      if (!field.pathOnly) body[field.name] = value;
    }
    const hospitalId = Number(values.get("hospitalId")) || undefined;
    const result = await runApplicationAction({ type: operation, id, hospitalId, values: body });
    if (!result.ok) { setError(result.error ?? "The update could not be saved."); setMessage(""); return; }
    setError(""); setMessage("Saved."); form.reset(); router.refresh();
  }}>
    {title && <h2 className="font-semibold sm:col-span-2">{title}</h2>}
    {fields.map((field) => <label key={field.name} className={`text-sm ${field.type === "checkbox" ? "flex items-center gap-2" : ""} ${field.name === "address" || field.name === "description" ? "sm:col-span-2" : ""}`}>
      {field.type === "checkbox" ? <><input name={field.name} type="checkbox" defaultChecked={Boolean(field.value)} className="size-4 rounded border-slate-300"/>{field.label}</> : <>{field.label}{field.type === "select" ? <select name={field.name} required={field.required} defaultValue={String(field.value ?? "")} className="mt-1 w-full rounded-lg border border-slate-300 p-2"><option value="">Select</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={field.name} type={field.type ?? "text"} required={field.required} min={field.min} max={field.max} step={field.step} defaultValue={String(field.value ?? "")} className="mt-1 w-full rounded-lg border border-slate-300 p-2"/>}</>}
    </label>)}
    {error && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{error}</p>}{message && <p role="status" className="text-sm text-teal-800 sm:col-span-2">{message}</p>}
    <button className="w-fit rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white">{buttonLabel}</button>
  </form>;
}
