CREATE VIEW incident_operations_view AS
 SELECT i.incident_id,i.hospital_id,h.hospital_name,t.type_name,i.summary,i.severity,i.priority_score,i.incident_status,i.occurred_at,
        count(DISTINCT d.dispatch_id) FILTER(WHERE d.dispatch_status NOT IN ('COMPLETED','CANCELLED')) AS active_dispatches
 FROM emergency_incidents i LEFT JOIN hospitals h USING(hospital_id) JOIN incident_types t USING(incident_type_id)
 LEFT JOIN dispatches d USING(incident_id) GROUP BY i.incident_id,h.hospital_name,t.type_name;
CREATE VIEW hospital_capacity_view AS
 SELECT h.hospital_id,h.hospital_name,count(b.bed_id) FILTER(WHERE b.bed_status='AVAILABLE') AS available_beds,count(b.bed_id) AS total_beds
 FROM hospitals h LEFT JOIN hospital_beds b USING(hospital_id) GROUP BY h.hospital_id,h.hospital_name;
