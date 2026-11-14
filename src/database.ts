import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";

export interface SqlClient {
  exec(sql: string): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}
export interface Database extends SqlClient {
  kind: "embedded" | "postgres";
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function embeddedDatabase(path: string): Promise<Database> {
  const db = await PGlite.create(path);
  return {
    kind: "embedded",
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: (sql, values) => db.query(sql, values),
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: (sql, values) => tx.query(sql, values),
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    close: () => db.close(),
  };
}
export function postgresDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 1000,
    statement_timeout: 3000,
    lock_timeout: 2000,
  });
  pool.on("error", () => {
    console.error("An idle PostgreSQL connection failed.");
  });
  const clientQueries = (client: PoolClient): SqlClient => ({
    exec: async (sql) => {
      await client.query(sql);
    },
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      const result = await client.query<Row>(sql, values);
      return { rows: result.rows ?? [] };
    },
  });
  return {
    kind: "postgres",
    exec: async (sql) => {
      await pool.query(sql);
    },
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      const result = await pool.query<Row>(sql, values);
      return { rows: result.rows ?? [] };
    },
    async transaction<T>(work: (client: SqlClient) => Promise<T>) {
      const client = await pool.connect();
      let releaseError: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await work(clientQueries(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          releaseError = new Error("Discard failed transaction connection.");
        }
        throw error;
      } finally {
        client.release(releaseError);
      }
    },
    close: () => pool.end(),
  };
}
