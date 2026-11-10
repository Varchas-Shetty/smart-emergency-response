import test from "node:test";
import assert from "node:assert/strict";
import { publishBatch } from "../scripts/outbox-core.mjs";

test("outbox core uses the event UUID as an idempotent Mongo key", async () => {
  const rows=[{event_id:"event-1",aggregate_type:"incident",aggregate_id:7,event_type:"TEST",payload:{summary:"synthetic"},attempt_count:0}];
  const updates=[];let locked=false;let status="PENDING";
  const pool={
    async connect(){return{async query(sql){if(sql==="BEGIN"||sql==="COMMIT"||sql==="ROLLBACK")return{rows:[]};if(sql.startsWith("SELECT event_id")){if(locked||status!=="PENDING")return{rows:[]};locked=true;return{rows}}if(sql.startsWith("UPDATE event_outbox SET locked_at"))return{rows:[]};throw new Error(`Unexpected transaction query: ${sql}`)},release(){}}},
    async query(sql,values){if(sql.includes("outbox_status='PUBLISHED'")){status="PUBLISHED";return{rowCount:1}}if(sql.includes("attempt_count=$2")){status=values[4]===1?"FAILED":"PENDING";return{rowCount:1}}throw new Error(`Unexpected pool query: ${sql}`)},
  };
  const collection={async updateOne(filter,update,options){updates.push({filter,update,options});return{upsertedCount:1}}};
  const result=await publishBatch({pool,collection,batchSize:1});
  assert.deepEqual(result,{claimed:1,published:1,failed:0});
  assert.equal(updates.length,1);assert.deepEqual(updates[0].filter,{eventId:"event-1"});assert.equal(updates[0].options.upsert,true);assert.equal(status,"PUBLISHED");
});
