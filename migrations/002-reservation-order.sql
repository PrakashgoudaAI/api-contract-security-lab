CREATE INDEX IF NOT EXISTS reservations_tenant_created_idx
ON reservations (tenant, created_at, id);
