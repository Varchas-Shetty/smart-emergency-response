CREATE TABLE demo_seed_runs (
  seed_name text PRIMARY KEY,
  seed_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demo_seed_runs_created_at_idx
  ON demo_seed_runs(created_at DESC);
