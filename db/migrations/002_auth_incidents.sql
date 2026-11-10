CREATE TABLE sessions (
 session_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE incident_types (
 incident_type_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 type_name text NOT NULL UNIQUE,
 description text,
 is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE emergency_incidents (
 incident_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hospital_id integer REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
 incident_type_id integer NOT NULL REFERENCES incident_types(incident_type_id),
 reported_by_user_id integer NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
 location_id integer NOT NULL REFERENCES locations(location_id),
 summary text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 severity text NOT NULL CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
 priority_score integer NOT NULL DEFAULT 0 CHECK (priority_score BETWEEN 0 AND 100),
 incident_status text NOT NULL DEFAULT 'NEW' CHECK (incident_status IN ('NEW','VALIDATED','PRIORITIZED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_hospital_status_idx ON emergency_incidents(hospital_id,incident_status,created_at DESC);
CREATE TABLE citizen_reports (
 report_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hospital_id integer NOT NULL REFERENCES hospitals(hospital_id),
 reported_by_user_id integer NOT NULL REFERENCES users(user_id),
 incident_type_id integer NOT NULL REFERENCES incident_types(incident_type_id),
 location_id integer NOT NULL REFERENCES locations(location_id),
 description text NOT NULL,
 reported_at timestamptz NOT NULL DEFAULT now(),
 report_status text NOT NULL DEFAULT 'RECEIVED' CHECK(report_status IN ('RECEIVED','REVIEWED','CONVERTED','REJECTED','CLOSED')),
 incident_id integer REFERENCES emergency_incidents(incident_id) ON DELETE RESTRICT
);
CREATE TABLE incident_status_history (
 history_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 incident_id integer NOT NULL REFERENCES emergency_incidents(incident_id) ON DELETE RESTRICT,
 old_status text, new_status text NOT NULL,
 actor_user_id integer NOT NULL REFERENCES users(user_id), note text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO incident_types(type_name,description) VALUES ('Medical emergency','General medical emergency'),('Fire','Fire or smoke emergency'),('Infrastructure','Critical infrastructure failure') ON CONFLICT DO NOTHING;
