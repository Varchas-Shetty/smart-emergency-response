CREATE TABLE locations (
  location_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address text NOT NULL,
  locality text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (
  role_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name text NOT NULL UNIQUE CHECK (role_name IN ('ADMIN','HOSPITAL_STAFF')),
  description text
);
CREATE TABLE hospitals (
  hospital_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hospital_code text NOT NULL UNIQUE,
  hospital_name text NOT NULL,
  location_id integer NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  phone text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  user_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id integer NOT NULL REFERENCES roles(role_id),
  hospital_id integer REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION enforce_user_hospital_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role text;
BEGIN
 SELECT role_name INTO role FROM roles WHERE role_id=NEW.role_id;
 IF (role='ADMIN' AND NEW.hospital_id IS NOT NULL) OR (role='HOSPITAL_STAFF' AND NEW.hospital_id IS NULL) THEN
   RAISE EXCEPTION 'hospital assignment does not match user role';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER users_role_hospital_check AFTER INSERT OR UPDATE ON users DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION enforce_user_hospital_role();
INSERT INTO roles(role_name,description) VALUES ('ADMIN','System administrator'),('HOSPITAL_STAFF','Hospital operations staff');
