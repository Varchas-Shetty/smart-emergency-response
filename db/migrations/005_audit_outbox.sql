CREATE TABLE event_outbox(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregate_type text NOT NULL,aggregate_id integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,outbox_status text NOT NULL DEFAULT 'PENDING' CHECK(outbox_status IN ('PENDING','PUBLISHED','FAILED')),attempt_count integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),locked_at timestamptz,published_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON event_outbox(available_at,created_at) WHERE outbox_status='PENDING';
CREATE FUNCTION record_incident_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;
BEGIN
 IF TG_OP='INSERT' THEN
   actor := NULLIF(current_setting('app.actor_user_id',true),'')::integer;
   IF actor IS NULL THEN RAISE EXCEPTION 'actor context required'; END IF;
   INSERT INTO incident_status_history(incident_id,old_status,new_status,actor_user_id) VALUES(NEW.incident_id,NULL,NEW.incident_status,actor);
 ELSIF OLD.incident_status IS DISTINCT FROM NEW.incident_status THEN
   actor := NULLIF(current_setting('app.actor_user_id',true),'')::integer;
   IF actor IS NULL THEN RAISE EXCEPTION 'actor context required'; END IF;
   INSERT INTO incident_status_history(incident_id,old_status,new_status,actor_user_id) VALUES(NEW.incident_id,OLD.incident_status,NEW.incident_status,actor);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incident_status_audit AFTER INSERT OR UPDATE ON emergency_incidents FOR EACH ROW EXECUTE FUNCTION record_incident_status();
