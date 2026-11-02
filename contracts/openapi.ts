import {
  problem,
  reservation,
  reservationInput,
  sessionInput,
} from "./schemas.ts";
const json = (schema: object) => ({
  content: { "application/json": { schema } },
});
const response = (description: string, schema: object) => ({
  description,
  ...json(schema),
});
const errors = {
  "400": response("Invalid input", problem),
  "401": response("Missing, expired or revoked session", problem),
  "403": response("Role or origin denied", problem),
  "500": response("Internal failure", problem),
};
const recordResponses = {
  ...errors,
  "200": response("Existing reservation replayed", reservation),
  "201": response("Reservation created", reservation),
  "409": response("Key conflict or unavailable inventory", problem),
  "413": response("Body exceeds 8 KiB", problem),
  "415": response("Unsupported media type", problem),
};
const list = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "page", "pageSize"],
  properties: {
    items: { type: "array", items: reservation },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 10 },
  },
};
export const openapi = {
  openapi: "3.1.0",
  info: { title: "Tenant Reservation API", version: "0.1.0" },
  servers: [{ url: "http://127.0.0.1:4310" }],
  components: {
    securitySchemes: {
      demoBearer: {
        type: "http",
        scheme: "bearer",
        description: "Synthetic, short-lived local demo session. Not OAuth.",
      },
    },
  },
  security: [{ demoBearer: [] }],
  paths: {
    "/health": {
      get: {
        security: [],
        responses: {
          "200": response("Ready", {
            type: "object",
            required: ["status"],
            properties: { status: { const: "ok" } },
          }),
        },
      },
    },
    "/sessions": {
      post: {
        security: [],
        requestBody: { required: true, ...json(sessionInput) },
        responses: {
          ...errors,
          "201": response("Session issued", {
            type: "object",
            additionalProperties: false,
            required: ["token", "expiresInSeconds"],
            properties: {
              token: { type: "string" },
              expiresInSeconds: { const: 900, type: "integer" },
            },
          }),
        },
      },
      delete: {
        responses: {
          ...errors,
          "204": { description: "Current session revoked" },
        },
      },
    },
    "/inventory": {
      get: {
        responses: {
          ...errors,
          "200": response("Tenant inventory", {
            type: "object",
            additionalProperties: false,
            required: ["sku", "available"],
            properties: {
              sku: { const: "camera-kit", type: "string" },
              available: { type: "integer", minimum: 0 },
            },
          }),
        },
      },
    },
    "/reservations": {
      post: {
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,80}$" },
          },
        ],
        requestBody: { required: true, ...json(reservationInput) },
        responses: recordResponses,
      },
      get: {
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 10 },
          },
        ],
        responses: {
          ...errors,
          "200": response("Tenant reservation page", list),
        },
      },
    },
    "/reservations/{id}": {
      get: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[0-9a-f-]{36}$" },
          },
        ],
        responses: {
          ...errors,
          "200": response("Tenant-owned reservation", reservation),
          "404": response("Unknown or foreign reservation", problem),
        },
      },
    },
  },
} as const;
