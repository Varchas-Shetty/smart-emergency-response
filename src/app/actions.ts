"use server";

import argon2 from "argon2";
import type { PoolClient } from "pg";
import { z } from "zod";
import { enqueueIncidentEvent, publishOutboxBatch } from "@/db/outbox";
import { getPostgresPool } from "@/db/postgres";
import { createSession, getActor, revokeSession } from "@/lib/auth";

type ActionInput = {
  type: string;
  id?: number;
  secondaryId?: number;
  hospitalId?: number;
  values: Record<string, unknown>;
};

const idSchema = z.number().int().positive();
const severitySchema = z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]);
const locationSchema = z.object({
  address: z.string().trim().min(2).max(250),
  locality: z.string().trim().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assertHospitalAccess(actor: NonNullable<Awaited<ReturnType<typeof getActor>>>, hospitalId: number) {
  if (actor.role_name !== "ADMIN" && actor.hospital_id !== hospitalId) {
    throw new Error("You do not have access to this hospital.");
  }
}

function assertAdmin(actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) {
  if (actor.role_name !== "ADMIN") throw new Error("Administrator access is required.");
}

export default async function runApplicationAction(input: ActionInput): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const values = input.values ?? {};
    if (input.type === "auth.login") {
      const login = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(values);
      const result = await getPostgresPool().query<{ user_id: number; password_hash: string }>(
        "SELECT user_id,password_hash FROM users WHERE username=$1 AND is_active",
        [login.username],
      );
      const user = result.rows[0];
      if (!user || !(await argon2.verify(user.password_hash, login.password))) {
        return { ok: false, error: "Username or password is incorrect." };
      }
      await createSession(user.user_id);
      return { ok: true };
    }

    if (input.type === "auth.logout") {
      await revokeSession();
      return { ok: true };
    }

    const actor = await getActor();
    if (!actor) return { ok: false, error: "Sign in to continue." };
    const pool = getPostgresPool();

    switch (input.type) {
      case "incident.create": {
        const data = z.object({
          hospitalId: idSchema.optional(),
          incidentTypeId: idSchema,
          ...locationSchema.shape,
          summary: z.string().trim().min(5).max(500),
          severity: severitySchema,
          priorityScore: z.number().int().min(0).max(100).default(0),
        }).parse(values);
        const hospitalId = actor.role_name === "ADMIN" ? data.hospitalId ?? null : actor.hospital_id;
        if (actor.role_name !== "ADMIN" && data.hospitalId && data.hospitalId !== actor.hospital_id) {
          throw new Error("Hospital scope is determined by your account.");
        }
        const incident = await transaction(async (client) => {
          await client.query("SELECT set_config('app.actor_user_id',$1,true)", [String(actor.user_id)]);
          const location = await client.query(
            "INSERT INTO locations(address,locality,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING location_id",
            [data.address, data.locality, data.latitude, data.longitude],
          );
          const created = await client.query(
            "INSERT INTO emergency_incidents(hospital_id,incident_type_id,reported_by_user_id,location_id,summary,severity,priority_score) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [hospitalId, data.incidentTypeId, actor.user_id, location.rows[0].location_id, data.summary, data.severity, data.priorityScore],
          );
          await enqueueIncidentEvent(client, created.rows[0].incident_id, actor.user_id, "INCIDENT_CREATED", data.summary, { severity: data.severity, priorityScore: data.priorityScore });
          return created.rows[0];
        });
        return { ok: true, data: incident };
      }
      case "incident.update": {
        const id = idSchema.parse(input.id);
        const data = z.object({
          incidentStatus: z.enum(["NEW", "VALIDATED", "PRIORITIZED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"]).optional(),
          severity: severitySchema.optional(),
          priorityScore: z.number().int().min(0).max(100).optional(),
          note: z.string().trim().max(500).optional(),
        }).parse(values);
        const updated = await transaction(async (client) => {
          await client.query("SELECT set_config('app.actor_user_id',$1,true)", [String(actor.user_id)]);
          const existing = await client.query("SELECT * FROM emergency_incidents WHERE incident_id=$1 FOR UPDATE", [id]);
          if (!existing.rowCount) throw new Error("Incident not found.");
          const before = existing.rows[0];
          assertHospitalAccess(actor, before.hospital_id);
          const transitions: Record<string, string[]> = {
            NEW: ["VALIDATED", "CANCELLED"], VALIDATED: ["PRIORITIZED", "CANCELLED"],
            PRIORITIZED: ["ASSIGNED", "CANCELLED"], ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
            IN_PROGRESS: ["RESOLVED", "CANCELLED"], RESOLVED: ["CLOSED"],
          };
          if (data.incidentStatus && !(transitions[before.incident_status] ?? []).includes(data.incidentStatus)) {
            throw new Error(`Cannot move ${before.incident_status} to ${data.incidentStatus}.`);
          }
          const result = await client.query(
            "UPDATE emergency_incidents SET incident_status=COALESCE($2,incident_status),severity=COALESCE($3,severity),priority_score=COALESCE($4,priority_score),updated_at=now() WHERE incident_id=$1 RETURNING *",
            [id, data.incidentStatus ?? null, data.severity ?? null, data.priorityScore ?? null],
          );
          await enqueueIncidentEvent(client, id, actor.user_id, "INCIDENT_UPDATED", data.note ?? "Incident updated", { incidentStatus: data.incidentStatus, severity: data.severity, priorityScore: data.priorityScore });
          return result.rows[0];
        });
        return { ok: true, data: updated };
      }
      case "report.create": {
        const data = z.object({
          hospitalId: idSchema.optional(), incidentTypeId: idSchema, ...locationSchema.shape,
          description: z.string().trim().min(5).max(2000),
        }).parse(values);
        const hospitalId = actor.role_name === "ADMIN" ? data.hospitalId : actor.hospital_id;
        if (!hospitalId) throw new Error("Select the receiving hospital.");
        assertHospitalAccess(actor, hospitalId);
        const report = await transaction(async (client) => {
          const location = await client.query(
            "INSERT INTO locations(address,locality,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING location_id",
            [data.address, data.locality, data.latitude, data.longitude],
          );
          const result = await client.query(
            "INSERT INTO citizen_reports(hospital_id,reported_by_user_id,incident_type_id,location_id,description) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [hospitalId, actor.user_id, data.incidentTypeId, location.rows[0].location_id, data.description],
          );
          return result.rows[0];
        });
        return { ok: true, data: report };
      }
      case "report.status": {
        const id = idSchema.parse(input.id);
        const { reportStatus } = z.object({ reportStatus: z.enum(["REVIEWED", "REJECTED", "CLOSED"]) }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT hospital_id,report_status FROM citizen_reports WHERE report_id=$1 FOR UPDATE", [id]);
          if (!current.rowCount) throw new Error("Report not found.");
          assertHospitalAccess(actor, current.rows[0].hospital_id);
          const allowed: Record<string, string[]> = { RECEIVED: ["REVIEWED", "REJECTED"], REVIEWED: ["REJECTED"], CONVERTED: ["CLOSED"], REJECTED: ["CLOSED"] };
          if (!(allowed[current.rows[0].report_status] ?? []).includes(reportStatus)) throw new Error(`Cannot move ${current.rows[0].report_status} to ${reportStatus}.`);
          return (await client.query("UPDATE citizen_reports SET report_status=$2 WHERE report_id=$1 RETURNING *", [id, reportStatus])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "report.convert": {
        const id = idSchema.parse(input.id);
        const result = await transaction(async (client) => {
          await client.query("SELECT set_config('app.actor_user_id',$1,true)", [String(actor.user_id)]);
          const report = await client.query("SELECT * FROM citizen_reports WHERE report_id=$1 FOR UPDATE", [id]);
          if (!report.rowCount) throw new Error("Report not found.");
          const row = report.rows[0];
          assertHospitalAccess(actor, row.hospital_id);
          if (row.report_status !== "REVIEWED" || row.incident_id !== null) throw new Error("Only a reviewed report can be converted once.");
          const incident = await client.query(
            "INSERT INTO emergency_incidents(hospital_id,incident_type_id,reported_by_user_id,location_id,summary,severity) VALUES($1,$2,$3,$4,$5,'MODERATE') RETURNING *",
            [row.hospital_id, row.incident_type_id, actor.user_id, row.location_id, row.description.slice(0, 500)],
          );
          await client.query("UPDATE citizen_reports SET report_status='CONVERTED',incident_id=$2 WHERE report_id=$1", [id, incident.rows[0].incident_id]);
          await enqueueIncidentEvent(client, incident.rows[0].incident_id, actor.user_id, "REPORT_CONVERTED", "Reviewed citizen report converted to an incident", { reportId: id });
          return incident.rows[0];
        });
        return { ok: true, data: result };
      }
      case "hospital.create": {
        assertAdmin(actor);
        const data = z.object({
          hospitalCode: z.string().trim().min(2).max(30).transform((v) => v.toUpperCase()),
          hospitalName: z.string().trim().min(2).max(120), ...locationSchema.shape,
          phone: z.string().trim().max(40).nullable().optional(),
          email: z.union([z.email(), z.literal("")]).nullable().optional(),
        }).parse(values);
        const result = await transaction(async (client) => {
          const location = await client.query("INSERT INTO locations(address,locality,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING location_id", [data.address, data.locality, data.latitude, data.longitude]);
          return (await client.query(
            "INSERT INTO hospitals(hospital_code,hospital_name,location_id,phone,email) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [data.hospitalCode, data.hospitalName, location.rows[0].location_id, data.phone ?? null, data.email || null],
          )).rows[0];
        });
        return { ok: true, data: result };
      }
      case "hospital.update": {
        assertAdmin(actor);
        const id = idSchema.parse(input.id);
        const data = z.object({
          hospitalCode: z.string().trim().min(2).max(30).transform((v) => v.toUpperCase()),
          hospitalName: z.string().trim().min(2).max(120), ...locationSchema.shape,
          phone: z.string().trim().max(40).nullable().optional(),
          email: z.union([z.email(), z.literal("")]).nullable().optional(),
          isActive: z.boolean(),
        }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT h.*,l.location_id FROM hospitals h JOIN locations l USING(location_id) WHERE hospital_id=$1 FOR UPDATE OF h", [id]);
          if (!current.rowCount) throw new Error("Hospital not found.");
          if (!data.isActive) {
            const active = await client.query("SELECT EXISTS(SELECT 1 FROM dispatches WHERE hospital_id=$1 AND dispatch_status=ANY($2::text[])) active", [id, ["QUEUED", "DISPATCHED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"]]);
            if (active.rows[0].active) throw new Error("Complete or cancel active dispatches before deactivating this hospital.");
          }
          await client.query("UPDATE hospitals SET hospital_code=$2,hospital_name=$3,phone=$4,email=NULLIF($5,''),is_active=$6 WHERE hospital_id=$1", [id, data.hospitalCode, data.hospitalName, data.phone ?? null, data.email ?? null, data.isActive]);
          await client.query("UPDATE locations SET address=$2,locality=$3,latitude=$4,longitude=$5 WHERE location_id=$1", [current.rows[0].location_id, data.address, data.locality, data.latitude, data.longitude]);
          return (await client.query("SELECT * FROM hospitals WHERE hospital_id=$1", [id])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "bed.create": {
        const hospitalId = idSchema.parse(input.hospitalId);
        assertHospitalAccess(actor, hospitalId);
        const data = z.object({ bedCode: z.string().trim().min(1).max(40), bedType: z.string().trim().min(2).max(40) }).parse(values);
        const result = await pool.query(
          "INSERT INTO hospital_beds(hospital_id,bed_code,bed_type) SELECT hospital_id,$2,$3 FROM hospitals WHERE hospital_id=$1 AND is_active RETURNING *",
          [hospitalId, data.bedCode, data.bedType],
        );
        if (!result.rowCount) throw new Error("Beds can only be added to an active hospital.");
        return { ok: true, data: result.rows[0] };
      }
      case "bed.update": {
        const id = idSchema.parse(input.id);
        const data = z.object({ bedCode: z.string().trim().min(1).max(40), bedType: z.string().trim().min(2).max(40), bedStatus: z.enum(["AVAILABLE", "OUT_OF_SERVICE"]).optional() }).parse(values);
        const result = await transaction(async (client) => {
          const bed = await client.query("SELECT hospital_id,bed_status FROM hospital_beds WHERE bed_id=$1 FOR UPDATE", [id]);
          if (!bed.rowCount) throw new Error("Bed not found.");
          assertHospitalAccess(actor, bed.rows[0].hospital_id);
          if (data.bedStatus && bed.rows[0].bed_status !== "AVAILABLE" && bed.rows[0].bed_status !== "OUT_OF_SERVICE") throw new Error("Assigned beds cannot have their availability changed.");
          return (await client.query("UPDATE hospital_beds SET bed_code=$2,bed_type=$3,bed_status=COALESCE($4,bed_status),updated_at=now() WHERE bed_id=$1 RETURNING *", [id, data.bedCode, data.bedType, data.bedStatus ?? null])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "bed.reserve": {
        const bedId = idSchema.parse(input.id);
        const incidentId = idSchema.parse(values.incidentId);
        const result = await transaction(async (client) => {
          const incident = await client.query("SELECT hospital_id FROM emergency_incidents WHERE incident_id=$1 FOR UPDATE", [incidentId]);
          const bed = await client.query("SELECT hospital_id,bed_status FROM hospital_beds WHERE bed_id=$1 FOR UPDATE", [bedId]);
          if (!incident.rowCount || !bed.rowCount) throw new Error("Incident or bed not found.");
          assertHospitalAccess(actor, bed.rows[0].hospital_id);
          if (incident.rows[0].hospital_id !== bed.rows[0].hospital_id || bed.rows[0].bed_status !== "AVAILABLE") throw new Error("Bed is unavailable for this incident.");
          const assignment = await client.query("INSERT INTO bed_assignments(bed_id,incident_id,assigned_by_user_id) VALUES($1,$2,$3) RETURNING *", [bedId, incidentId, actor.user_id]);
          await client.query("UPDATE hospital_beds SET bed_status='RESERVED',updated_at=now() WHERE bed_id=$1", [bedId]);
          await enqueueIncidentEvent(client, incidentId, actor.user_id, "BED_RESERVED", "Bed reserved for incident", { bedId, bedAssignmentId: assignment.rows[0].bed_assignment_id });
          return assignment.rows[0];
        });
        return { ok: true, data: result };
      }
      case "bed.assignment.update": {
        const id = idSchema.parse(input.id);
        const { assignmentStatus, releaseReason } = z.object({ assignmentStatus: z.enum(["OCCUPIED", "RELEASED", "CANCELLED"]), releaseReason: z.string().trim().max(300).optional() }).parse(values);
        const result = await transaction(async (client) => {
          const found = await client.query("SELECT a.*,b.hospital_id,b.bed_id FROM bed_assignments a JOIN hospital_beds b USING(bed_id) WHERE a.bed_assignment_id=$1 FOR UPDATE OF a,b", [id]);
          if (!found.rowCount) throw new Error("Bed assignment not found.");
          assertHospitalAccess(actor, found.rows[0].hospital_id);
          const before = found.rows[0].assignment_status as string;
          if (!((before === "RESERVED" && ["OCCUPIED", "RELEASED", "CANCELLED"].includes(assignmentStatus)) || (before === "OCCUPIED" && assignmentStatus === "RELEASED"))) throw new Error(`Cannot move ${before} to ${assignmentStatus}.`);
          const terminal = assignmentStatus === "RELEASED" || assignmentStatus === "CANCELLED";
          const updated = await client.query("UPDATE bed_assignments SET assignment_status=$2,occupied_at=CASE WHEN $2='OCCUPIED' THEN now() ELSE occupied_at END,released_at=CASE WHEN $2 IN ('RELEASED','CANCELLED') THEN now() ELSE NULL END,released_by_user_id=CASE WHEN $2 IN ('RELEASED','CANCELLED') THEN $3::integer ELSE NULL END,release_reason=CASE WHEN $2 IN ('RELEASED','CANCELLED') THEN $4::text ELSE NULL END WHERE bed_assignment_id=$1 RETURNING *", [id, assignmentStatus, actor.user_id, releaseReason ?? assignmentStatus]);
          await client.query("UPDATE hospital_beds SET bed_status=$2,updated_at=now() WHERE bed_id=$1", [found.rows[0].bed_id, terminal ? "AVAILABLE" : assignmentStatus]);
          await enqueueIncidentEvent(client, found.rows[0].incident_id, actor.user_id, `BED_${assignmentStatus}`, `Bed assignment ${assignmentStatus.toLowerCase()}`, { bedAssignmentId: id, bedId: found.rows[0].bed_id });
          return updated.rows[0];
        });
        return { ok: true, data: result };
      }
      case "resource.type.create": {
        assertAdmin(actor);
        const data = z.object({ resourceName: z.string().trim().min(2).max(120), unit: z.string().trim().min(1).max(30), description: z.string().trim().max(300).nullable().optional() }).parse(values);
        const result = await pool.query("INSERT INTO resource_types(resource_name,unit,description) VALUES($1,$2,$3) RETURNING *", [data.resourceName, data.unit, data.description ?? null]);
        return { ok: true, data: result.rows[0] };
      }
      case "resource.type.update": {
        assertAdmin(actor);
        const id = idSchema.parse(input.id);
        const data = z.object({ resourceName: z.string().trim().min(2).max(120), unit: z.string().trim().min(1).max(30) }).parse(values);
        const result = await pool.query("UPDATE resource_types SET resource_name=$2,unit=$3 WHERE resource_type_id=$1 RETURNING *", [id, data.resourceName, data.unit]);
        if (!result.rowCount) throw new Error("Resource type not found.");
        return { ok: true, data: result.rows[0] };
      }
      case "inventory.receive": {
        const hospitalId = idSchema.parse(input.hospitalId);
        assertHospitalAccess(actor, hospitalId);
        const data = z.object({ resourceTypeId: idSchema, quantity: z.number().int().positive(), note: z.string().trim().max(300).optional() }).parse(values);
        const result = await transaction(async (client) => {
          const hospital = await client.query("SELECT hospital_id FROM hospitals WHERE hospital_id=$1 AND is_active", [hospitalId]);
          if (!hospital.rowCount) throw new Error("Stock can only be received by an active hospital.");
          const inventory = await client.query("INSERT INTO resource_inventory(hospital_id,resource_type_id,quantity_on_hand) VALUES($1,$2,0) ON CONFLICT(hospital_id,resource_type_id) DO UPDATE SET updated_at=now() RETURNING inventory_id", [hospitalId, data.resourceTypeId]);
          const updated = await client.query("UPDATE resource_inventory SET quantity_on_hand=quantity_on_hand+$2,updated_at=now() WHERE inventory_id=$1 RETURNING *", [inventory.rows[0].inventory_id, data.quantity]);
          await client.query("INSERT INTO inventory_movements(inventory_id,actor_user_id,movement_type,quantity_delta,note) VALUES($1,$2,'RECEIVED',$3,$4)", [updated.rows[0].inventory_id, actor.user_id, data.quantity, data.note ?? null]);
          return updated.rows[0];
        });
        return { ok: true, data: result };
      }
      case "inventory.adjust": {
        const id = idSchema.parse(input.id);
        const data = z.object({ quantityDelta: z.number().int().min(-1000000).max(1000000).refine((value) => value !== 0), note: z.string().trim().min(1).max(300) }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT * FROM resource_inventory WHERE inventory_id=$1 FOR UPDATE", [id]);
          if (!current.rowCount) throw new Error("Inventory item not found.");
          assertHospitalAccess(actor, current.rows[0].hospital_id);
          if (current.rows[0].quantity_on_hand + data.quantityDelta < current.rows[0].quantity_reserved) throw new Error("Adjustment cannot reduce stock below the reserved quantity.");
          const updated = await client.query("UPDATE resource_inventory SET quantity_on_hand=quantity_on_hand+$2,updated_at=now() WHERE inventory_id=$1 RETURNING *", [id, data.quantityDelta]);
          await client.query("INSERT INTO inventory_movements(inventory_id,actor_user_id,movement_type,quantity_delta,note) VALUES($1,$2,'ADJUSTED',$3,$4)", [id, actor.user_id, data.quantityDelta, data.note]);
          return updated.rows[0];
        });
        return { ok: true, data: result };
      }
      case "allocation.reserve": {
        const incidentId = idSchema.parse(input.id);
        const data = z.object({ inventoryId: idSchema, quantity: z.number().int().positive() }).parse(values);
        const result = await transaction(async (client) => {
          const incident = await client.query("SELECT hospital_id FROM emergency_incidents WHERE incident_id=$1 FOR UPDATE", [incidentId]);
          const inventory = await client.query("SELECT hospital_id FROM resource_inventory WHERE inventory_id=$1 FOR UPDATE", [data.inventoryId]);
          if (!incident.rowCount || !inventory.rowCount) throw new Error("Incident or inventory item not found.");
          assertHospitalAccess(actor, incident.rows[0].hospital_id);
          if (incident.rows[0].hospital_id !== inventory.rows[0].hospital_id) throw new Error("Incident and inventory must belong to the same hospital.");
          const allocation = await client.query("SELECT reserve_inventory($1,$2,$3,$4) allocation_id", [data.inventoryId, incidentId, actor.user_id, data.quantity]);
          await enqueueIncidentEvent(client, incidentId, actor.user_id, "RESOURCES_RESERVED", `Reserved ${data.quantity} resource units`, { allocationId: allocation.rows[0].allocation_id, inventoryId: data.inventoryId, quantity: data.quantity });
          return allocation.rows[0];
        });
        return { ok: true, data: result };
      }
      case "allocation.update": {
        const id = idSchema.parse(input.id);
        const { allocationStatus } = z.object({ allocationStatus: z.enum(["CONSUMED", "RELEASED"]) }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT a.*,ri.hospital_id FROM resource_allocations a JOIN resource_inventory ri USING(inventory_id) WHERE allocation_id=$1 FOR UPDATE OF a,ri", [id]);
          if (!current.rowCount) throw new Error("Allocation not found.");
          assertHospitalAccess(actor, current.rows[0].hospital_id);
          if (current.rows[0].allocation_status !== "RESERVED") throw new Error("Only reserved allocations can be updated.");
          const allocation = current.rows[0];
          const updated = await client.query("UPDATE resource_allocations SET allocation_status=$2,released_at=CASE WHEN $2='RELEASED' THEN now() ELSE NULL END,consumed_at=CASE WHEN $2='CONSUMED' THEN now() ELSE NULL END WHERE allocation_id=$1 RETURNING *", [id, allocationStatus]);
          await client.query("UPDATE resource_inventory SET quantity_reserved=GREATEST(0,quantity_reserved-$2),quantity_on_hand=CASE WHEN $3='CONSUMED' THEN quantity_on_hand-$2 ELSE quantity_on_hand END,updated_at=now() WHERE inventory_id=$1", [allocation.inventory_id, allocation.quantity, allocationStatus]);
          await enqueueIncidentEvent(client, allocation.incident_id, actor.user_id, `RESOURCES_${allocationStatus}`, `Resource allocation ${allocationStatus.toLowerCase()}`, { allocationId: id, quantity: allocation.quantity });
          return updated.rows[0];
        });
        return { ok: true, data: result };
      }
      case "team.create": {
        const data = z.object({ teamName: z.string().trim().min(2).max(120), hospitalId: idSchema.optional() }).parse(values);
        const hospitalId = actor.role_name === "ADMIN" ? data.hospitalId ?? null : actor.hospital_id;
        if (hospitalId) assertHospitalAccess(actor, hospitalId);
        const result = await pool.query("INSERT INTO response_teams(hospital_id,team_name) VALUES($1,$2) RETURNING *", [hospitalId, data.teamName]);
        return { ok: true, data: result.rows[0] };
      }
      case "team.update": {
        const id = idSchema.parse(input.id);
        const data = z.object({ teamName: z.string().trim().min(2).max(120), teamStatus: z.enum(["AVAILABLE", "OFF_DUTY"]).optional() }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT hospital_id,team_status FROM response_teams WHERE team_id=$1 FOR UPDATE", [id]);
          if (!current.rowCount) throw new Error("Team not found.");
          if (current.rows[0].hospital_id === null) assertAdmin(actor);
          else assertHospitalAccess(actor, current.rows[0].hospital_id);
          if (current.rows[0].team_status === "DISPATCHED" && data.teamStatus) throw new Error("A dispatched team cannot be manually updated.");
          return (await client.query("UPDATE response_teams SET team_name=$2,team_status=COALESCE($3,team_status) WHERE team_id=$1 RETURNING *", [id, data.teamName, data.teamStatus ?? null])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "team.member.add": {
        const id = idSchema.parse(input.id);
        const data = z.object({ userId: idSchema, memberRole: z.string().trim().min(2).max(50) }).parse(values);
        const result = await transaction(async (client) => {
          const team = await client.query("SELECT hospital_id FROM response_teams WHERE team_id=$1 FOR UPDATE", [id]);
          const user = await client.query("SELECT u.hospital_id FROM users u JOIN roles r USING(role_id) WHERE u.user_id=$1 AND u.is_active AND r.role_name='HOSPITAL_STAFF'", [data.userId]);
          if (!team.rowCount || !user.rowCount) throw new Error("Team or staff user not found.");
          if (team.rows[0].hospital_id === null) assertAdmin(actor);
          else assertHospitalAccess(actor, team.rows[0].hospital_id);
          if (team.rows[0].hospital_id !== user.rows[0].hospital_id) throw new Error("Team members must be active hospital staff from the team's hospital.");
          return (await client.query("INSERT INTO team_members(team_id,user_id,member_role) VALUES($1,$2,$3) RETURNING *", [id, data.userId, data.memberRole])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "team.member.remove": {
        const id = idSchema.parse(input.id);
        const memberId = idSchema.parse(input.secondaryId);
        const result = await transaction(async (client) => {
          const found = await client.query("SELECT tm.team_member_id,t.hospital_id FROM team_members tm JOIN response_teams t USING(team_id) WHERE tm.team_id=$1 AND tm.team_member_id=$2 AND tm.left_at IS NULL FOR UPDATE OF tm,t", [id, memberId]);
          if (!found.rowCount) throw new Error("Active team member not found.");
          if (found.rows[0].hospital_id === null) assertAdmin(actor);
          else assertHospitalAccess(actor, found.rows[0].hospital_id);
          return (await client.query("UPDATE team_members SET left_at=now() WHERE team_member_id=$1 RETURNING *", [memberId])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "vehicle.create": {
        const data = z.object({ registrationNumber: z.string().trim().min(2).max(40), vehicleType: z.string().trim().min(2).max(40), hospitalId: idSchema.optional() }).parse(values);
        const hospitalId = actor.role_name === "ADMIN" ? data.hospitalId ?? null : actor.hospital_id;
        if (hospitalId) assertHospitalAccess(actor, hospitalId);
        const result = await pool.query("INSERT INTO vehicles(hospital_id,registration_number,vehicle_type) VALUES($1,$2,$3) RETURNING *", [hospitalId, data.registrationNumber, data.vehicleType]);
        return { ok: true, data: result.rows[0] };
      }
      case "vehicle.update": {
        const id = idSchema.parse(input.id);
        const data = z.object({ registrationNumber: z.string().trim().min(2).max(40), vehicleType: z.string().trim().min(2).max(40), vehicleStatus: z.enum(["AVAILABLE", "MAINTENANCE"]).optional() }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT hospital_id,vehicle_status FROM vehicles WHERE vehicle_id=$1 FOR UPDATE", [id]);
          if (!current.rowCount) throw new Error("Vehicle not found.");
          if (current.rows[0].hospital_id === null) assertAdmin(actor);
          else assertHospitalAccess(actor, current.rows[0].hospital_id);
          if (current.rows[0].vehicle_status === "DISPATCHED" && data.vehicleStatus) throw new Error("A dispatched vehicle cannot be manually updated.");
          return (await client.query("UPDATE vehicles SET registration_number=$2,vehicle_type=$3,vehicle_status=COALESCE($4,vehicle_status) WHERE vehicle_id=$1 RETURNING *", [id, data.registrationNumber, data.vehicleType, data.vehicleStatus ?? null])).rows[0];
        });
        return { ok: true, data: result };
      }
      case "dispatch.create": {
        const incidentId = idSchema.parse(input.id);
        const data = z.object({ teamId: idSchema, vehicleId: idSchema, bedId: idSchema.optional() }).parse(values);
        const result = await transaction(async (client) => {
          const incident = await client.query("SELECT hospital_id,summary FROM emergency_incidents WHERE incident_id=$1 FOR UPDATE", [incidentId]);
          const team = await client.query("SELECT hospital_id,team_status FROM response_teams WHERE team_id=$1 FOR UPDATE", [data.teamId]);
          const vehicle = await client.query("SELECT hospital_id,vehicle_status FROM vehicles WHERE vehicle_id=$1 FOR UPDATE", [data.vehicleId]);
          if (!incident.rowCount || !team.rowCount || !vehicle.rowCount) throw new Error("Incident, team, or vehicle not found.");
          const hospitalId = incident.rows[0].hospital_id;
          if (!hospitalId || team.rows[0].hospital_id !== hospitalId || vehicle.rows[0].hospital_id !== hospitalId) throw new Error("Incident, team, and vehicle must belong to the same hospital.");
          assertHospitalAccess(actor, hospitalId);
          if (team.rows[0].team_status !== "AVAILABLE" || vehicle.rows[0].vehicle_status !== "AVAILABLE") throw new Error("The selected team or vehicle is unavailable.");
          let bedAssignmentId: number | null = null;
          if (data.bedId) {
            const bed = await client.query("SELECT hospital_id,bed_status FROM hospital_beds WHERE bed_id=$1 FOR UPDATE", [data.bedId]);
            if (!bed.rowCount || bed.rows[0].hospital_id !== hospitalId || bed.rows[0].bed_status !== "AVAILABLE") throw new Error("The selected bed is unavailable.");
            const assignment = await client.query("INSERT INTO bed_assignments(bed_id,incident_id,dispatch_id,assigned_by_user_id) VALUES($1,$2,NULL,$3) RETURNING bed_assignment_id", [data.bedId, incidentId, actor.user_id]);
            bedAssignmentId = assignment.rows[0].bed_assignment_id;
            await client.query("UPDATE hospital_beds SET bed_status='RESERVED',updated_at=now() WHERE bed_id=$1", [data.bedId]);
          }
          const dispatch = await client.query("INSERT INTO dispatches(incident_id,team_id,vehicle_id,created_by_user_id,hospital_id) VALUES($1,$2,$3,$4,$5) RETURNING *", [incidentId, data.teamId, data.vehicleId, actor.user_id, hospitalId]);
          if (bedAssignmentId) await client.query("UPDATE bed_assignments SET dispatch_id=$1 WHERE bed_assignment_id=$2", [dispatch.rows[0].dispatch_id, bedAssignmentId]);
          await client.query("UPDATE response_teams SET team_status='DISPATCHED' WHERE team_id=$1", [data.teamId]);
          await client.query("UPDATE vehicles SET vehicle_status='DISPATCHED' WHERE vehicle_id=$1", [data.vehicleId]);
          await enqueueIncidentEvent(client, incidentId, actor.user_id, "DISPATCH_QUEUED", "Response team and vehicle assigned", { dispatchId: dispatch.rows[0].dispatch_id, teamId: data.teamId, vehicleId: data.vehicleId, bedAssignmentId });
          return dispatch.rows[0];
        });
        return { ok: true, data: result };
      }
      case "dispatch.update": {
        const id = idSchema.parse(input.id);
        const { dispatchStatus } = z.object({ dispatchStatus: z.enum(["DISPATCHED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING", "COMPLETED", "CANCELLED"]) }).parse(values);
        const result = await transaction(async (client) => {
          const current = await client.query("SELECT d.*,i.hospital_id AS incident_hospital FROM dispatches d JOIN emergency_incidents i USING(incident_id) WHERE dispatch_id=$1 FOR UPDATE OF d,i", [id]);
          if (!current.rowCount) throw new Error("Dispatch not found.");
          assertHospitalAccess(actor, current.rows[0].incident_hospital);
          const transitions: Record<string, string[]> = { QUEUED: ["DISPATCHED", "CANCELLED"], DISPATCHED: ["EN_ROUTE", "CANCELLED"], EN_ROUTE: ["ON_SCENE", "CANCELLED"], ON_SCENE: ["TRANSPORTING", "COMPLETED", "CANCELLED"], TRANSPORTING: ["COMPLETED", "CANCELLED"] };
          if (!(transitions[current.rows[0].dispatch_status] ?? []).includes(dispatchStatus)) throw new Error(`Cannot move ${current.rows[0].dispatch_status} to ${dispatchStatus}.`);
          const updated = await client.query("UPDATE dispatches SET dispatch_status=$2,dispatched_at=CASE WHEN $2='DISPATCHED' THEN now() ELSE dispatched_at END,arrived_at=CASE WHEN $2='ON_SCENE' THEN now() ELSE arrived_at END,completed_at=CASE WHEN $2 IN ('COMPLETED','CANCELLED') THEN now() ELSE completed_at END WHERE dispatch_id=$1 RETURNING *", [id, dispatchStatus]);
          if (["COMPLETED", "CANCELLED"].includes(dispatchStatus)) {
            await client.query("UPDATE response_teams SET team_status='AVAILABLE' WHERE team_id=$1", [current.rows[0].team_id]);
            await client.query("UPDATE vehicles SET vehicle_status='AVAILABLE' WHERE vehicle_id=$1", [current.rows[0].vehicle_id]);
            const assignments = await client.query("UPDATE bed_assignments SET assignment_status='RELEASED',released_at=now(),released_by_user_id=$2,release_reason='Dispatch completed' WHERE dispatch_id=$1 AND assignment_status IN ('RESERVED','OCCUPIED') RETURNING bed_id", [id, actor.user_id]);
            if (assignments.rowCount) await client.query("UPDATE hospital_beds SET bed_status='AVAILABLE',updated_at=now() WHERE bed_id=ANY($1::int[])", [assignments.rows.map((row) => row.bed_id)]);
          }
          await enqueueIncidentEvent(client, current.rows[0].incident_id, actor.user_id, `DISPATCH_${dispatchStatus}`, `Dispatch ${dispatchStatus.toLowerCase()}`, { dispatchId: id });
          return updated.rows[0];
        });
        return { ok: true, data: result };
      }
      case "user.create": {
        assertAdmin(actor);
        const data = z.object({ username: z.string().trim().min(3).max(80), email: z.email(), password: z.string().min(12), role: z.enum(["ADMIN", "HOSPITAL_STAFF"]), hospitalId: idSchema.nullable() }).parse(values);
        if ((data.role === "ADMIN") !== (data.hospitalId === null)) throw new Error("Administrator accounts have no hospital; hospital staff must select one.");
        const role = await pool.query("SELECT role_id FROM roles WHERE role_name=$1", [data.role]);
        const hash = await argon2.hash(data.password);
        const user = await pool.query("INSERT INTO users(role_id,hospital_id,username,email,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING user_id,username,email", [role.rows[0].role_id, data.hospitalId, data.username, data.email, hash]);
        return { ok: true, data: user.rows[0] };
      }
      case "outbox.retry": {
        assertAdmin(actor);
        const eventId = z.string().uuid().parse(values.eventId);
        const result = await pool.query("UPDATE event_outbox SET outbox_status='PENDING',attempt_count=0,available_at=now(),locked_at=NULL,last_error=NULL,published_at=NULL WHERE event_id=$1 AND outbox_status='FAILED' RETURNING event_id", [eventId]);
        if (!result.rowCount) throw new Error("Only a failed event can be reprocessed.");
        return { ok: true, data: result.rows[0] };
      }
      case "outbox.publish": {
        assertAdmin(actor);
        return { ok: true, data: await publishOutboxBatch() };
      }
      default:
        throw new Error("Unsupported server action.");
    }
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the submitted values." };
    console.error("Server action failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "The operation could not be completed." };
  }
}
