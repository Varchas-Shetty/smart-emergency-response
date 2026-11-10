import Link from "next/link";
import { getActor } from "@/lib/auth";
import { redirect } from "next/navigation";
import runApplicationAction from "@/app/actions";

const links=[["Overview","/dashboard"],["Incidents","/incidents"],["Reports","/reports"],["Hospitals","/hospitals"],["Beds","/beds"],["Resources","/resources"],["Response teams","/teams"],["Vehicles","/vehicles"],["Dispatch","/dispatch"],["Analytics","/reports/analytics"]];
export async function SeraShell({children}:{children:React.ReactNode}) {
 const actor=await getActor(); if(!actor) redirect("/login");
 async function logout() {
  "use server";
  const result=await runApplicationAction({type:"auth.logout",values:{}});
  if(!result.ok) throw new Error(result.error??"Unable to sign out.");
  redirect("/login");
 }
 return <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
  <aside className="bg-slate-950 text-white md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
   <Link href="/dashboard" className="block border-b border-slate-800 px-6 py-5"><span className="text-lg font-bold tracking-wide">SERA</span><span className="ml-2 text-xs text-slate-400">OPERATIONS</span></Link>
   <nav className="flex gap-1 overflow-x-auto p-3 md:flex-1 md:flex-col md:overflow-y-auto">{links.map(([label,href])=><Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">{label}</Link>)}{actor.role_name === "ADMIN"&&<><Link href="/admin/users" className="rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800">User management</Link><Link href="/admin/outbox" className="rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800">Event outbox</Link></>}</nav>
   <div className="hidden border-t border-slate-800 p-4 text-xs text-slate-400 md:block">Synthetic operations simulation</div>
  </aside>
  <div className="min-w-0 flex-1 md:ml-64"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-8"><div><p className="text-xs font-medium uppercase tracking-wider text-teal-700">Emergency operations</p><p className="mt-1 text-sm text-slate-600">{actor.role_name === "ADMIN" ? "All hospitals" : `Hospital #${actor.hospital_id}`} · {actor.username}</p></div><form action={logout}><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">Sign out</button></form></header><main className="mx-auto max-w-7xl p-5 sm:p-8">{children}</main></div>
 </div>;
}
