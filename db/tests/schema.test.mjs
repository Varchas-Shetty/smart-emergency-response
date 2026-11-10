import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

test("SERA PostgreSQL schema and allocation rollback", { skip: !process.env.DATABASE_URL && "DATABASE_URL is required for PostgreSQL integration tests" }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const objects = await pool.query("SELECT to_regclass('incident_operations_view') view, to_regclass('event_outbox') outbox, to_regprocedure('reserve_inventory(integer,integer,integer,integer)') reserve");
    assert.ok(objects.rows[0].view, "reporting view should be installed");
    assert.ok(objects.rows[0].outbox, "outbox should be installed");
    assert.ok(objects.rows[0].reserve, "transactional allocation function should be installed");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const location = await client.query("INSERT INTO locations(address,locality,latitude,longitude) VALUES('Test address','Test locality',1,1) RETURNING location_id");
      const hospital = await client.query("INSERT INTO hospitals(hospital_code,hospital_name,location_id) VALUES($1,'Integration test hospital',$2) RETURNING hospital_id", [`TEST-${suffix}`, location.rows[0].location_id]);
      const adminRole = await client.query("SELECT role_id FROM roles WHERE role_name='ADMIN'");
      const user = await client.query("INSERT INTO users(role_id,username,email,password_hash) VALUES($1,$2,$3,'test-hash') RETURNING user_id", [adminRole.rows[0].role_id,`test-${suffix}`,`test-${suffix}@example.invalid`]);
      const type = await client.query("SELECT incident_type_id FROM incident_types LIMIT 1");
      await client.query("SELECT set_config('app.actor_user_id',$1,true)",[String(user.rows[0].user_id)]);
      const incident = await client.query("INSERT INTO emergency_incidents(hospital_id,incident_type_id,reported_by_user_id,location_id,summary,severity) VALUES($1,$2,$3,$4,'Integration rollback check','HIGH') RETURNING incident_id",[hospital.rows[0].hospital_id,type.rows[0].incident_type_id,user.rows[0].user_id,location.rows[0].location_id]);
      const resource = await client.query("INSERT INTO resource_types(resource_name,unit) VALUES($1,'unit') RETURNING resource_type_id",[`test-${suffix}`]);
      const inventory = await client.query("INSERT INTO resource_inventory(hospital_id,resource_type_id,quantity_on_hand) VALUES($1,$2,2) RETURNING inventory_id",[hospital.rows[0].hospital_id,resource.rows[0].resource_type_id]);
      await assert.rejects(client.query("SELECT reserve_inventory($1,$2,$3,3)",[inventory.rows[0].inventory_id,incident.rows[0].incident_id,user.rows[0].user_id]));
      await client.query("ROLLBACK");
      const check = await pool.query("SELECT count(*)::int total FROM hospitals WHERE hospital_code=$1",[`TEST-${suffix}`]);
      assert.equal(check.rows[0].total,0,"failed operation's transaction must leave no fixture records");
    } finally { client.release(); }
  } finally { await pool.end(); }
});
