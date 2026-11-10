CREATE TABLE hospital_beds (
 bed_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hospital_id integer NOT NULL REFERENCES hospitals(hospital_id), bed_code text NOT NULL,
 bed_type text NOT NULL, bed_status text NOT NULL DEFAULT 'AVAILABLE' CHECK(bed_status IN ('AVAILABLE','RESERVED','OCCUPIED','OUT_OF_SERVICE')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hospital_id,bed_code)
);
CREATE TABLE resource_types(resource_type_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,resource_name text NOT NULL UNIQUE,unit text NOT NULL,description text);
CREATE TABLE resource_inventory(
 inventory_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,hospital_id integer NOT NULL REFERENCES hospitals(hospital_id),resource_type_id integer NOT NULL REFERENCES resource_types(resource_type_id),
 quantity_on_hand integer NOT NULL DEFAULT 0 CHECK(quantity_on_hand>=0),quantity_reserved integer NOT NULL DEFAULT 0 CHECK(quantity_reserved>=0 AND quantity_reserved<=quantity_on_hand),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(hospital_id,resource_type_id)
);
CREATE TABLE response_teams(team_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,hospital_id integer REFERENCES hospitals(hospital_id),team_name text NOT NULL,team_status text NOT NULL DEFAULT 'AVAILABLE' CHECK(team_status IN ('AVAILABLE','DISPATCHED','OFF_DUTY')),current_location_id integer REFERENCES locations(location_id));
CREATE TABLE team_members(team_member_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,team_id integer NOT NULL REFERENCES response_teams(team_id),user_id integer NOT NULL REFERENCES users(user_id),member_role text NOT NULL,joined_at timestamptz NOT NULL DEFAULT now(),left_at timestamptz);
CREATE UNIQUE INDEX team_member_active_unique ON team_members(team_id,user_id) WHERE left_at IS NULL;
CREATE TABLE vehicles(vehicle_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,hospital_id integer REFERENCES hospitals(hospital_id),registration_number text NOT NULL UNIQUE,vehicle_type text NOT NULL,vehicle_status text NOT NULL DEFAULT 'AVAILABLE' CHECK(vehicle_status IN ('AVAILABLE','DISPATCHED','MAINTENANCE')),current_location_id integer REFERENCES locations(location_id));
