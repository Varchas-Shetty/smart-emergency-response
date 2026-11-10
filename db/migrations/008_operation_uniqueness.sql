CREATE UNIQUE INDEX response_teams_hospital_name_unique
  ON response_teams (COALESCE(hospital_id, 0), lower(team_name));

CREATE INDEX dispatch_team_history_idx
  ON dispatches(team_id, created_at DESC);

CREATE INDEX dispatch_vehicle_history_idx
  ON dispatches(vehicle_id, created_at DESC);
