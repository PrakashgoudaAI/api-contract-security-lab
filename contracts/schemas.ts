import { Ajv } from "ajv";

export type Tenant = "alpha" | "beta";
export type Role = "editor" | "viewer";
export type ReservationInput = { sku: string; quantity: number };
export type Reservation = ReservationInput & {
  id: string;
  tenantId: Tenant;
  createdAt: string;
};

export const reservationInput = {
  type: "object",
  additionalProperties: false,
  required: ["sku", "quantity"],
  properties: {
    sku: { type: "string", const: "camera-kit" },
    quantity: { type: "integer", minimum: 1, maximum: 5 },
  },
} as const;
export const reservation = {
  type: "object",
  additionalProperties: false,
  required: ["id", "tenantId", "sku", "quantity", "createdAt"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    },
    tenantId: { type: "string", enum: ["alpha", "beta"] },
    sku: { type: "string", const: "camera-kit" },
    quantity: { type: "integer", minimum: 1, maximum: 5 },
    createdAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
    },
  },
} as const;
const ajv = new Ajv({ allErrors: true, strict: true });
export const validInput = ajv.compile<ReservationInput>(reservationInput);
export const validReservation = ajv.compile<Reservation>(reservation);

export const sessionInput = {
  type: "object",
  additionalProperties: false,
  required: ["tenant", "role", "password"],
  properties: {
    tenant: { enum: ["alpha", "beta"], type: "string" },
    role: { enum: ["editor", "viewer"], type: "string" },
    password: { type: "string" },
  },
} as const;
export const validSession = ajv.compile<{
  tenant: Tenant;
  role: Role;
  password: string;
}>(sessionInput);
export const problem = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;
