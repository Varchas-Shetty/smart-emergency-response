import "server-only";

import { getPostgresPool } from "@/db/postgres";

export async function runPostgresDbmsDemo() {
  const pool = getPostgresPool();
  const activeDispatchStatuses = ["QUEUED", "DISPATCHED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"];

  const [
    availableBeds,
    hospitalsWithMostBeds,
    incidentsBySeverity,
    incidentsWithoutDispatch,
    resourceUtilization,
    dispatchHistory,
    correlatedDispatchCounts,
    incidentOperations,
    hospitalCapacity,
    explainAvailableIncidents,
    incident,
  ] = await Promise.all([
    pool.query(
      `SELECT b.bed_id,b.bed_code,b.bed_type,h.hospital_id,h.hospital_name
       FROM hospital_beds b
       INNER JOIN hospitals h ON h.hospital_id=b.hospital_id
       WHERE b.bed_status=$1 AND h.is_active=$2
       ORDER BY h.hospital_name,b.bed_code
       LIMIT $3`,
      ["AVAILABLE", true, 10],
    ),
    pool.query(
      `WITH hospital_availability AS (
         SELECT h.hospital_id,h.hospital_name,
                COUNT(b.bed_id) FILTER (WHERE b.bed_status=$1)::int AS available_beds
         FROM hospitals h
         LEFT JOIN hospital_beds b ON b.hospital_id=h.hospital_id
         WHERE h.is_active=$2
         GROUP BY h.hospital_id,h.hospital_name
       )
       SELECT hospital_id,hospital_name,available_beds
       FROM hospital_availability
       WHERE available_beds=(SELECT MAX(available_beds) FROM hospital_availability)
       ORDER BY hospital_name`,
      ["AVAILABLE", true],
    ),
    pool.query(
      `SELECT severity,COUNT(*)::int AS incident_count,
              AVG(priority_score)::numeric(5,2) AS average_priority,
              MIN(occurred_at) AS first_reported,MAX(occurred_at) AS most_recent,
              CASE severity WHEN 'CRITICAL' THEN 'Immediate response'
                            WHEN 'HIGH' THEN 'Urgent response'
                            ELSE 'Standard review' END AS response_band
       FROM emergency_incidents
       GROUP BY severity
       HAVING COUNT(*) > $1
       ORDER BY COUNT(*) DESC,severity`,
      [0],
    ),
    pool.query(
      `SELECT i.incident_id,i.summary,i.severity,i.incident_status
       FROM emergency_incidents i
       WHERE NOT EXISTS (
         SELECT 1 FROM dispatches d WHERE d.incident_id=i.incident_id
       )
       ORDER BY i.created_at DESC
       LIMIT $1`,
      [10],
    ),
    pool.query(
      `SELECT h.hospital_id,h.hospital_name,rt.resource_type_id,rt.resource_name,
              SUM(ri.quantity_on_hand)::int AS units_on_hand,
              SUM(ri.quantity_reserved)::int AS units_reserved,
              AVG(ri.quantity_reserved::numeric/NULLIF(ri.quantity_on_hand,0))::numeric(8,4) AS average_reserved_ratio,
              MIN(ri.quantity_on_hand)::int AS minimum_stock,
              MAX(ri.quantity_on_hand)::int AS maximum_stock
       FROM resource_inventory ri
       INNER JOIN hospitals h ON h.hospital_id=ri.hospital_id
       INNER JOIN resource_types rt ON rt.resource_type_id=ri.resource_type_id
       GROUP BY h.hospital_id,h.hospital_name,rt.resource_type_id,rt.resource_name
       HAVING SUM(ri.quantity_on_hand) > $1
       ORDER BY h.hospital_name,rt.resource_name
       LIMIT $2`,
      [0, 20],
    ),
    pool.query(
      `SELECT d.dispatch_id,d.dispatch_status,d.created_at,i.incident_id,i.summary,
              t.team_name,v.registration_number,h.hospital_name
       FROM dispatches d
       INNER JOIN emergency_incidents i ON i.incident_id=d.incident_id
       INNER JOIN response_teams t ON t.team_id=d.team_id
       INNER JOIN vehicles v ON v.vehicle_id=d.vehicle_id
       LEFT JOIN hospitals h ON h.hospital_id=d.hospital_id
       ORDER BY d.created_at DESC
       LIMIT $1`,
      [20],
    ),
    pool.query(
      `SELECT i.incident_id,i.summary,
              (SELECT COUNT(*)::int
               FROM dispatches d
               WHERE d.incident_id=i.incident_id
                 AND d.dispatch_status=ANY($1::text[])) AS active_dispatch_count
       FROM emergency_incidents i
       WHERE EXISTS (
         SELECT 1 FROM dispatches history WHERE history.incident_id=i.incident_id
       )
       ORDER BY i.created_at DESC
       LIMIT $2`,
      [activeDispatchStatuses, 10],
    ),
    pool.query("SELECT * FROM incident_operations_view ORDER BY occurred_at DESC LIMIT $1", [10]),
    pool.query("SELECT * FROM hospital_capacity_view ORDER BY available_beds DESC,hospital_name LIMIT $1", [10]),
    pool.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
       SELECT incident_id
       FROM emergency_incidents
       WHERE incident_status=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      ["NEW", 10],
    ),
    pool.query("SELECT incident_id FROM emergency_incidents ORDER BY created_at DESC LIMIT $1", [1]),
  ]);

  const incidentId = incident.rows[0]?.incident_id;
  if (incidentId === undefined) {
    throw new Error("The DBMS demo requires at least one incident in PostgreSQL.");
  }

  return {
    incidentId,
    availableBeds: availableBeds.rows,
    hospitalsWithMostAvailableBeds: hospitalsWithMostBeds.rows,
    incidentsBySeverity: incidentsBySeverity.rows,
    incidentsWithoutDispatch: incidentsWithoutDispatch.rows,
    resourceUtilization: resourceUtilization.rows,
    dispatchHistory: dispatchHistory.rows,
    correlatedDispatchCounts: correlatedDispatchCounts.rows,
    incidentOperationsView: incidentOperations.rows,
    hospitalCapacityView: hospitalCapacity.rows,
    explainAvailableIncidents: explainAvailableIncidents.rows,
  };
}
