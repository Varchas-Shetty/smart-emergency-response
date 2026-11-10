import "server-only";

import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { getIncidentEventsCollection } from "@/db/mongodb";

type OutboxRow={event_id:string;aggregate_id:number;event_type:string;payload:Record<string,unknown>;attempt_count:number};
export type IncidentTimelineEvent={eventId:string;incidentId:number;eventType:string;occurredAt:Date;actorUserId:number|null;summary:string;details:Record<string,unknown>};
export async function enqueueIncidentEvent(client:{query:(sql:string,values?:unknown[])=>Promise<unknown>},incidentId:number,actorUserId:number,eventType:string,summary:string,details:Record<string,unknown>={}){
 await client.query("INSERT INTO event_outbox(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'incident',$2,$3,$4::jsonb)",[randomUUID(),incidentId,eventType,JSON.stringify({incidentId,actorUserId,source:"sera",summary,details})]);
}

/** Claims a bounded batch in SQL and idempotently publishes each document to MongoDB. */
export async function publishOutboxBatch(batchSize=25){
 const pool=getPostgresPool();const client=await pool.connect();let events:OutboxRow[]=[];
 try{ await client.query("BEGIN");const claimed=await client.query<OutboxRow>("SELECT event_id,aggregate_id,event_type,payload,attempt_count FROM event_outbox WHERE outbox_status='PENDING' AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '2 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1",[batchSize]);events=claimed.rows;if(events.length)await client.query("UPDATE event_outbox SET locked_at=now(),last_attempt_at=now() WHERE event_id=ANY($1::uuid[])",[events.map(e=>e.event_id)]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
 if(!events.length)return {published:0,failed:0};
 const collection=await getIncidentEventsCollection();let published=0,failed=0;
 for(const event of events){try{const p=event.payload;await collection.updateOne({eventId:event.event_id},{$setOnInsert:{eventId:event.event_id,incidentId:event.aggregate_id,eventType:event.event_type,occurredAt:new Date(),actorUserId:p.actorUserId??null,source:p.source??"sera",summary:p.summary??event.event_type,details:p.details??{}}},{upsert:true});await pool.query("UPDATE event_outbox SET outbox_status='PUBLISHED',published_at=now(),locked_at=NULL,last_error=NULL WHERE event_id=$1",[event.event_id]);published++}catch(error){failed++;const attempt=event.attempt_count+1;const backoff=Math.min(3600,2**attempt);const delay=Math.max(1,Math.round(backoff*(0.8+Math.random()*0.4)));const message=String(error).replace(/[\r\n\t]/g," ").slice(0,1000);await pool.query("UPDATE event_outbox SET attempt_count=$2,last_attempt_at=now(),last_error=$3,locked_at=NULL,available_at=now()+($4::text||' seconds')::interval,outbox_status=CASE WHEN $2>=8 THEN 'FAILED' ELSE 'PENDING' END WHERE event_id=$1",[event.event_id,attempt,message,delay])}}
 return {published,failed};
}

export async function getIncidentTimeline(incidentId:number){const collection=await getIncidentEventsCollection();return collection.aggregate<IncidentTimelineEvent>([{ $match:{incidentId} },{$sort:{occurredAt:1}},{$project:{_id:0,eventId:1,incidentId:1,eventType:1,occurredAt:1,actorUserId:1,summary:1,details:1}}]).toArray()}
