import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import LoginForm from "./form";
export const dynamic="force-dynamic";
export default async function LoginPage(){if(await getActor())redirect("/dashboard");return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"><div className="mb-8"><p className="text-sm font-bold tracking-[0.2em] text-teal-700">SERA / OPERATIONS</p><h1 className="mt-5 text-3xl font-semibold">Sign in</h1><p className="mt-2 text-sm text-slate-500">Use your hospital operations account.</p></div><LoginForm/><p className="mt-8 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-400">Synthetic academic simulation. Do not enter real patient information.</p></div></main>}
