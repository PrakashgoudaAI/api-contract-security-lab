CREATE TABLE IF NOT EXISTS inventory (
  tenant TEXT NOT NULL CHECK (tenant IN ('alpha', 'beta')),
  sku TEXT NOT NULL, available INTEGER NOT NULL CHECK (available >= 0),
  PRIMARY KEY (tenant, sku)
);
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY, tenant TEXT NOT NULL,
  request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  created_at TEXT NOT NULL, UNIQUE (tenant, request_key),
  FOREIGN KEY (tenant, sku) REFERENCES inventory (tenant, sku)
);
INSERT INTO inventory (tenant, sku, available) VALUES
  ('alpha', 'camera-kit', 5), ('beta', 'camera-kit', 5)
  ON CONFLICT DO NOTHING;
