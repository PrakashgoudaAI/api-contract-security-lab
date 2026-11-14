import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { openapi } from "../contracts/openapi.ts";
import {
  validInput,
  validReservation,
  validSession,
} from "../contracts/schemas.ts";
import { Sessions } from "./auth.ts";
import { Problem } from "./problem.ts";
import type { ReservationStore } from "./store.ts";

async function body(req: IncomingMessage): Promise<unknown> {
  if (
    req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new Problem(415, "Use application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > 8192) {
      req.resume();
      throw new Problem(413, "Body exceeds 8 KiB.");
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Problem(400, "Use valid JSON.");
  }
}
function send(res: ServerResponse, status: number, value?: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
function pageNumber(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > max)
    throw new Problem(400, "Invalid pagination.");
  return Number(value);
}
export function createApp(
  store: ReservationStore,
  sessions = new Sessions(),
  options: {
    authenticate?: (
      header: string | undefined,
    ) => Promise<{ tenant: "alpha" | "beta"; role: "editor" | "viewer" }>;
  } = {},
) {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.setTimeout(5000, (socket) => socket.destroy());
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";
      if (method === "GET" && path === "/health") {
        send(res, 200, { status: "ok" });
        return;
      }
      if (method === "GET" && path === "/openapi.json") {
        send(res, 200, openapi);
        return;
      }
      if (["POST", "DELETE"].includes(method) && req.headers.origin) {
        const address = server.address();
        const origin =
          typeof address === "object" && address
            ? "http://127.0.0.1:" + address.port
            : "";
        if (req.headers.origin !== origin)
          throw new Problem(403, "Foreign browser origin denied.");
      }
      if (method === "POST" && path === "/sessions") {
        if (options.authenticate)
          throw new Problem(
            405,
            "Demo sessions are disabled in issuer-token mode.",
          );
        const data = await body(req);
        if (!validSession(data))
          throw new Problem(400, "Invalid session fields.");
        if (data.password !== "demo-only-password")
          throw new Problem(401, "Invalid demo credentials.");
        send(res, 201, {
          token: sessions.issue(data.tenant, data.role),
          expiresInSeconds: 900,
        });
        return;
      }
      const identity = options.authenticate
        ? await options.authenticate(req.headers.authorization)
        : sessions.authenticate(req.headers.authorization);
      if (method === "DELETE" && path === "/sessions") {
        if (options.authenticate)
          throw new Problem(
            405,
            "Token lifecycle belongs to the configured issuer.",
          );
        sessions.revoke(req.headers.authorization);
        send(res, 204);
        return;
      }
      if (method === "GET" && path === "/inventory") {
        send(res, 200, {
          sku: "camera-kit",
          available: await store.available(identity.tenant),
        });
        return;
      }
      if (path === "/reservations" && method === "POST") {
        if (identity.role !== "editor")
          throw new Problem(403, "Editor role required.");
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(key))
          throw new Problem(
            400,
            "Use an idempotency key of 16–80 safe characters.",
          );
        const data = await body(req);
        if (!validInput(data))
          throw new Problem(400, "Invalid reservation fields.");
        const result = await store.create(identity.tenant, key, data);
        if (!validReservation(result.record))
          throw new Error("Stored record violates the response contract.");
        res.setHeader("Idempotent-Replay", String(result.replay));
        send(res, result.replay ? 200 : 201, result.record);
        return;
      }
      if (path === "/reservations" && method === "GET") {
        for (const key of url.searchParams.keys())
          if (
            !["page", "pageSize"].includes(key) ||
            url.searchParams.getAll(key).length !== 1
          )
            throw new Problem(
              400,
              "Unexpected or repeated pagination parameter.",
            );
        send(
          res,
          200,
          await store.list(
            identity.tenant,
            pageNumber(url.searchParams.get("page"), 1, 100),
            pageNumber(url.searchParams.get("pageSize"), 2, 10),
          ),
        );
        return;
      }
      const match =
        /^\/reservations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
          path,
        );
      if (method === "GET" && match) {
        send(res, 200, await store.get(identity.tenant, match[1]!));
        return;
      }
      if (
        ["/sessions", "/inventory", "/reservations"].includes(path) ||
        match
      ) {
        res.setHeader(
          "Allow",
          path === "/sessions"
            ? "POST, DELETE"
            : path === "/reservations"
              ? "GET, POST"
              : "GET",
        );
        throw new Problem(405, "Method not allowed.");
      }
      throw new Problem(404, "Not found.");
    } catch (error) {
      if (error instanceof Problem)
        send(res, error.status, { error: error.message });
      else {
        console.error("Internal reservation service failure.");
        send(res, 500, { error: "Internal service failure." });
      }
    }
  }
  return server;
}
