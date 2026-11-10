ALTER TABLE event_outbox
  ADD COLUMN last_attempt_at timestamptz;
