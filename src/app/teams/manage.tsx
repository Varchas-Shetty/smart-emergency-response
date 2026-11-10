"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRef } from "react";
import { MutationForm } from "@/app/operations/mutation-form";
import runApplicationAction from "@/app/actions";

type Member = { team_member_id: number; user_id: number; username: string; member_role: string };
type Staff = { user_id: number; username: string; hospital_id: number };

export function TeamManage({ id,hospitalId,name,status,members,staff }:{id:number;hospitalId:number|null;name:string;status:string;members:Member[];staff:Staff[]}) {
  const router=useRouter();const [error,setError]=useState("");const memberForm=useRef<HTMLFormElement>(null);const active=members.filter(m=>m.member_role);
  async function add(){const form=memberForm.current;if(!form)return;const f=new FormData(form);const userId=Number(f.get("userId"));const memberRole=String(f.get("memberRole")??"").trim();if(!Number.isSafeInteger(userId)||!memberRole){setError("Choose a staff member and enter their team role.");return}const result=await runApplicationAction({type:"team.member.add",id,values:{userId,memberRole}});if(!result.ok){setError(result.error??"Could not add member");return}setError("");form.reset();router.refresh()}
  async function remove(memberId:number){const result=await runApplicationAction({type:"team.member.remove",id,secondaryId:memberId,values:{}});if(!result.ok){setError(result.error??"Could not remove member");return}router.refresh()}
  const eligible=staff.filter(user=>user.hospital_id===hospitalId);
  return <div className="min-w-72 space-y-3"><MutationForm operation="team.update" id={id} buttonLabel="Save team" className="p-2" fields={[{name:"teamName",label:"Team name",required:true,value:name},...(status==="DISPATCHED"?[]:[{name:"teamStatus",label:"Availability",type:"select" as const,required:true,value:status,options:[{label:"Available",value:"AVAILABLE"},{label:"Off duty",value:"OFF_DUTY"}]}])]}/>
    <div className="space-y-1">{active.map(member=><div key={member.team_member_id} className="flex items-center justify-between gap-2 text-xs"><span>{member.username} · {member.member_role}</span><button onClick={()=>remove(member.team_member_id)} className="rounded border px-2 py-1">Remove</button></div>)}</div>
    {eligible.length>0&&<form ref={memberForm} onSubmit={event=>event.preventDefault()} className="flex flex-wrap gap-1"><select name="userId" required className="rounded border p-1 text-xs">{eligible.map(user=><option key={user.user_id} value={user.user_id}>{user.username}</option>)}</select><input name="memberRole" required placeholder="Role" className="w-24 rounded border p-1 text-xs"/><button type="button" onClick={add} className="rounded bg-teal-700 px-2 py-1 text-xs text-white">Add member</button></form>}{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}
