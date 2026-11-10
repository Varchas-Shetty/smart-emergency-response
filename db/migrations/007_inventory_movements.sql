CREATE TABLE inventory_movements (
  movement_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id integer NOT NULL REFERENCES resource_inventory(inventory_id) ON DELETE RESTRICT,
  actor_user_id integer NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('RECEIVED','ADJUSTED')),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_movements_history_idx
  ON inventory_movements(inventory_id, created_at DESC);
