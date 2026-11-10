BEGIN;
CREATE TEMP TABLE sera_dbms_demo_records (
  demo_key text PRIMARY KEY,
  hospital_id integer NOT NULL,
  operational_status text NOT NULL,
  quantity integer NOT NULL
);
ALTER TABLE sera_dbms_demo_records ADD COLUMN note text;
INSERT INTO sera_dbms_demo_records (demo_key,hospital_id,operational_status,quantity,note)
SELECT 'rollback-' || hospital_id,hospital_id,'NEW',1,'This row is rolled back'
FROM hospitals
WHERE is_active=true
ORDER BY hospital_id
LIMIT 1;
UPDATE sera_dbms_demo_records SET quantity=quantity+1 WHERE operational_status='NEW';
SELECT * FROM sera_dbms_demo_records WHERE quantity > 0 ORDER BY demo_key;
ROLLBACK;

BEGIN;
CREATE TEMP TABLE sera_dbms_demo_records (
  demo_key text PRIMARY KEY,
  hospital_id integer NOT NULL,
  operational_status text NOT NULL,
  quantity integer NOT NULL
);
ALTER TABLE sera_dbms_demo_records ADD COLUMN note text;
INSERT INTO sera_dbms_demo_records (demo_key,hospital_id,operational_status,quantity,note)
SELECT 'committed-' || hospital_id,hospital_id,'NEW',1,'Disposable DBMS demonstration row'
FROM hospitals
WHERE is_active=true
ORDER BY hospital_id
LIMIT 2;
SELECT * FROM sera_dbms_demo_records WHERE operational_status='NEW' ORDER BY hospital_id;
UPDATE sera_dbms_demo_records SET operational_status='VALIDATED',quantity=quantity+1
WHERE demo_key=(SELECT MIN(demo_key) FROM sera_dbms_demo_records);
SELECT * FROM sera_dbms_demo_records ORDER BY demo_key;
DELETE FROM sera_dbms_demo_records
WHERE demo_key=(SELECT MAX(demo_key) FROM sera_dbms_demo_records);
SELECT * FROM sera_dbms_demo_records ORDER BY demo_key;
DROP TABLE pg_temp.sera_dbms_demo_records;
COMMIT;

SELECT b.bed_id,b.bed_code,b.bed_type,h.hospital_name
FROM hospital_beds b
INNER JOIN hospitals h ON h.hospital_id=b.hospital_id
WHERE b.bed_status='AVAILABLE' AND h.is_active=true
ORDER BY h.hospital_name,b.bed_code
LIMIT 10;

WITH hospital_availability AS (
  SELECT h.hospital_id,h.hospital_name,
         COUNT(b.bed_id) FILTER (WHERE b.bed_status='AVAILABLE')::int AS available_beds
  FROM hospitals h
  LEFT JOIN hospital_beds b ON b.hospital_id=h.hospital_id
  WHERE h.is_active=true
  GROUP BY h.hospital_id,h.hospital_name
)
SELECT hospital_id,hospital_name,available_beds
FROM hospital_availability
WHERE available_beds=(SELECT MAX(available_beds) FROM hospital_availability)
ORDER BY hospital_name;

SELECT severity,COUNT(*)::int AS incident_count,
       AVG(priority_score)::numeric(5,2) AS average_priority,
       MIN(occurred_at) AS first_reported,MAX(occurred_at) AS most_recent,
       CASE severity WHEN 'CRITICAL' THEN 'Immediate response'
                     WHEN 'HIGH' THEN 'Urgent response'
                     ELSE 'Standard review' END AS response_band
FROM emergency_incidents
GROUP BY severity
HAVING COUNT(*) > 0
ORDER BY COUNT(*) DESC,severity;

SELECT i.incident_id,i.summary,i.severity,i.incident_status
FROM emergency_incidents i
WHERE NOT EXISTS (
  SELECT 1 FROM dispatches d WHERE d.incident_id=i.incident_id
)
ORDER BY i.created_at DESC
LIMIT 10;

SELECT h.hospital_name,rt.resource_name,
       SUM(ri.quantity_on_hand)::int AS units_on_hand,
       SUM(ri.quantity_reserved)::int AS units_reserved,
       AVG(ri.quantity_reserved::numeric/NULLIF(ri.quantity_on_hand,0))::numeric(8,4) AS average_reserved_ratio,
       MIN(ri.quantity_on_hand)::int AS minimum_stock,
       MAX(ri.quantity_on_hand)::int AS maximum_stock
FROM resource_inventory ri
INNER JOIN hospitals h ON h.hospital_id=ri.hospital_id
INNER JOIN resource_types rt ON rt.resource_type_id=ri.resource_type_id
GROUP BY h.hospital_name,rt.resource_name
HAVING SUM(ri.quantity_on_hand) > 0
ORDER BY h.hospital_name,rt.resource_name
LIMIT 20;

SELECT d.dispatch_id,d.dispatch_status,d.created_at,i.summary,t.team_name,
       v.registration_number,h.hospital_name
FROM dispatches d
INNER JOIN emergency_incidents i ON i.incident_id=d.incident_id
INNER JOIN response_teams t ON t.team_id=d.team_id
INNER JOIN vehicles v ON v.vehicle_id=d.vehicle_id
LEFT JOIN hospitals h ON h.hospital_id=d.hospital_id
ORDER BY d.created_at DESC
LIMIT 20;

SELECT i.incident_id,i.summary,
       (SELECT COUNT(*)::int FROM dispatches d
        WHERE d.incident_id=i.incident_id
          AND d.dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING')) AS active_dispatch_count
FROM emergency_incidents i
WHERE EXISTS (SELECT 1 FROM dispatches history WHERE history.incident_id=i.incident_id)
ORDER BY i.created_at DESC
LIMIT 10;

SELECT * FROM incident_operations_view ORDER BY occurred_at DESC LIMIT 10;
SELECT * FROM hospital_capacity_view ORDER BY available_beds DESC,hospital_name LIMIT 10;

EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
SELECT incident_id FROM emergency_incidents
WHERE incident_status='NEW'
ORDER BY created_at DESC
LIMIT 10;
