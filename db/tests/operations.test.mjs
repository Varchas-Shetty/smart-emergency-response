import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

test("concurrent inventory, bed, and dispatch reservations preserve single-winner invariants", { skip: !process.env.DATABASE_URL && "DATABASE_URL is required" }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const stock = await pool.query("SELECT ri.inventory_id,ri.hospital_id,ri.quantity_on_hand-ri.quantity_reserved available,i.incident_id,u.user_id actor_id FROM resource_inventory ri JOIN emergency_incidents i USING(hospital_id) JOIN users u ON u.is_active WHERE ri.quantity_on_hand-ri.quantity_reserved>=2 ORDER BY ri.inventory_id,i.incident_id,u.user_id LIMIT 1");
    assert.ok(stock.rowCount, "synthetic hospital inventory and incident are available");
    const fixture = stock.rows[0];
    const requested = Math.floor(fixture.available / 2) + 1;
    const reserve = async () => pool.query("SELECT reserve_inventory($1,$2,$3,$4) allocation_id", [fixture.inventory_id,fixture.incident_id,fixture.actor_id,requested]);
    const results = await Promise.allSettled([reserve(),reserve()]);
    assert.equal(results.filter((r)=>r.status==="fulfilled").length,1,"only one reservation fits the available stock");
    assert.equal(results.filter((r)=>r.status==="rejected").length,1,"the competing reservation sees insufficient stock");
    const allocationIds = results.filter((r)=>r.status==="fulfilled").map((r)=>r.value.rows[0].allocation_id);
    await pool.query("UPDATE resource_inventory SET quantity_reserved=quantity_reserved-(SELECT coalesce(sum(quantity),0) FROM resource_allocations WHERE allocation_id=ANY($2::int[])) WHERE inventory_id=$1", [fixture.inventory_id,allocationIds]);
    await pool.query("UPDATE resource_allocations SET allocation_status='RELEASED',released_at=now() WHERE allocation_id=ANY($1::int[])", [allocationIds]);

    const bedFixture = await pool.query("SELECT b.bed_id,b.hospital_id,i.incident_id,u.user_id actor_id FROM hospital_beds b JOIN emergency_incidents i ON i.hospital_id=b.hospital_id JOIN users u ON u.is_active WHERE b.bed_status='AVAILABLE' AND NOT EXISTS(SELECT 1 FROM bed_assignments ba WHERE ba.bed_id=b.bed_id AND ba.assignment_status IN ('RESERVED','OCCUPIED')) AND NOT EXISTS(SELECT 1 FROM bed_assignments ba WHERE ba.incident_id=i.incident_id AND ba.assignment_status IN ('RESERVED','OCCUPIED')) LIMIT 1");
    assert.ok(bedFixture.rowCount, "an unassigned synthetic bed and incident are available");
    const bf=bedFixture.rows[0];
    const assignBed=async()=>{const client=await pool.connect();try{await client.query("BEGIN");const locked=await client.query("SELECT bed_status FROM hospital_beds WHERE bed_id=$1 FOR UPDATE",[bf.bed_id]);if(locked.rows[0].bed_status!=="AVAILABLE"){await client.query("ROLLBACK");return null}const row=await client.query("INSERT INTO bed_assignments(bed_id,incident_id,assigned_by_user_id) VALUES($1,$2,$3) RETURNING bed_assignment_id",[bf.bed_id,bf.incident_id,bf.actor_id]);await client.query("UPDATE hospital_beds SET bed_status='RESERVED' WHERE bed_id=$1",[bf.bed_id]);await client.query("COMMIT");return row.rows[0].bed_assignment_id}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}};
    const bedResults=await Promise.all([assignBed(),assignBed()]);assert.equal(bedResults.filter(Boolean).length,1,"only one concurrent reservation may take a bed");
    const assignmentIds=bedResults.filter(Boolean);
    await pool.query("UPDATE bed_assignments SET assignment_status='RELEASED',released_at=now(),released_by_user_id=$2,release_reason='integration cleanup' WHERE bed_assignment_id=ANY($1::int[])",[assignmentIds,bf.actor_id]);
    await pool.query("UPDATE hospital_beds SET bed_status='AVAILABLE' WHERE bed_id=$1",[bf.bed_id]);

    const dispatchFixture=await pool.query("SELECT t.team_id,v.vehicle_id,i.incident_id,u.user_id actor_id FROM response_teams t JOIN vehicles v USING(hospital_id) JOIN emergency_incidents i USING(hospital_id) JOIN users u ON u.is_active WHERE t.team_status='AVAILABLE' AND v.vehicle_status='AVAILABLE' AND NOT EXISTS(SELECT 1 FROM dispatches d WHERE d.team_id=t.team_id AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) AND NOT EXISTS(SELECT 1 FROM dispatches d WHERE d.vehicle_id=v.vehicle_id AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) AND NOT EXISTS(SELECT 1 FROM dispatches d WHERE d.incident_id=i.incident_id AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) LIMIT 1");
    assert.ok(dispatchFixture.rowCount,"available synthetic dispatch resources exist");const df=dispatchFixture.rows[0];
    const insertDispatch=async()=>pool.query("INSERT INTO dispatches(incident_id,team_id,vehicle_id,created_by_user_id,hospital_id) VALUES($1,$2,$3,$4,(SELECT hospital_id FROM response_teams WHERE team_id=$2)) RETURNING dispatch_id",[df.incident_id,df.team_id,df.vehicle_id,df.actor_id]);
    const dispatchResults=await Promise.allSettled([insertDispatch(),insertDispatch()]);assert.equal(dispatchResults.filter(r=>r.status==="fulfilled").length,1,"partial unique indexes allow one active team/vehicle/incident dispatch");
    const dispatchIds=dispatchResults.filter(r=>r.status==="fulfilled").map(r=>r.value.rows[0].dispatch_id);await pool.query("UPDATE dispatches SET dispatch_status='CANCELLED',completed_at=now() WHERE dispatch_id=ANY($1::int[])",[dispatchIds]);
  } finally { await pool.end(); }
});
