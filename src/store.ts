import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type {
  Reservation,
  ReservationInput,
  Tenant,
} from "../contracts/schemas.ts";
import { Problem } from "./problem.ts";

export async function openStore(path: string) {
  const db = await PGlite.create(path);
  await db.exec(`
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
  `);
  return new ReservationStore(db);
}
const columns =
  'id::text AS id, tenant AS "tenantId", sku, quantity, created_at AS "createdAt"';
export class ReservationStore {
  private readonly db: PGlite;
  constructor(db: PGlite) {
    this.db = db;
  }
  async create(
    tenant: Tenant,
    key: string,
    input: ReservationInput,
  ): Promise<{ record: Reservation; replay: boolean }> {
    const fingerprint = JSON.stringify({
      sku: input.sku,
      quantity: input.quantity,
    });
    return this.db.transaction(async (tx) => {
      const existing = await tx.query<Reservation & { fingerprint: string }>(
        `SELECT ${columns}, fingerprint FROM reservations WHERE tenant=$1 AND request_key=$2`,
        [tenant, key],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Problem(
            409,
            "Request key belongs to a different reservation.",
          );
        const { fingerprint: _fingerprint, ...record } = prior;
        return { record, replay: true };
      }
      const stock = await tx.query(
        `UPDATE inventory SET available=available-$3 WHERE tenant=$1 AND sku=$2 AND available >= $3 RETURNING available`,
        [tenant, input.sku, input.quantity],
      );
      if (stock.rows.length !== 1)
        throw new Problem(409, "Insufficient inventory.");
      const created = await tx.query<Reservation>(
        `INSERT INTO reservations (id, tenant, request_key, fingerprint, sku, quantity, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,
        [
          randomUUID(),
          tenant,
          key,
          fingerprint,
          input.sku,
          input.quantity,
          new Date().toISOString(),
        ],
      );
      const record = created.rows[0];
      if (!record) throw new Error("Reservation insert returned no record.");
      return { record, replay: false };
    });
  }
  async get(tenant: Tenant, id: string): Promise<Reservation> {
    const result = await this.db.query<Reservation>(
      `SELECT ${columns} FROM reservations WHERE tenant=$1 AND id=$2`,
      [tenant, id],
    );
    if (!result.rows[0]) throw new Problem(404, "Reservation not found.");
    return result.rows[0];
  }
  async list(tenant: Tenant, page: number, pageSize: number) {
    return this.db.transaction(async (tx) => {
      const count = await tx.query<{ total: number }>(
        "SELECT count(*)::integer AS total FROM reservations WHERE tenant=$1",
        [tenant],
      );
      const total = count.rows[0]!.total;
      if (page > Math.max(1, Math.ceil(total / pageSize)))
        throw new Problem(400, "Page is outside the result set.");
      const result = await tx.query<Reservation>(
        `SELECT ${columns} FROM reservations WHERE tenant=$1 ORDER BY created_at, id LIMIT $2 OFFSET $3`,
        [tenant, pageSize, (page - 1) * pageSize],
      );
      return { items: result.rows, total, page, pageSize };
    });
  }
  async available(tenant: Tenant) {
    const result = await this.db.query<{ available: number }>(
      "SELECT available FROM inventory WHERE tenant=$1 AND sku=$2",
      [tenant, "camera-kit"],
    );
    return result.rows[0]!.available;
  }
  close() {
    return this.db.close();
  }
}
