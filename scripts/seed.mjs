import argon2 from "argon2";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { publishBatch } from "./outbox-core.mjs";

const DEMO_SEED_NAME = "sera-demo-v1";
const DEMO_SEED_VERSION = "DEMO-2026-11-04-v1";
const DEMO_STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD ?? "Demo-Hospital-Staff-2026";

const required = ["DATABASE_URL", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} must be configured before seeding.`);
if (process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const client = await pool.connect();
const mongo = new MongoClient(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 4 });

async function ensureLocation(address, locality, latitude, longitude) {
  const result = await client.query("SELECT location_id FROM locations WHERE address=$1 AND locality=$2 AND latitude=$3 AND longitude=$4 LIMIT 1", [address, locality, latitude, longitude]);
  if (result.rowCount) return result.rows[0].location_id;
  const inserted = await client.query("INSERT INTO locations(address,locality,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING location_id", [address, locality, latitude, longitude]);
  return inserted.rows[0].location_id;
}

async function ensureHospital(code, name, locationId, phone, email) {
  const result = await client.query("SELECT hospital_id FROM hospitals WHERE hospital_code=$1 LIMIT 1", [code]);
  if (result.rowCount) {
    await client.query("UPDATE hospitals SET hospital_name=$2, location_id=$3, phone=$4, email=$5, is_active=true WHERE hospital_id=$1", [result.rows[0].hospital_id, name, locationId, phone, email]);
    return result.rows[0].hospital_id;
  }
  const inserted = await client.query("INSERT INTO hospitals(hospital_code,hospital_name,location_id,phone,email,is_active) VALUES($1,$2,$3,$4,$5,true) RETURNING hospital_id", [code, name, locationId, phone, email]);
  return inserted.rows[0].hospital_id;
}

async function ensureUser({ roleName, hospitalId = null, username, email, passwordHash }) {
  const roleResult = await client.query("SELECT role_id FROM roles WHERE role_name=$1", [roleName]);
  const roleId = roleResult.rows[0].role_id;
  const existing = await client.query("SELECT user_id FROM users WHERE username=$1 LIMIT 1", [username]);
  if (existing.rowCount) {
    await client.query("UPDATE users SET role_id=$2, hospital_id=$3, email=$4, password_hash=$5, is_active=true, updated_at=now() WHERE user_id=$1", [existing.rows[0].user_id, roleId, hospitalId, email, passwordHash]);
    return existing.rows[0].user_id;
  }
  const inserted = await client.query("INSERT INTO users(role_id,hospital_id,username,email,password_hash,is_active) VALUES($1,$2,$3,$4,$5,true) RETURNING user_id", [roleId, hospitalId, username, email, passwordHash]);
  return inserted.rows[0].user_id;
}

async function ensureIncidentType(typeName, description) {
  const result = await client.query("SELECT incident_type_id FROM incident_types WHERE type_name=$1 LIMIT 1", [typeName]);
  if (result.rowCount) return result.rows[0].incident_type_id;
  const inserted = await client.query("INSERT INTO incident_types(type_name,description,is_active) VALUES($1,$2,true) RETURNING incident_type_id", [typeName, description]);
  return inserted.rows[0].incident_type_id;
}

async function ensureResourceType(resourceName, unit, description) {
  const result = await client.query("SELECT resource_type_id FROM resource_types WHERE resource_name=$1 LIMIT 1", [resourceName]);
  if (result.rowCount) return result.rows[0].resource_type_id;
  const inserted = await client.query("INSERT INTO resource_types(resource_name,unit,description) VALUES($1,$2,$3) RETURNING resource_type_id", [resourceName, unit, description]);
  return inserted.rows[0].resource_type_id;
}

async function ensureInventory(hospitalId, resourceTypeId, quantityOnHand, quantityReserved = 0) {
  const result = await client.query("SELECT inventory_id FROM resource_inventory WHERE hospital_id=$1 AND resource_type_id=$2 LIMIT 1", [hospitalId, resourceTypeId]);
  if (result.rowCount) {
    const current = await client.query("SELECT quantity_on_hand, quantity_reserved FROM resource_inventory WHERE inventory_id=$1", [result.rows[0].inventory_id]);
    const nextReserved = Math.min(Math.max(quantityReserved, 0), current.rows[0].quantity_on_hand);
    await client.query("UPDATE resource_inventory SET quantity_on_hand=$2, quantity_reserved=$3, updated_at=now() WHERE inventory_id=$1", [result.rows[0].inventory_id, quantityOnHand, nextReserved]);
    return result.rows[0].inventory_id;
  }
  const inserted = await client.query("INSERT INTO resource_inventory(hospital_id,resource_type_id,quantity_on_hand,quantity_reserved) VALUES($1,$2,$3,$4) RETURNING inventory_id", [hospitalId, resourceTypeId, quantityOnHand, quantityReserved]);
  return inserted.rows[0].inventory_id;
}

async function ensureTeam(hospitalId, teamName, teamStatus, locationId) {
  const result = await client.query("SELECT team_id FROM response_teams WHERE lower(team_name)=lower($1) AND COALESCE(hospital_id,0) = COALESCE($2,0) LIMIT 1", [teamName, hospitalId]);
  if (result.rowCount) {
    await client.query("UPDATE response_teams SET hospital_id=$2, team_status=$3, current_location_id=$4 WHERE team_id=$1", [result.rows[0].team_id, hospitalId, teamStatus, locationId]);
    return result.rows[0].team_id;
  }
  const inserted = await client.query("INSERT INTO response_teams(hospital_id,team_name,team_status,current_location_id) VALUES($1,$2,$3,$4) RETURNING team_id", [hospitalId, teamName, teamStatus, locationId]);
  return inserted.rows[0].team_id;
}

async function ensureVehicle(hospitalId, registrationNumber, vehicleType, vehicleStatus, currentLocationId) {
  const result = await client.query("SELECT vehicle_id FROM vehicles WHERE registration_number=$1 LIMIT 1", [registrationNumber]);
  if (result.rowCount) {
    await client.query("UPDATE vehicles SET hospital_id=$2, vehicle_type=$3, vehicle_status=$4, current_location_id=$5 WHERE vehicle_id=$1", [result.rows[0].vehicle_id, hospitalId, vehicleType, vehicleStatus, currentLocationId]);
    return result.rows[0].vehicle_id;
  }
  const inserted = await client.query("INSERT INTO vehicles(hospital_id,registration_number,vehicle_type,vehicle_status,current_location_id) VALUES($1,$2,$3,$4,$5) RETURNING vehicle_id", [hospitalId, registrationNumber, vehicleType, vehicleStatus, currentLocationId]);
  return inserted.rows[0].vehicle_id;
}

async function ensureMember(teamId, userId, memberRole) {
  const result = await client.query("SELECT team_member_id FROM team_members WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1", [teamId, userId]);
  if (result.rowCount) return result.rows[0].team_member_id;
  const inserted = await client.query("INSERT INTO team_members(team_id,user_id,member_role) VALUES($1,$2,$3) RETURNING team_member_id", [teamId, userId, memberRole]);
  return inserted.rows[0].team_member_id;
}

async function queueEvent(incidentId, actorUserId, eventType, summary, details = {}) {
  await client.query("INSERT INTO event_outbox(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'incident',$2,$3,$4::jsonb)", [randomUUID(), incidentId, eventType, JSON.stringify({ incidentId, actorUserId, source: "sera", summary, details })]);
}

const seedExists = await client.query("SELECT seed_version FROM demo_seed_runs WHERE seed_name=$1", [DEMO_SEED_NAME]);
if (seedExists.rowCount && seedExists.rows[0].seed_version === DEMO_SEED_VERSION) {
  console.log(`Demo seed ${DEMO_SEED_VERSION} already applied; skipping duplicate inserts.`);
  await client.release();
  await pool.end();
  await mongo.close();
  process.exit(0);
}

try {
  await client.query("BEGIN");
  const adminRole = await client.query("SELECT role_id FROM roles WHERE role_name='ADMIN'");
  const staffRole = await client.query("SELECT role_id FROM roles WHERE role_name='HOSPITAL_STAFF'");

  const bootstrapHash = await argon2.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  await client.query("INSERT INTO users(role_id,username,email,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING", [adminRole.rows[0].role_id, process.env.BOOTSTRAP_ADMIN_USERNAME, process.env.BOOTSTRAP_ADMIN_EMAIL, bootstrapHash]);

  const hospitals = [
    { code: "SERA-CITY-GEN", name: "SERA City General Hospital", address: "17 Civic Avenue, Downtown", locality: "City Center", latitude: 12.9716, longitude: 77.5946, phone: "+91-80-2244-1001", email: "city.general@sera.demo" },
    { code: "SERA-EMC", name: "SERA Emergency Medical Centre", address: "42 East Ring Road", locality: "East District", latitude: 12.9344, longitude: 77.6218, phone: "+91-80-2244-1002", email: "emc@sera.demo" },
    { code: "SERA-MULTI", name: "SERA Multi-Speciality Hospital", address: "88 North Sector Boulevard", locality: "North District", latitude: 13.0044, longitude: 77.5522, phone: "+91-80-2244-1003", email: "multi.speciality@sera.demo" },
  ];

  const hospitalIds = new Map();
  for (const hospital of hospitals) {
    const locationId = await ensureLocation(hospital.address, hospital.locality, hospital.latitude, hospital.longitude);
    const hospitalId = await ensureHospital(hospital.code, hospital.name, locationId, hospital.phone, hospital.email);
    hospitalIds.set(hospital.code, hospitalId);
  }

  const staffUsers = [
    { username: "city-nurse", email: "city.nurse@sera.demo", hospitalCode: "SERA-CITY-GEN", roleName: "HOSPITAL_STAFF" },
    { username: "emc-ops", email: "emc.ops@sera.demo", hospitalCode: "SERA-EMC", roleName: "HOSPITAL_STAFF" },
    { username: "multi-admin", email: "multi.admin@sera.demo", hospitalCode: "SERA-MULTI", roleName: "HOSPITAL_STAFF" },
  ];

  const staffIdMap = new Map();
  for (const user of staffUsers) {
    const hospitalId = hospitalIds.get(user.hospitalCode);
    const hash = await argon2.hash(DEMO_STAFF_PASSWORD);
    const userId = await ensureUser({ roleName: user.roleName, hospitalId, username: user.username, email: user.email, passwordHash: hash });
    staffIdMap.set(user.username, userId);
  }

  const standardTypes = [
    ["Road Accident", "Road traffic and collision response"],
    ["Cardiac Emergency", "Cardiac arrhythmia or cardiac event"],
    ["Fire Emergency", "Fire, smoke or hazardous combustion incident"],
    ["Medical Emergency", "General urgent clinical demand"],
    ["Trauma", "Major trauma and injury response"],
    ["Other Emergency", "Unclassified emergency requiring triage"],
  ];

  const typeIdMap = new Map();
  for (const [typeName, description] of standardTypes) typeIdMap.set(typeName, await ensureIncidentType(typeName, description));

  const resourceCatalog = [
    ["Oxygen cylinders", "cylinder", "Compressed oxygen supply"],
    ["Ventilators", "unit", "Critical respiratory support"],
    ["Wheelchairs", "chair", "Mobility assistance equipment"],
    ["Emergency kits", "kit", "Trauma and first-response pack"],
    ["Medical monitors", "unit", "Patient vital-sign monitoring"],
    ["First-aid kits", "kit", "Basic emergency care supplies"],
    ["Infusion pumps", "unit", "Medication infusion support"],
    ["Portable suction units", "unit", "Airway management support"],
    ["Stretchers", "unit", "Patient transport equipment"],
    ["Defibrillators", "unit", "Emergency cardiac shock device"],
    ["IV fluid packs", "pack", "Intravenous fluid delivery"],
    ["Burn dressings", "pack", "Fire and trauma wound coverage"],
  ];

  const resourceIdMap = new Map();
  for (const [resourceName, unit, description] of resourceCatalog) resourceIdMap.set(resourceName, await ensureResourceType(resourceName, unit, description));

  const allHospitalIds = [...hospitalIds.values()];
  for (const hospitalId of allHospitalIds) {
    for (const [resourceName, ,] of resourceCatalog) {
      const quantityOnHand = resourceName.includes("Oxygen") ? 26 : resourceName.includes("Ventilator") ? 14 : resourceName.includes("Wheelchair") ? 18 : resourceName.includes("Emergency") ? 32 : resourceName.includes("Monitor") ? 15 : resourceName.includes("First-aid") ? 40 : resourceName.includes("Infusion") ? 16 : resourceName.includes("Portable") ? 10 : resourceName.includes("Stretcher") ? 9 : resourceName.includes("Defibrillator") ? 8 : resourceName.includes("IV fluid") ? 26 : 14;
      const resourceTypeId = resourceIdMap.get(resourceName);
      await ensureInventory(hospitalId, resourceTypeId, quantityOnHand, 0);
    }
  }

  const readyIncidentStatus = "ASSIGNED";
  const incidentSeeds = [
    { summary: "DEMO-INCIDENT-READY-001 - Multi-vehicle collision with entrapment", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", actor: "city-nurse", severity: "CRITICAL", status: readyIncidentStatus, priorityScore: 94, occurredAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-002 - Cardiac arrest at commuter terminal", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", actor: "emc-ops", severity: "CRITICAL", status: "IN_PROGRESS", priorityScore: 90, occurredAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-003 - Basement fire and smoke inhalation", hospitalCode: "SERA-MULTI", typeName: "Fire Emergency", actor: "multi-admin", severity: "HIGH", status: "ASSIGNED", priorityScore: 82, occurredAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-004 - Severe trauma from industrial accident", hospitalCode: "SERA-CITY-GEN", typeName: "Trauma", actor: "city-nurse", severity: "HIGH", status: "RESOLVED", priorityScore: 80, occurredAt: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-005 - Stroke with neurological deterioration", hospitalCode: "SERA-EMC", typeName: "Medical Emergency", actor: "emc-ops", severity: "HIGH", status: "VALIDATED", priorityScore: 76, occurredAt: new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-006 - Maternity emergency and hemorrhage", hospitalCode: "SERA-MULTI", typeName: "Medical Emergency", actor: "multi-admin", severity: "CRITICAL", status: "ASSIGNED", priorityScore: 88, occurredAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-007 - Building collapse with crush injuries", hospitalCode: "SERA-CITY-GEN", typeName: "Trauma", actor: "city-nurse", severity: "CRITICAL", status: "IN_PROGRESS", priorityScore: 92, occurredAt: new Date(Date.now() - 42 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-008 - Gas leak and respiratory distress", hospitalCode: "SERA-EMC", typeName: "Other Emergency", actor: "emc-ops", severity: "MODERATE", status: "NEW", priorityScore: 58, occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-009 - Pediatric fever and dehydration", hospitalCode: "SERA-MULTI", typeName: "Medical Emergency", actor: "multi-admin", severity: "MODERATE", status: "PRIORITIZED", priorityScore: 63, occurredAt: new Date(Date.now() - 58 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-010 - Traffic accident with airway compromise", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", actor: "city-nurse", severity: "HIGH", status: "CANCELLED", priorityScore: 55, occurredAt: new Date(Date.now() - 64 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-011 - Domestic fire with smoke inversion", hospitalCode: "SERA-EMC", typeName: "Fire Emergency", actor: "emc-ops", severity: "HIGH", status: "ASSIGNED", priorityScore: 70, occurredAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-012 - Severe asthma attack in school bus", hospitalCode: "SERA-MULTI", typeName: "Medical Emergency", actor: "multi-admin", severity: "HIGH", status: "RESOLVED", priorityScore: 72, occurredAt: new Date(Date.now() - 82 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-013 - Head-on collision with multiple injuries", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", actor: "city-nurse", severity: "CRITICAL", status: "IN_PROGRESS", priorityScore: 88, occurredAt: new Date(Date.now() - 90 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-014 - Arrhythmia in dialysis patient", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", actor: "emc-ops", severity: "HIGH", status: "VALIDATED", priorityScore: 78, occurredAt: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-015 - Severe burn unit transfer request", hospitalCode: "SERA-MULTI", typeName: "Trauma", actor: "multi-admin", severity: "HIGH", status: "ASSIGNED", priorityScore: 83, occurredAt: new Date(Date.now() - 110 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-016 - Elderly fall and hip fracture", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", actor: "city-nurse", severity: "MODERATE", status: "NEW", priorityScore: 52, occurredAt: new Date(Date.now() - 128 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-017 - Electric shock at construction site", hospitalCode: "SERA-EMC", typeName: "Other Emergency", actor: "emc-ops", severity: "HIGH", status: "PRIORITIZED", priorityScore: 77, occurredAt: new Date(Date.now() - 140 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-018 - Chemical exposure and decontamination", hospitalCode: "SERA-MULTI", typeName: "Other Emergency", actor: "multi-admin", severity: "CRITICAL", status: "ASSIGNED", priorityScore: 91, occurredAt: new Date(Date.now() - 150 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-019 - Acute abdominal pain and sepsis", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", actor: "city-nurse", severity: "HIGH", status: "RESOLVED", priorityScore: 74, occurredAt: new Date(Date.now() - 160 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-020 - Industrial explosion near warehouse", hospitalCode: "SERA-EMC", typeName: "Fire Emergency", actor: "emc-ops", severity: "CRITICAL", status: "IN_PROGRESS", priorityScore: 89, occurredAt: new Date(Date.now() - 168 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-021 - Pedestrian struck by bus", hospitalCode: "SERA-MULTI", typeName: "Road Accident", actor: "multi-admin", severity: "HIGH", status: "ASSIGNED", priorityScore: 79, occurredAt: new Date(Date.now() - 180 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-022 - Neonatal respiratory distress", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", actor: "city-nurse", severity: "CRITICAL", status: "ASSIGNED", priorityScore: 87, occurredAt: new Date(Date.now() - 190 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-023 - Severe allergic reaction at conference", hospitalCode: "SERA-EMC", typeName: "Medical Emergency", actor: "emc-ops", severity: "HIGH", status: "RESOLVED", priorityScore: 69, occurredAt: new Date(Date.now() - 210 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-024 - Fire in hospital laundry room", hospitalCode: "SERA-MULTI", typeName: "Fire Emergency", actor: "multi-admin", severity: "MODERATE", status: "NEW", priorityScore: 51, occurredAt: new Date(Date.now() - 220 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-025 - Motorcycle collision with ejection", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", actor: "city-nurse", severity: "HIGH", status: "VALIDATED", priorityScore: 75, occurredAt: new Date(Date.now() - 230 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-026 - Infectious exposure and isolation need", hospitalCode: "SERA-EMC", typeName: "Other Emergency", actor: "emc-ops", severity: "MODERATE", status: "PRIORITIZED", priorityScore: 62, occurredAt: new Date(Date.now() - 240 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-027 - Cardiac chest pain with syncope", hospitalCode: "SERA-MULTI", typeName: "Cardiac Emergency", actor: "multi-admin", severity: "HIGH", status: "IN_PROGRESS", priorityScore: 78, occurredAt: new Date(Date.now() - 250 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-028 - Ladder fall with multiple fractures", hospitalCode: "SERA-CITY-GEN", typeName: "Trauma", actor: "city-nurse", severity: "HIGH", status: "RESOLVED", priorityScore: 73, occurredAt: new Date(Date.now() - 260 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-029 - Suspected stroke while driving", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", actor: "emc-ops", severity: "MODERATE", status: "NEW", priorityScore: 60, occurredAt: new Date(Date.now() - 270 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-030 - Pediatric burn after kitchen accident", hospitalCode: "SERA-MULTI", typeName: "Trauma", actor: "multi-admin", severity: "HIGH", status: "VALIDATED", priorityScore: 66, occurredAt: new Date(Date.now() - 280 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-031 - Respiratory distress in community clinic", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", actor: "city-nurse", severity: "MODERATE", status: "NEW", priorityScore: 54, occurredAt: new Date(Date.now() - 290 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-032 - Vehicle rollover with entrapment", hospitalCode: "SERA-EMC", typeName: "Road Accident", actor: "emc-ops", severity: "CRITICAL", status: "ASSIGNED", priorityScore: 90, occurredAt: new Date(Date.now() - 300 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-033 - Fire alarm at residential block", hospitalCode: "SERA-MULTI", typeName: "Fire Emergency", actor: "multi-admin", severity: "LOW", status: "CANCELLED", priorityScore: 35, occurredAt: new Date(Date.now() - 310 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-034 - Seizure and hypoglycemia event", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", actor: "city-nurse", severity: "MODERATE", status: "RESOLVED", priorityScore: 57, occurredAt: new Date(Date.now() - 320 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-035 - Severe chest pain with collapse", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", actor: "emc-ops", severity: "CRITICAL", status: "ASSIGNED", priorityScore: 86, occurredAt: new Date(Date.now() - 330 * 60 * 60 * 1000).toISOString() },
    { summary: "DEMO-INCIDENT-036 - Power outage and medical support failure", hospitalCode: "SERA-MULTI", typeName: "Other Emergency", actor: "multi-admin", severity: "MODERATE", status: "VALIDATED", priorityScore: 61, occurredAt: new Date(Date.now() - 340 * 60 * 60 * 1000).toISOString() },
  ];

  const incidentIdsBySummary = new Map();
  for (const incidentSeed of incidentSeeds) {
    const hospitalId = hospitalIds.get(incidentSeed.hospitalCode);
    const typeId = typeIdMap.get(incidentSeed.typeName);
    const actorId = staffIdMap.get(incidentSeed.actor);
    await client.query("SELECT set_config('app.actor_user_id',$1,true)", [String(actorId)]);
    const result = await client.query("INSERT INTO emergency_incidents(hospital_id,incident_type_id,reported_by_user_id,location_id,summary,occurred_at,severity,priority_score,incident_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING incident_id", [hospitalId, typeId, actorId, await ensureLocation(`${incidentSeed.hospitalCode}-dispatch`, "Demo site", 12.9 + Math.random() * 0.05, 77.5 + Math.random() * 0.05), incidentSeed.summary, incidentSeed.occurredAt, incidentSeed.severity, incidentSeed.priorityScore, incidentSeed.status]);
    incidentIdsBySummary.set(incidentSeed.summary, result.rows[0].incident_id);
  }

  const reportTemplates = [
    { description: "DEMO-REPORT-001 - Pedestrian struck near market square", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", reportStatus: "RECEIVED", actor: "city-nurse" },
    { description: "DEMO-REPORT-002 - Passenger with severe chest discomfort", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", reportStatus: "REVIEWED", actor: "emc-ops" },
    { description: "DEMO-REPORT-003 - Apartment fire near storage room", hospitalCode: "SERA-MULTI", typeName: "Fire Emergency", reportStatus: "RECEIVED", actor: "multi-admin" },
    { description: "DEMO-REPORT-004 - Worker with open fractures", hospitalCode: "SERA-CITY-GEN", typeName: "Trauma", reportStatus: "REVIEWED", actor: "city-nurse" },
    { description: "DEMO-REPORT-005 - Elderly patient with breathing difficulty", hospitalCode: "SERA-EMC", typeName: "Medical Emergency", reportStatus: "RECEIVED", actor: "emc-ops" },
    { description: "DEMO-REPORT-006 - Child with dehydration after fever", hospitalCode: "SERA-MULTI", typeName: "Medical Emergency", reportStatus: "CONVERTED", actor: "multi-admin" },
    { description: "DEMO-REPORT-007 - Bus crash and trapped passengers", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", reportStatus: "CONVERTED", actor: "city-nurse" },
    { description: "DEMO-REPORT-008 - Smoke exposure and coughing", hospitalCode: "SERA-EMC", typeName: "Fire Emergency", reportStatus: "REJECTED", actor: "emc-ops" },
    { description: "DEMO-REPORT-009 - Sudden collapse after exertion", hospitalCode: "SERA-MULTI", typeName: "Cardiac Emergency", reportStatus: "REVIEWED", actor: "multi-admin" },
    { description: "DEMO-REPORT-010 - Falls in nursing home", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", reportStatus: "CLOSED", actor: "city-nurse" },
    { description: "DEMO-REPORT-011 - Chemical spill near loading bay", hospitalCode: "SERA-EMC", typeName: "Other Emergency", reportStatus: "REVIEWED", actor: "emc-ops" },
    { description: "DEMO-REPORT-012 - Maternal hemorrhage at clinic", hospitalCode: "SERA-MULTI", typeName: "Medical Emergency", reportStatus: "RECEIVED", actor: "multi-admin" },
    { description: "DEMO-REPORT-013 - Immobile patient after a road fall", hospitalCode: "SERA-CITY-GEN", typeName: "Trauma", reportStatus: "REVIEWED", actor: "city-nurse" },
    { description: "DEMO-REPORT-014 - Cardiac chest pain in public park", hospitalCode: "SERA-EMC", typeName: "Cardiac Emergency", reportStatus: "CONVERTED", actor: "emc-ops" },
    { description: "DEMO-REPORT-015 - Burn injury from cooking oil", hospitalCode: "SERA-MULTI", typeName: "Trauma", reportStatus: "RECEIVED", actor: "multi-admin" },
    { description: "DEMO-REPORT-016 - Panic attack and dizziness", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", reportStatus: "CLOSED", actor: "city-nurse" },
    { description: "DEMO-REPORT-017 - Smoke inhalation from school fire", hospitalCode: "SERA-EMC", typeName: "Fire Emergency", reportStatus: "REVIEWED", actor: "emc-ops" },
    { description: "DEMO-REPORT-018 - Severe wound from machinery", hospitalCode: "SERA-MULTI", typeName: "Trauma", reportStatus: "CONVERTED", actor: "multi-admin" },
    { description: "DEMO-REPORT-019 - Child with fainting episode", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", reportStatus: "REVIEWED", actor: "city-nurse" },
    { description: "DEMO-REPORT-020 - Structural collapse near metro line", hospitalCode: "SERA-EMC", typeName: "Other Emergency", reportStatus: "REVIEWED", actor: "emc-ops" },
    { description: "DEMO-REPORT-021 - Gas leak with respiratory distress", hospitalCode: "SERA-MULTI", typeName: "Other Emergency", reportStatus: "RECEIVED", actor: "multi-admin" },
    { description: "DEMO-REPORT-022 - Motorcycle crash with severe bleeding", hospitalCode: "SERA-CITY-GEN", typeName: "Road Accident", reportStatus: "REVIEWED", actor: "city-nurse" },
    { description: "DEMO-REPORT-023 - Asthma attack at transport hub", hospitalCode: "SERA-EMC", typeName: "Medical Emergency", reportStatus: "CONVERTED", actor: "emc-ops" },
    { description: "DEMO-REPORT-024 - Explosion at residential block", hospitalCode: "SERA-MULTI", typeName: "Fire Emergency", reportStatus: "REVIEWED", actor: "multi-admin" },
    { description: "DEMO-REPORT-025 - Syncope in commuter rail station", hospitalCode: "SERA-CITY-GEN", typeName: "Cardiac Emergency", reportStatus: "RECEIVED", actor: "city-nurse" },
    { description: "DEMO-REPORT-026 - Accident with trapped victim", hospitalCode: "SERA-EMC", typeName: "Road Accident", reportStatus: "REJECTED", actor: "emc-ops" },
    { description: "DEMO-REPORT-027 - Severe laceration at workshop", hospitalCode: "SERA-MULTI", typeName: "Trauma", reportStatus: "RECEIVED", actor: "multi-admin" },
    { description: "DEMO-REPORT-028 - Elderly woman found unresponsive", hospitalCode: "SERA-CITY-GEN", typeName: "Medical Emergency", reportStatus: "CONVERTED", actor: "city-nurse" },
    { description: "DEMO-REPORT-029 - Smoke inhalation in warehouse", hospitalCode: "SERA-EMC", typeName: "Fire Emergency", reportStatus: "REVIEWED", actor: "emc-ops" },
    { description: "DEMO-REPORT-030 - Thermal burn from kitchen fire", hospitalCode: "SERA-MULTI", typeName: "Trauma", reportStatus: "CLOSED", actor: "multi-admin" },
  ];

  const reportIncidentMap = new Map([
    ["DEMO-REPORT-006", "DEMO-INCIDENT-006 - Maternity emergency and hemorrhage"],
    ["DEMO-REPORT-007", "DEMO-INCIDENT-007 - Building collapse with crush injuries"],
    ["DEMO-REPORT-014", "DEMO-INCIDENT-014 - Arrhythmia in dialysis patient"],
    ["DEMO-REPORT-018", "DEMO-INCIDENT-018 - Chemical exposure and decontamination"],
    ["DEMO-REPORT-023", "DEMO-INCIDENT-023 - Severe allergic reaction at conference"],
    ["DEMO-REPORT-028", "DEMO-INCIDENT-028 - Ladder fall with multiple fractures"],
  ]);

  for (const reportSeed of reportTemplates) {
    const hospitalId = hospitalIds.get(reportSeed.hospitalCode);
    const typeId = typeIdMap.get(reportSeed.typeName);
    const actorId = staffIdMap.get(reportSeed.actor);
    const locationId = await ensureLocation(`${reportSeed.hospitalCode}-${reportSeed.typeName}-report`, reportSeed.hospitalCode, 12.9 + Math.random() * 0.05, 77.55 + Math.random() * 0.05);
    const incidentId = reportIncidentMap.get(reportSeed.description)
      ? incidentIdsBySummary.get(reportIncidentMap.get(reportSeed.description))
      : null;

    await client.query(
      "INSERT INTO citizen_reports(hospital_id,reported_by_user_id,incident_type_id,location_id,description,reported_at,report_status,incident_id) VALUES($1,$2,$3,$4,$5,now() - ($6::int * interval '6 hours'),$7,$8)",
      [hospitalId, actorId, typeId, locationId, reportSeed.description, Math.floor(Math.random() * 14) + 1, reportSeed.reportStatus, incidentId],
    );
  }

  const bedPlan = [
    { hospitalCode: "SERA-CITY-GEN", beds: [
      ["CITY-GEN-01", "GENERAL", "AVAILABLE"], ["CITY-GEN-02", "GENERAL", "AVAILABLE"], ["CITY-GEN-03", "ICU", "OCCUPIED"], ["CITY-GEN-04", "EMERGENCY", "AVAILABLE"], ["CITY-GEN-05", "ISOLATION", "RESERVED"], ["CITY-GEN-06", "GENERAL", "AVAILABLE"], ["CITY-GEN-07", "ICU", "OUT_OF_SERVICE"], ["CITY-GEN-08", "EMERGENCY", "AVAILABLE"], ["CITY-GEN-09", "GENERAL", "AVAILABLE"], ["CITY-GEN-10", "ISOLATION", "OCCUPIED"], ["CITY-GEN-11", "GENERAL", "AVAILABLE"], ["CITY-GEN-12", "ICU", "AVAILABLE"], ["CITY-GEN-13", "EMERGENCY", "RESERVED"], ["CITY-GEN-14", "GENERAL", "AVAILABLE"], ["CITY-GEN-15", "ISOLATION", "AVAILABLE"], ["CITY-GEN-16", "GENERAL", "AVAILABLE"], ["CITY-GEN-17", "ICU", "AVAILABLE"], ["CITY-GEN-18", "EMERGENCY", "AVAILABLE"]
    ]},
    { hospitalCode: "SERA-EMC", beds: [
      ["EMC-01", "GENERAL", "AVAILABLE"], ["EMC-02", "EMERGENCY", "AVAILABLE"], ["EMC-03", "ICU", "OCCUPIED"], ["EMC-04", "GENERAL", "AVAILABLE"], ["EMC-05", "ISOLATION", "AVAILABLE"], ["EMC-06", "EMERGENCY", "RESERVED"], ["EMC-07", "GENERAL", "AVAILABLE"], ["EMC-08", "ICU", "AVAILABLE"], ["EMC-09", "GENERAL", "AVAILABLE"], ["EMC-10", "EMERGENCY", "AVAILABLE"], ["EMC-11", "ISOLATION", "OCCUPIED"], ["EMC-12", "GENERAL", "AVAILABLE"], ["EMC-13", "ICU", "OUT_OF_SERVICE"], ["EMC-14", "EMERGENCY", "AVAILABLE"], ["EMC-15", "GENERAL", "AVAILABLE"], ["EMC-16", "ISOLATION", "AVAILABLE"], ["EMC-17", "GENERAL", "AVAILABLE"], ["EMC-18", "ICU", "AVAILABLE"]
    ]},
    { hospitalCode: "SERA-MULTI", beds: [
      ["MULTI-01", "GENERAL", "AVAILABLE"], ["MULTI-02", "ICU", "OCCUPIED"], ["MULTI-03", "EMERGENCY", "AVAILABLE"], ["MULTI-04", "GENERAL", "AVAILABLE"], ["MULTI-05", "ISOLATION", "RESERVED"], ["MULTI-06", "GENERAL", "AVAILABLE"], ["MULTI-07", "ICU", "AVAILABLE"], ["MULTI-08", "EMERGENCY", "AVAILABLE"], ["MULTI-09", "GENERAL", "AVAILABLE"], ["MULTI-10", "ISOLATION", "AVAILABLE"], ["MULTI-11", "GENERAL", "OCCUPIED"], ["MULTI-12", "ICU", "AVAILABLE"], ["MULTI-13", "EMERGENCY", "AVAILABLE"], ["MULTI-14", "GENERAL", "AVAILABLE"], ["MULTI-15", "ISOLATION", "OUT_OF_SERVICE"], ["MULTI-16", "GENERAL", "AVAILABLE"], ["MULTI-17", "ICU", "AVAILABLE"], ["MULTI-18", "EMERGENCY", "RESERVED"]
    ]}
  ];

  const bedAssignments = [];
  for (const plan of bedPlan) {
    const hospitalId = hospitalIds.get(plan.hospitalCode);
    for (const [bedCode, bedType, bedStatus] of plan.beds) {
      const bedResult = await client.query("INSERT INTO hospital_beds(hospital_id,bed_code,bed_type,bed_status) VALUES($1,$2,$3,$4) ON CONFLICT(hospital_id,bed_code) DO UPDATE SET bed_type=EXCLUDED.bed_type, bed_status=EXCLUDED.bed_status, updated_at=now() RETURNING bed_id", [hospitalId, bedCode, bedType, bedStatus]);
      const bedId = bedResult.rows[0].bed_id;
      if (["RESERVED", "OCCUPIED"].includes(bedStatus)) {
        const incident = await client.query("SELECT incident_id FROM emergency_incidents WHERE hospital_id=$1 AND incident_id NOT IN (SELECT incident_id FROM bed_assignments WHERE assignment_status IN ('RESERVED','OCCUPIED')) ORDER BY occurred_at DESC LIMIT 1", [hospitalId]);
        if (incident.rowCount) {
          const actorId = staffIdMap.get(plan.hospitalCode === "SERA-CITY-GEN" ? "city-nurse" : plan.hospitalCode === "SERA-EMC" ? "emc-ops" : "multi-admin") ?? [...staffIdMap.values()][0];
          const assignmentStatus = bedStatus === "OCCUPIED" ? "OCCUPIED" : "RESERVED";
          const insert = await client.query("INSERT INTO bed_assignments(bed_id,incident_id,assigned_by_user_id,assignment_status,occupied_at,reserved_at) VALUES($1,$2,$3,$4,CASE WHEN $4='OCCUPIED' THEN now() ELSE NULL END,CASE WHEN $4='RESERVED' THEN now() ELSE now() END) RETURNING bed_assignment_id", [bedId, incident.rows[0].incident_id, actorId, assignmentStatus]);
          bedAssignments.push({ bedId, incidentId: incident.rows[0].incident_id, assignmentId: insert.rows[0].bed_assignment_id, active: true, status: assignmentStatus });
        }
      }
    }
  }

  const masterInventory = await client.query("SELECT inventory_id, hospital_id, resource_type_id, quantity_on_hand, quantity_reserved FROM resource_inventory ORDER BY inventory_id");
  const inventoryByHospital = new Map();
  for (const row of masterInventory.rows) {
    const key = `${row.hospital_id}:${row.resource_type_id}`;
    inventoryByHospital.set(key, row);
  }

  const dispatchedTeamIds = new Map();
  const hospitalTeamPlans = [
    { hospitalCode: "SERA-CITY-GEN", teams: [
      ["SERA City Alpha Team", "AVAILABLE"], ["SERA City Beta Team", "DISPATCHED"], ["SERA City Gamma Team", "OFF_DUTY"]
    ]},
    { hospitalCode: "SERA-EMC", teams: [
      ["SERA EMC Response Team", "AVAILABLE"], ["SERA EMC Tactical Team", "ASSIGNED"], ["SERA EMC Support Team", "AVAILABLE"]
    ]},
    { hospitalCode: "SERA-MULTI", teams: [
      ["SERA Multi Critical Team", "AVAILABLE"], ["SERA Multi Field Team", "DISPATCHED"], ["SERA Multi Fast Response", "AVAILABLE"]
    ]},
  ];

  for (const plan of hospitalTeamPlans) {
    const hospitalId = hospitalIds.get(plan.hospitalCode);
    const locationId = await ensureLocation(`${plan.hospitalCode}-team-hub`, plan.hospitalCode, 12.95 + Math.random() * 0.05, 77.58 + Math.random() * 0.05);
    for (const [name, teamStatus] of plan.teams) {
      const teamId = await ensureTeam(hospitalId, name, teamStatus === "ASSIGNED" ? "AVAILABLE" : teamStatus, locationId);
      dispatchedTeamIds.set(`${plan.hospitalCode}:${name}`, teamId);
    }
  }

  const teamMentors = [
    ["SERA City Alpha Team", "city-nurse", "LEAD"], ["SERA City Alpha Team", "multi-admin", "PARAMEDIC"], ["SERA City Beta Team", "emc-ops", "PARAMEDIC"],
    ["SERA City Gamma Team", "city-nurse", "NURSE"], ["SERA EMC Response Team", "emc-ops", "LEAD"], ["SERA EMC Response Team", "city-nurse", "PARAMEDIC"],
    ["SERA EMC Tactical Team", "multi-admin", "PARAMEDIC"], ["SERA EMC Support Team", "city-nurse", "NURSE"], ["SERA EMC Support Team", "emc-ops", "MEDIC"],
    ["SERA Multi Critical Team", "multi-admin", "LEAD"], ["SERA Multi Critical Team", "city-nurse", "PARAMEDIC"], ["SERA Multi Field Team", "emc-ops", "NURSE"],
    ["SERA Multi Fast Response", "multi-admin", "MEDIC"], ["SERA Multi Fast Response", "city-nurse", "PARAMEDIC"], ["SERA EMC Tactical Team", "emc-ops", "LEAD"]
  ];

  for (const [teamName, userName, memberRole] of teamMentors) {
    const teamRow = await client.query("SELECT team_id FROM response_teams WHERE lower(team_name)=lower($1) LIMIT 1", [teamName]);
    const userRow = await client.query("SELECT user_id FROM users WHERE username=$1 LIMIT 1", [userName]);
    if (teamRow.rowCount && userRow.rowCount) await ensureMember(teamRow.rows[0].team_id, userRow.rows[0].user_id, memberRole);
  }

  const vehiclePlan = [
    { hospitalCode: "SERA-CITY-GEN", registration: "SERA-CG-101", type: "AMBULANCE", status: "AVAILABLE" },
    { hospitalCode: "SERA-CITY-GEN", registration: "SERA-CG-204", type: "MEDICAL_VAN", status: "MAINTENANCE" },
    { hospitalCode: "SERA-EMC", registration: "SERA-EM-330", type: "AMBULANCE", status: "AVAILABLE" },
    { hospitalCode: "SERA-EMC", registration: "SERA-EM-441", type: "RESCUE", status: "DISPATCHED" },
    { hospitalCode: "SERA-MULTI", registration: "SERA-MM-501", type: "AMBULANCE", status: "AVAILABLE" },
    { hospitalCode: "SERA-MULTI", registration: "SERA-MM-612", type: "MEDICAL_VAN", status: "AVAILABLE" },
    { hospitalCode: "SERA-MULTI", registration: "SERA-MM-720", type: "RESCUE", status: "MAINTENANCE" },
  ];

  for (const vehicle of vehiclePlan) {
    const hospitalId = hospitalIds.get(vehicle.hospitalCode);
    const locationId = await ensureLocation(`${vehicle.hospitalCode}-vehicle-base`, vehicle.hospitalCode, 12.95 + Math.random() * 0.05, 77.58 + Math.random() * 0.05);
    await ensureVehicle(hospitalId, vehicle.registration, vehicle.type, vehicle.status, locationId);
  }

  const resourceAllocations = [
    { hospitalCode: "SERA-CITY-GEN", resourceName: "Oxygen cylinders", incidentSummary: "DEMO-INCIDENT-READY-001 - Multi-vehicle collision with entrapment", quantity: 7, status: "RESERVED" },
    { hospitalCode: "SERA-CITY-GEN", resourceName: "Stretchers", incidentSummary: "DEMO-INCIDENT-013 - Head-on collision with multiple injuries", quantity: 2, status: "CONSUMED" },
    { hospitalCode: "SERA-EMC", resourceName: "Ventilators", incidentSummary: "DEMO-INCIDENT-002 - Cardiac arrest at commuter terminal", quantity: 2, status: "RESERVED" },
    { hospitalCode: "SERA-EMC", resourceName: "Defibrillators", incidentSummary: "DEMO-INCIDENT-014 - Arrhythmia in dialysis patient", quantity: 1, status: "CONSUMED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Emergency kits", incidentSummary: "DEMO-INCIDENT-003 - Basement fire and smoke inhalation", quantity: 4, status: "RESERVED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Burn dressings", incidentSummary: "DEMO-INCIDENT-015 - Severe burn unit transfer request", quantity: 5, status: "RELEASED" },
    { hospitalCode: "SERA-CITY-GEN", resourceName: "First-aid kits", incidentSummary: "DEMO-INCIDENT-019 - Acute abdominal pain and sepsis", quantity: 6, status: "CONSUMED" },
    { hospitalCode: "SERA-CITY-GEN", resourceName: "IV fluid packs", incidentSummary: "DEMO-INCIDENT-022 - Neonatal respiratory distress", quantity: 4, status: "RESERVED" },
    { hospitalCode: "SERA-EMC", resourceName: "Portable suction units", incidentSummary: "DEMO-INCIDENT-020 - Industrial explosion near warehouse", quantity: 2, status: "RELEASED" },
    { hospitalCode: "SERA-EMC", resourceName: "Medical monitors", incidentSummary: "DEMO-INCIDENT-023 - Severe allergic reaction at conference", quantity: 3, status: "CONSUMED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Wheelchairs", incidentSummary: "DEMO-INCIDENT-021 - Pedestrian struck by bus", quantity: 3, status: "RESERVED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Stretchers", incidentSummary: "DEMO-INCIDENT-030 - Pediatric burn after kitchen fire", quantity: 2, status: "CONSUMED" },
    { hospitalCode: "SERA-CITY-GEN", resourceName: "Defibrillators", incidentSummary: "DEMO-INCIDENT-025 - Motorcycle collision with ejection", quantity: 1, status: "RELEASED" },
    { hospitalCode: "SERA-EMC", resourceName: "Infusion pumps", incidentSummary: "DEMO-INCIDENT-026 - Infectious exposure and isolation need", quantity: 2, status: "RESERVED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Oxygen cylinders", incidentSummary: "DEMO-INCIDENT-027 - Cardiac chest pain with syncope", quantity: 5, status: "CONSUMED" },
    { hospitalCode: "SERA-CITY-GEN", resourceName: "Emergency kits", incidentSummary: "DEMO-INCIDENT-031 - Respiratory distress in community clinic", quantity: 3, status: "RESERVED" },
    { hospitalCode: "SERA-EMC", resourceName: "First-aid kits", incidentSummary: "DEMO-INCIDENT-032 - Vehicle rollover with entrapment", quantity: 4, status: "RESERVED" },
    { hospitalCode: "SERA-MULTI", resourceName: "Ventilators", incidentSummary: "DEMO-INCIDENT-035 - Severe chest pain with collapse", quantity: 2, status: "CONSUMED" },
  ];

  const validStatusSet = new Set(["RESERVED", "RELEASED", "CONSUMED"]);
  for (const allocation of resourceAllocations) {
    const hospitalId = hospitalIds.get(allocation.hospitalCode);
    const resourceTypeId = resourceIdMap.get(allocation.resourceName);
    const incidentId = incidentIdsBySummary.get(allocation.incidentSummary);
    const inventoryRow = await client.query("SELECT inventory_id, quantity_on_hand, quantity_reserved FROM resource_inventory WHERE hospital_id=$1 AND resource_type_id=$2 LIMIT 1", [hospitalId, resourceTypeId]);
    if (!inventoryRow.rowCount || !incidentId) continue;
    const actorId = staffIdMap.get(allocation.hospitalCode === "SERA-CITY-GEN" ? "city-nurse" : allocation.hospitalCode === "SERA-EMC" ? "emc-ops" : "multi-admin") ?? [...staffIdMap.values()][0];
    const result = await client.query("INSERT INTO resource_allocations(incident_id,inventory_id,allocated_by_user_id,quantity,allocation_status,reserved_at,released_at,consumed_at) VALUES($1,$2,$3,$4,$5,now(),CASE WHEN $5='RELEASED' THEN now() ELSE NULL END,CASE WHEN $5='CONSUMED' THEN now() ELSE NULL END) RETURNING allocation_id,quantity,allocation_status", [incidentId, inventoryRow.rows[0].inventory_id, actorId, allocation.quantity, allocation.status]);
    if (validStatusSet.has(result.rows[0].allocation_status) && result.rows[0].allocation_status === "RESERVED") {
      await client.query("UPDATE resource_inventory SET quantity_reserved=quantity_reserved + $2, updated_at=now() WHERE inventory_id=$1", [inventoryRow.rows[0].inventory_id, result.rows[0].quantity]);
    }
    if (result.rows[0].allocation_status === "CONSUMED") {
      await client.query("UPDATE resource_inventory SET quantity_on_hand=GREATEST(0, quantity_on_hand - $2), quantity_reserved=GREATEST(0, quantity_reserved - $2), updated_at=now() WHERE inventory_id=$1", [inventoryRow.rows[0].inventory_id, result.rows[0].quantity]);
    }
    if (result.rows[0].allocation_status === "RELEASED") {
      await client.query("UPDATE resource_inventory SET quantity_reserved=GREATEST(0, quantity_reserved - $2), updated_at=now() WHERE inventory_id=$1", [inventoryRow.rows[0].inventory_id, result.rows[0].quantity]);
    }
  }

  const dispatchSeeds = [
    { incidentSummary: "DEMO-INCIDENT-002 - Cardiac arrest at commuter terminal", teamName: "SERA EMC Response Team", vehicleRegistration: "SERA-EM-330", status: "EN_ROUTE", createdBy: "emc-ops" },
    { incidentSummary: "DEMO-INCIDENT-003 - Basement fire and smoke inhalation", teamName: "SERA Multi Critical Team", vehicleRegistration: "SERA-MM-501", status: "ON_SCENE", createdBy: "multi-admin" },
    { incidentSummary: "DEMO-INCIDENT-004 - Severe trauma from industrial accident", teamName: "SERA City Alpha Team", vehicleRegistration: "SERA-CG-101", status: "COMPLETED", createdBy: "city-nurse" },
    { incidentSummary: "DEMO-INCIDENT-006 - Maternity emergency and hemorrhage", teamName: "SERA Multi Fast Response", vehicleRegistration: "SERA-MM-612", status: "DISPATCHED", createdBy: "multi-admin" },
    { incidentSummary: "DEMO-INCIDENT-011 - Domestic fire with smoke inversion", teamName: "SERA EMC Tactical Team", vehicleRegistration: "SERA-EM-441", status: "QUEUED", createdBy: "emc-ops" },
    { incidentSummary: "DEMO-INCIDENT-013 - Head-on collision with multiple injuries", teamName: "SERA City Beta Team", vehicleRegistration: "SERA-CG-101", status: "EN_ROUTE", createdBy: "city-nurse" },
    { incidentSummary: "DEMO-INCIDENT-015 - Severe burn unit transfer request", teamName: "SERA Multi Field Team", vehicleRegistration: "SERA-MM-501", status: "ON_SCENE", createdBy: "multi-admin" },
    { incidentSummary: "DEMO-INCIDENT-020 - Industrial explosion near warehouse", teamName: "SERA EMC Support Team", vehicleRegistration: "SERA-EM-330", status: "COMPLETED", createdBy: "emc-ops" },
    { incidentSummary: "DEMO-INCIDENT-021 - Pedestrian struck by bus", teamName: "SERA Multi Critical Team", vehicleRegistration: "SERA-MM-612", status: "QUEUED", createdBy: "multi-admin" },
    { incidentSummary: "DEMO-INCIDENT-032 - Vehicle rollover with entrapment", teamName: "SERA EMC Response Team", vehicleRegistration: "SERA-EM-441", status: "DISPATCHED", createdBy: "emc-ops" },
    { incidentSummary: "DEMO-INCIDENT-035 - Severe chest pain with collapse", teamName: "SERA EMC Tactical Team", vehicleRegistration: "SERA-EM-330", status: "QUEUED", createdBy: "emc-ops" },
    { incidentSummary: "DEMO-INCIDENT-036 - Power outage and medical support failure", teamName: "SERA Multi Fast Response", vehicleRegistration: "SERA-MM-501", status: "CANCELLED", createdBy: "multi-admin" },
  ];

  for (const dispatchSeed of dispatchSeeds) {
    const incidentId = incidentIdsBySummary.get(dispatchSeed.incidentSummary);
    if (!incidentId) continue;
    const teamRow = await client.query("SELECT team_id,hospital_id FROM response_teams WHERE lower(team_name)=lower($1) LIMIT 1", [dispatchSeed.teamName]);
    const vehicleRow = await client.query("SELECT vehicle_id,hospital_id FROM vehicles WHERE registration_number=$1 LIMIT 1", [dispatchSeed.vehicleRegistration]);
    if (!teamRow.rowCount || !vehicleRow.rowCount) continue;
    const userId = staffIdMap.get(dispatchSeed.createdBy);
    const teamConflict = await client.query("SELECT 1 FROM dispatches WHERE team_id=$1 AND dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING') LIMIT 1", [teamRow.rows[0].team_id]);
    const vehicleConflict = await client.query("SELECT 1 FROM dispatches WHERE vehicle_id=$1 AND dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING') LIMIT 1", [vehicleRow.rows[0].vehicle_id]);
    const incidentConflict = await client.query("SELECT 1 FROM dispatches WHERE incident_id=$1 AND dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING') LIMIT 1", [incidentId]);
    if (teamConflict.rowCount || vehicleConflict.rowCount || incidentConflict.rowCount) continue;
    const dispatchResult = await client.query("INSERT INTO dispatches(incident_id,team_id,vehicle_id,created_by_user_id,hospital_id,dispatched_at,arrived_at,completed_at,dispatch_status) VALUES($1,$2,$3,$4,$5,now() - interval '90 minutes',CASE WHEN $6 IN ('ON_SCENE','COMPLETED','TRANSPORTING') THEN now() - interval '40 minutes' ELSE NULL END,CASE WHEN $6='COMPLETED' THEN now() - interval '10 minutes' ELSE NULL END,$6) RETURNING dispatch_id", [incidentId, teamRow.rows[0].team_id, vehicleRow.rows[0].vehicle_id, userId, teamRow.rows[0].hospital_id, dispatchSeed.status]);
    if (["QUEUED", "DISPATCHED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"].includes(dispatchSeed.status)) {
      await client.query("UPDATE response_teams SET team_status='DISPATCHED' WHERE team_id=$1", [teamRow.rows[0].team_id]);
      await client.query("UPDATE vehicles SET vehicle_status='DISPATCHED' WHERE vehicle_id=$1", [vehicleRow.rows[0].vehicle_id]);
    }
    if (dispatchSeed.status === "COMPLETED") {
      await client.query("UPDATE response_teams SET team_status='AVAILABLE' WHERE team_id=$1", [teamRow.rows[0].team_id]);
      await client.query("UPDATE vehicles SET vehicle_status='AVAILABLE' WHERE vehicle_id=$1", [vehicleRow.rows[0].vehicle_id]);
    }
    await queueEvent(incidentId, userId, "DISPATCH_CREATED", `Dispatch created for ${dispatchSeed.teamName}`, { dispatchId: dispatchResult.rows[0].dispatch_id, teamId: teamRow.rows[0].team_id, vehicleId: vehicleRow.rows[0].vehicle_id, status: dispatchSeed.status });
  }

  const readyIncidentId = incidentIdsBySummary.get("DEMO-INCIDENT-READY-001 - Multi-vehicle collision with entrapment");
  const readyHospitalId = hospitalIds.get("SERA-CITY-GEN");
  const readyLocationId = await ensureLocation("SERA-CITY-GEN-ready-incident", "City Center", 12.9715, 77.5949);
  const readyUserId = staffIdMap.get("city-nurse");
  const readyBedResult = await client.query("SELECT bed_id FROM hospital_beds WHERE hospital_id=$1 AND bed_status='AVAILABLE' AND bed_type IN ('GENERAL','EMERGENCY') ORDER BY bed_id LIMIT 1", [readyHospitalId]);
  const readyInventoryRows = await client.query("SELECT inventory_id, quantity_on_hand, quantity_reserved FROM resource_inventory WHERE hospital_id=$1 AND resource_type_id IN (SELECT resource_type_id FROM resource_types WHERE resource_name IN ('Oxygen cylinders','Emergency kits','Medical monitors','Stretchers')) ORDER BY resource_type_id LIMIT 4", [readyHospitalId]);
  const readyTeamRow = await client.query("SELECT team_id FROM response_teams WHERE hospital_id=$1 AND team_name='SERA City Alpha Team' LIMIT 1", [readyHospitalId]);
  const readyVehicleRow = await client.query("SELECT vehicle_id FROM vehicles WHERE hospital_id=$1 AND vehicle_status='AVAILABLE' AND registration_number='SERA-CG-101' LIMIT 1", [readyHospitalId]);

  if (readyIncidentId && readyBedResult.rowCount && readyInventoryRows.rowCount >= 2 && readyTeamRow.rowCount && readyVehicleRow.rowCount) {
    await client.query("UPDATE emergency_incidents SET incident_status='ASSIGNED', severity='CRITICAL', priority_score=94 WHERE incident_id=$1", [readyIncidentId]);
    await client.query("UPDATE hospital_beds SET bed_status='RESERVED' WHERE bed_id=$1", [readyBedResult.rows[0].bed_id]);
    await client.query("INSERT INTO bed_assignments(bed_id,incident_id,assigned_by_user_id,assignment_status,reserved_at) VALUES($1,$2,$3,'RESERVED',now()) ON CONFLICT DO NOTHING", [readyBedResult.rows[0].bed_id, readyIncidentId, readyUserId]);
    for (const row of readyInventoryRows.rows) {
      await client.query("UPDATE resource_inventory SET quantity_reserved = quantity_reserved + CASE WHEN $2 > 0 THEN $2 ELSE 0 END, updated_at=now() WHERE inventory_id=$1", [row.inventory_id, Math.min(2, row.quantity_on_hand)]);
    }
    await client.query("UPDATE response_teams SET team_status='AVAILABLE' WHERE team_id=$1", [readyTeamRow.rows[0].team_id]);
    await client.query("UPDATE vehicles SET vehicle_status='AVAILABLE' WHERE vehicle_id=$1", [readyVehicleRow.rows[0].vehicle_id]);
  }

  const incidentEventTemplates = [
    ["INCIDENT_REPORTED", "Incident reported and queued for triage"],
    ["INCIDENT_TRIAGED", "Incident triaged by hospital operations"],
    ["SEVERITY_UPDATED", "Severity and priority reassessed"],
    ["STATUS_CHANGED", "Operational status updated"],
    ["RESOURCE_REQUESTED", "Medical supply request entered"],
    ["RESOURCE_ALLOCATED", "Resource allocation confirmed"],
    ["TEAM_ASSIGNED", "Assigned to response team"],
    ["VEHICLE_ASSIGNED", "Vehicle assigned for transport"],
    ["DISPATCH_CREATED", "Dispatch record created"],
    ["TEAM_DISPATCHED", "Team departed for incident"],
    ["TEAM_ARRIVED", "Team reached the incident site"],
    ["BED_ASSIGNED", "Bed assigned for care"],
    ["INCIDENT_RESOLVED", "Incident resolved and patient care cycle closed"],
  ];

  const eventsToCreate = [];
  for (const [incidentSummary, incidentId] of [...incidentIdsBySummary.entries()]) {
    const actorCandidates = [...staffIdMap.values()];
    let eventCounter = 0;
    for (const [eventType, label] of incidentEventTemplates) {
      const actorUserId = actorCandidates[(eventCounter + incidentId) % actorCandidates.length];
      const timestamp = new Date(Date.now() - (incidentId % 14) * 60 * 60 * 1000 - eventCounter * 25 * 60 * 1000);
      eventsToCreate.push({ eventId: randomUUID(), incidentId, eventType, occurredAt: timestamp, actorUserId, summary: `${label} for ${incidentSummary}`, details: { incidentSummary, source: "sera" } });
      eventCounter += 1;
    }
  }

  for (const event of eventsToCreate) {
    await client.query("INSERT INTO event_outbox(event_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'incident',$2,$3,$4::jsonb) ON CONFLICT(event_id) DO NOTHING", [event.eventId, event.incidentId, event.eventType, JSON.stringify({ incidentId: event.incidentId, actorUserId: event.actorUserId, source: "sera", summary: event.summary, details: event.details })]);
  }

  await client.query("INSERT INTO demo_seed_runs(seed_name,seed_version) VALUES($1,$2) ON CONFLICT(seed_name) DO UPDATE SET seed_version=EXCLUDED.seed_version", [DEMO_SEED_NAME, DEMO_SEED_VERSION]);
  await client.query("COMMIT");

  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB_NAME ?? "emergency_ops");
  const collection = db.collection("incident_events");
  await collection.createIndex({ eventId: 1 }, { unique: true });
  await collection.createIndex({ incidentId: 1, occurredAt: -1 });
  await publishBatch({ pool, collection, batchSize: 250 });
  console.log(`Demo seed ${DEMO_SEED_VERSION} applied; created hospitals, staff, incidents, beds, teams, vehicles, and event records.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await mongo.close().catch(() => {});
  client.release();
  await pool.end();
}
