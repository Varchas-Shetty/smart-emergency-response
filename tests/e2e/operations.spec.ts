import { test, expect, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import { MongoClient } from "mongodb";

loadEnvConfig(process.cwd());
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now().toString(36).toUpperCase()}`;
const hospitalCode = `E2E-${suffix}`;
const hospitalName = `E2E Synthetic Hospital ${suffix}`;
const reportDescription = `E2E synthetic report ${suffix}`;
const resourceName = `E2E kit ${suffix}`;
const teamName = `E2E response ${suffix}`;
const vehicleRegistration = `E2E-${suffix}`;
const staffUsername = `e2e-staff-${suffix.toLowerCase()}`;
const staffPassword = `E2E-Local-${suffix}-safe`;

async function waitFor<T>(read: () => Promise<T | undefined>, message: string): Promise<T> {
  for (let attempt=0;attempt<30;attempt++) { const value=await read(); if(value!==undefined)return value; await new Promise((resolve)=>setTimeout(resolve,250)); }
  throw new Error(message);
}

async function cleanup() {
  const hospital = await pool.query("SELECT hospital_id,location_id FROM hospitals WHERE hospital_code=$1",[hospitalCode]);
  if (!hospital.rowCount) return;
  const hospitalId = hospital.rows[0].hospital_id;
  const incident = await pool.query("SELECT incident_id,location_id FROM emergency_incidents WHERE summary=$1",[reportDescription]);
  const reportLocations = await pool.query("SELECT location_id FROM citizen_reports WHERE description=$1",[reportDescription]);
  const incidentIds = incident.rows.map((r)=>r.incident_id);
  if(incidentIds.length){
    const docs=new MongoClient(process.env.MONGODB_URI!);try{await docs.connect();await docs.db(process.env.MONGODB_DB_NAME??"emergency_ops").collection("incident_events").deleteMany({incidentId:{$in:incidentIds}})}finally{await docs.close()}
    await pool.query("DELETE FROM bed_assignments WHERE incident_id=ANY($1::int[])",[incidentIds]);
    await pool.query("DELETE FROM resource_allocations WHERE incident_id=ANY($1::int[])",[incidentIds]);
    await pool.query("DELETE FROM dispatches WHERE incident_id=ANY($1::int[])",[incidentIds]);
    await pool.query("DELETE FROM incident_status_history WHERE incident_id=ANY($1::int[])",[incidentIds]);
    await pool.query("DELETE FROM event_outbox WHERE aggregate_id=ANY($1::int[])",[incidentIds]);
  }
  await pool.query("DELETE FROM citizen_reports WHERE description=$1",[reportDescription]);
  await pool.query("DELETE FROM emergency_incidents WHERE summary=$1",[reportDescription]);
  const inventory=await pool.query("SELECT inventory_id FROM resource_inventory WHERE hospital_id=$1",[hospitalId]);const inventoryIds=inventory.rows.map(r=>r.inventory_id);
  if(inventoryIds.length){await pool.query("DELETE FROM inventory_movements WHERE inventory_id=ANY($1::int[])",[inventoryIds]);await pool.query("DELETE FROM resource_allocations WHERE inventory_id=ANY($1::int[])",[inventoryIds]);await pool.query("DELETE FROM resource_inventory WHERE inventory_id=ANY($1::int[])",[inventoryIds]);}
  await pool.query("DELETE FROM team_members WHERE team_id IN (SELECT team_id FROM response_teams WHERE hospital_id=$1)",[hospitalId]);
  await pool.query("DELETE FROM hospital_beds WHERE hospital_id=$1",[hospitalId]);
  await pool.query("DELETE FROM dispatches WHERE hospital_id=$1",[hospitalId]);
  await pool.query("DELETE FROM response_teams WHERE hospital_id=$1",[hospitalId]);
  await pool.query("DELETE FROM vehicles WHERE hospital_id=$1",[hospitalId]);
  await pool.query("DELETE FROM users WHERE username=$1",[staffUsername]);
  await pool.query("DELETE FROM hospitals WHERE hospital_id=$1",[hospitalId]);
  const locations=incident.rows.map(r=>r.location_id).filter(Boolean);if(locations.length)await pool.query("DELETE FROM locations WHERE location_id=ANY($1::int[])",[locations]);
  if(reportLocations.rowCount)await pool.query("DELETE FROM locations WHERE location_id=$1",[reportLocations.rows[0].location_id]);
  await pool.query("DELETE FROM locations WHERE location_id=$1",[hospital.rows[0].location_id]);
  await pool.query("DELETE FROM resource_types WHERE resource_name=$1",[resourceName]);
}

async function login(page:Page){await page.goto("/login");await page.getByLabel("Username").fill(process.env.BOOTSTRAP_ADMIN_USERNAME!);await page.getByLabel("Password").fill(process.env.BOOTSTRAP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"Sign in"}).click();await expect(page).toHaveURL(/dashboard/);}

test("admin manages hospital operations and completes a report-to-dispatch workflow",async({page,browser})=>{
  test.setTimeout(120_000);
  try{
    await login(page);
    await page.goto("/hospitals");
    const hospitalForm=page.locator("form").filter({has:page.getByRole("heading",{name:"Register hospital"})});
    await hospitalForm.getByLabel("Hospital code").fill(hospitalCode);await hospitalForm.getByLabel("Hospital name").fill(hospitalName);await hospitalForm.getByLabel("Address").fill("100 Synthetic Avenue");await hospitalForm.getByLabel("Locality").fill("Test District");await hospitalForm.getByRole("button",{name:"Save"}).click();await expect(hospitalForm.getByRole("status")).toHaveText("Saved.");
    const hospitalId=await waitFor(async()=>{const r=await pool.query("SELECT hospital_id FROM hospitals WHERE hospital_code=$1",[hospitalCode]);return r.rows[0]?.hospital_id},"hospital creation did not reach PostgreSQL");

    await page.goto(`/hospitals/${hospitalId}`);const editHospital=page.locator("form").filter({has:page.getByRole("heading",{name:"Edit hospital details and activation"})});await editHospital.getByLabel("Phone").fill("555-0102");await editHospital.getByRole("button",{name:"Save hospital"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT phone FROM hospitals WHERE hospital_id=$1",[hospitalId]);return r.rows[0]?.phone}).toBe("555-0102");

    await page.goto("/beds");const bedForm=page.locator("form").filter({has:page.getByRole("heading",{name:"Add a hospital bed"})});await bedForm.getByLabel("Hospital").selectOption(String(hospitalId));await bedForm.getByLabel("Bed code").fill(`BED-${suffix}`);await bedForm.getByLabel("Bed type").fill("CRITICAL");await bedForm.getByRole("button",{name:"Save"}).click();await expect(bedForm.getByRole("status")).toHaveText("Saved.");
    const bedId=await waitFor(async()=>{const r=await pool.query("SELECT bed_id FROM hospital_beds WHERE hospital_id=$1 AND bed_code=$2",[hospitalId,`BED-${suffix}`]);return r.rows[0]?.bed_id},"bed creation did not reach PostgreSQL");

    await page.goto("/resources");let form=page.locator("form").filter({has:page.getByRole("heading",{name:"Add resource to catalog"})});await form.getByLabel("Resource name").fill(resourceName);await form.getByLabel("Unit").fill("kit");await form.getByRole("button",{name:"Save"}).click();await expect(form.getByRole("status")).toHaveText("Saved.");
    const resourceTypeId=await waitFor(async()=>{const r=await pool.query("SELECT resource_type_id FROM resource_types WHERE resource_name=$1",[resourceName]);return r.rows[0]?.resource_type_id},"resource catalog entry did not reach PostgreSQL");
    form=page.locator("form").filter({has:page.getByRole("heading",{name:"Receive stock"})});await form.getByLabel("Hospital").selectOption(String(hospitalId));await form.getByLabel("Catalog item").selectOption(String(resourceTypeId));await form.getByLabel("Quantity received").fill("12");await form.getByLabel("Receipt note").fill("Synthetic test receipt");await form.getByRole("button",{name:"Save"}).click();await expect(form.getByRole("status")).toHaveText("Saved.");
    const inventoryId=await waitFor(async()=>{const r=await pool.query("SELECT inventory_id FROM resource_inventory WHERE hospital_id=$1 AND resource_type_id=$2",[hospitalId,resourceTypeId]);return r.rows[0]?.inventory_id},"stock receipt did not reach PostgreSQL");

    await page.goto("/teams");form=page.locator("form").filter({has:page.getByRole("heading",{name:"Create response team"})});await form.getByLabel("Team name").fill(teamName);await form.getByLabel("Home hospital").selectOption(String(hospitalId));await form.getByRole("button",{name:"Save"}).click();await expect(form.getByRole("status")).toHaveText("Saved.");
    const teamId=await waitFor(async()=>{const r=await pool.query("SELECT team_id FROM response_teams WHERE hospital_id=$1 AND team_name=$2",[hospitalId,teamName]);return r.rows[0]?.team_id},"team creation did not reach PostgreSQL");

    await page.goto("/admin/users");form=page.locator("form").filter({has:page.getByRole("heading",{name:"Create an account"})});await form.getByLabel("Username").fill(staffUsername);await form.getByLabel("Email").fill(`${staffUsername}@example.invalid`);await form.getByLabel("Temporary password").fill(staffPassword);await form.getByLabel("Role").selectOption("HOSPITAL_STAFF");await form.getByLabel("Hospital (required for hospital staff)").selectOption(String(hospitalId));await form.getByRole("button",{name:"Create user"}).click();await expect(form.getByRole("status")).toContainText(`${staffUsername} created.`);
    const staffId=(await pool.query("SELECT user_id FROM users WHERE username=$1",[staffUsername])).rows[0].user_id;
    await page.goto("/teams");const teamRow=page.getByRole("row").filter({hasText:teamName});await teamRow.locator("select").last().selectOption(String(staffId));await teamRow.getByPlaceholder("Role").fill("Responder");await teamRow.getByRole("button",{name:"Add member"}).click();await expect(teamRow).toContainText(staffUsername);

    await page.goto("/vehicles");form=page.locator("form").filter({has:page.getByRole("heading",{name:"Register vehicle"})});await form.getByLabel("Registration number").fill(vehicleRegistration);await form.getByLabel("Vehicle type").fill("AMBULANCE");await form.getByLabel("Home hospital").selectOption(String(hospitalId));await form.getByRole("button",{name:"Save"}).click();await expect(form.getByRole("status")).toHaveText("Saved.");
    const vehicleId=(await pool.query("SELECT vehicle_id FROM vehicles WHERE registration_number=$1",[vehicleRegistration])).rows[0].vehicle_id;

    await page.goto("/reports");form=page.locator("form").filter({has:page.getByRole("heading",{name:"Submit an emergency report"})});await form.getByLabel("Receiving hospital").selectOption(String(hospitalId));await form.getByLabel("Description").fill(reportDescription);await form.getByLabel("Address").fill("200 Synthetic Avenue");await form.getByLabel("Locality").fill("Test District");await form.getByLabel("Latitude").fill("1");await form.getByLabel("Longitude").fill("1");await form.getByRole("button",{name:"Submit report"}).click();await expect(form.getByRole("status")).toContainText("received");
    const reportId=await waitFor(async()=>{const r=await pool.query("SELECT report_id FROM citizen_reports WHERE description=$1",[reportDescription]);return r.rows[0]?.report_id},"report submission did not reach PostgreSQL");
    await page.reload();let reportRow=page.getByRole("row").filter({hasText:reportDescription});await reportRow.getByRole("button",{name:"Review"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT report_status FROM citizen_reports WHERE report_id=$1",[reportId]);return r.rows[0]?.report_status}).toBe("REVIEWED");await page.reload();reportRow=page.getByRole("row").filter({hasText:reportDescription});await reportRow.getByRole("button",{name:"Create incident"}).click();
    const incidentId=await waitFor(async()=>{const r=await pool.query("SELECT incident_id FROM emergency_incidents WHERE summary=$1",[reportDescription]);return r.rows[0]?.incident_id},"report conversion did not create an incident");

    await page.goto("/resources");const stockRow=page.getByRole("row").filter({hasText:resourceName}).first();await stockRow.locator("select[name=incidentId]").selectOption(String(incidentId));await stockRow.locator("input[name=quantity]").fill("2");await stockRow.getByRole("button",{name:"Reserve"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT quantity_reserved FROM resource_inventory WHERE inventory_id=$1",[inventoryId]);return r.rows[0]?.quantity_reserved}).toBe(2);
    await page.reload();const allocationRow=page.getByRole("row").filter({hasText:resourceName}).filter({hasText:`${incidentId}`});await allocationRow.getByRole("button",{name:"Consume"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT allocation_status FROM resource_allocations WHERE incident_id=$1 AND inventory_id=$2 ORDER BY allocation_id DESC LIMIT 1",[incidentId,inventoryId]);return r.rows[0]?.allocation_status}).toBe("CONSUMED");

    await page.goto("/dispatch");form=page.locator("form").filter({has:page.getByRole("heading",{name:"Create dispatch"})});await form.getByLabel("Incident").selectOption(String(incidentId));await form.getByLabel("Available team").selectOption(String(teamId));await form.getByLabel("Available vehicle").selectOption(String(vehicleId));await form.getByLabel("Optional bed").selectOption(String(bedId));await form.getByRole("button",{name:"Queue dispatch"}).click();
    const dispatchId=await waitFor(async()=>{const r=await pool.query("SELECT dispatch_id FROM dispatches WHERE incident_id=$1 ORDER BY dispatch_id DESC LIMIT 1",[incidentId]);return r.rows[0]?.dispatch_id},"dispatch creation did not reach PostgreSQL");
    const dispatchRow=page.getByRole("row").filter({hasText:String(incidentId)});for(const status of ["DISPATCHED","EN ROUTE","ON SCENE","COMPLETED"]){await dispatchRow.getByRole("button",{name:status}).click();await expect.poll(async()=>{const r=await pool.query("SELECT dispatch_status FROM dispatches WHERE dispatch_id=$1",[dispatchId]);return r.rows[0]?.dispatch_status}).toBe(status.replaceAll(" ","_"));}
    await expect.poll(async()=>{const r=await pool.query("SELECT bed_status FROM hospital_beds WHERE bed_id=$1",[bedId]);return r.rows[0]?.bed_status}).toBe("AVAILABLE");

    await page.goto(`/incidents/${incidentId}`);for(const status of ["VALIDATED","PRIORITIZED","ASSIGNED","IN_PROGRESS","RESOLVED"]){await page.getByLabel("Advance status").selectOption(status);if(status==="VALIDATED"){await page.getByLabel("Severity").selectOption("CRITICAL");await page.getByLabel("Priority").fill("90");}await page.getByRole("button",{name:"Save incident update"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT incident_status FROM emergency_incidents WHERE incident_id=$1",[incidentId]);return r.rows[0]?.incident_status}).toBe(status);if(status!=="RESOLVED")await page.reload();}

    await page.goto(`/beds/${bedId}`);await expect(page.getByRole("heading",{name:"Assignment history"})).toBeVisible();await expect(page.getByRole("table")).toContainText("RELEASED");

    await page.goto("/admin/outbox");const publishButton=page.getByRole("button",{name:"Publish pending batch"});for(let batch=0;batch<10;batch++){await publishButton.click();await expect(page.getByRole("status")).toContainText("Published");const pending=await pool.query("SELECT count(*)::int AS count FROM event_outbox WHERE aggregate_id=$1 AND outbox_status='PENDING'",[incidentId]);if(pending.rows[0].count===0)break;}
    await page.goto(`/incidents/${incidentId}`);const timelineHeading=page.getByRole("heading",{name:"MongoDB activity timeline"});await expect(timelineHeading).toBeVisible();await expect(page.getByRole("table").last()).toContainText("DISPATCH_COMPLETED");
    const staffContext=await browser.newContext();try{const staffPage=await staffContext.newPage();await staffPage.goto("/login");await staffPage.getByLabel("Username").fill(staffUsername);await staffPage.getByLabel("Password").fill(staffPassword);await staffPage.getByRole("button",{name:"Sign in"}).click();await expect(staffPage).toHaveURL(/dashboard/);await staffPage.goto("/hospitals");await expect(staffPage.getByRole("table")).toContainText(hospitalName);await staffPage.goto("/admin/users");await expect(staffPage.getByText("This page could not be found.")).toBeVisible();}finally{await staffContext.close();}

    await page.goto(`/hospitals/${hospitalId}`);const activation=page.locator("form").filter({has:page.getByRole("heading",{name:"Edit hospital details and activation"})});await activation.getByLabel("Hospital active").uncheck();await activation.getByRole("button",{name:"Save hospital"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT is_active FROM hospitals WHERE hospital_id=$1",[hospitalId]);return r.rows[0]?.is_active}).toBe(false);await activation.getByLabel("Hospital active").check();await activation.getByRole("button",{name:"Save hospital"}).click();await expect.poll(async()=>{const r=await pool.query("SELECT is_active FROM hospitals WHERE hospital_id=$1",[hospitalId]);return r.rows[0]?.is_active}).toBe(true);
  }finally{try{await cleanup()}finally{await pool.end()}}
});
