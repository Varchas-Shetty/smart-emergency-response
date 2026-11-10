"use client";

import {useRouter} from "next/navigation";
import {useState} from "react";
import runApplicationAction from "@/app/actions";

export function OutboxActions({eventId,status}:{eventId:string;status:string}){
 const router=useRouter();const[error,setError]=useState("");
 return <div className="flex gap-2">{status==="FAILED"&&<button onClick={async()=>{const result=await runApplicationAction({type:"outbox.retry",values:{eventId}});if(!result.ok){setError(result.error??"Requeue failed");return}setError("Event requeued.");router.refresh()}} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-800">Reprocess failed</button>}{error&&<span role="status" className="text-xs">{error}</span>}</div>;
}

export function OutboxPublishButton(){const router=useRouter();const[error,setError]=useState("");return <div className="mt-4"><button onClick={async()=>{const result=await runApplicationAction({type:"outbox.publish",values:{}});if(!result.ok){setError(result.error??"Publishing failed");return}const data=result.data as {published:number;failed:number};setError(`Published ${data.published}; retry/dead-letter ${data.failed}.`);router.refresh()}} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Publish pending batch</button>{error&&<p role="status" className="mt-2 text-sm">{error}</p>}</div>}
