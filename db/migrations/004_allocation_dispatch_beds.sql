CREATE TABLE dispatches(
 dispatch_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,incident_id integer NOT NULL REFERENCES emergency_incidents(incident_id),team_id integer NOT NULL REFERENCES response_teams(team_id),vehicle_id integer NOT NULL REFERENCES vehicles(vehicle_id),created_by_user_id integer NOT NULL REFERENCES users(user_id),hospital_id integer REFERENCES hospitals(hospital_id),
 created_at timestamptz NOT NULL DEFAULT now(),dispatched_at timestamptz,arrived_at timestamptz,completed_at timestamptz,dispatch_status text NOT NULL DEFAULT 'QUEUED' CHECK(dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING','COMPLETED','CANCELLED'))
);
CREATE UNIQUE INDEX dispatch_active_team ON dispatches(team_id) WHERE dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING');
CREATE UNIQUE INDEX dispatch_active_vehicle ON dispatches(vehicle_id) WHERE dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING');
CREATE UNIQUE INDEX dispatch_active_incident ON dispatches(incident_id) WHERE dispatch_status IN ('QUEUED','DISPATCHED','EN_ROUTE','ON_SCENE','TRANSPORTING');
CREATE TABLE bed_assignments(
 bed_assignment_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,bed_id integer NOT NULL REFERENCES hospital_beds(bed_id),incident_id integer NOT NULL REFERENCES emergency_incidents(incident_id),dispatch_id integer REFERENCES dispatches(dispatch_id),assigned_by_user_id integer NOT NULL REFERENCES users(user_id),released_by_user_id integer REFERENCES users(user_id),assignment_status text NOT NULL DEFAULT 'RESERVED' CHECK(assignment_status IN ('RESERVED','OCCUPIED','RELEASED','CANCELLED')),reserved_at timestamptz NOT NULL DEFAULT now(),occupied_at timestamptz,released_at timestamptz,release_reason text
);
CREATE UNIQUE INDEX bed_one_active_assignment ON bed_assignments(bed_id) WHERE assignment_status IN ('RESERVED','OCCUPIED');
CREATE UNIQUE INDEX incident_one_active_bed ON bed_assignments(incident_id) WHERE assignment_status IN ('RESERVED','OCCUPIED');
CREATE TABLE resource_allocations(allocation_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,incident_id integer NOT NULL REFERENCES emergency_incidents(incident_id),inventory_id integer NOT NULL REFERENCES resource_inventory(inventory_id),allocated_by_user_id integer NOT NULL REFERENCES users(user_id),quantity integer NOT NULL CHECK(quantity>0),allocation_status text NOT NULL DEFAULT 'RESERVED' CHECK(allocation_status IN ('RESERVED','RELEASED','CONSUMED')),reserved_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz,consumed_at timestamptz);
CREATE FUNCTION reserve_inventory(p_inventory_id integer,p_incident_id integer,p_actor integer,p_quantity integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE inv resource_inventory%ROWTYPE; new_id integer;
BEGIN
 IF p_quantity<=0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
 SELECT * INTO inv FROM resource_inventory WHERE inventory_id=p_inventory_id FOR UPDATE;
 IF NOT FOUND OR inv.quantity_on_hand-inv.quantity_reserved<p_quantity THEN RAISE EXCEPTION 'insufficient inventory'; END IF;
 UPDATE resource_inventory SET quantity_reserved=quantity_reserved+p_quantity,updated_at=now() WHERE inventory_id=p_inventory_id;
 INSERT INTO resource_allocations(incident_id,inventory_id,allocated_by_user_id,quantity) VALUES(p_incident_id,p_inventory_id,p_actor,p_quantity) RETURNING allocation_id INTO new_id;
 RETURN new_id;
END $$;
