import { jwtVerify, type CryptoKey } from "jose";
import { Problem } from "./problem.ts";
import type { Tenant, Role } from "../contracts/schemas.ts";

export function jwtAuthenticator(
  publicKey: CryptoKey,
  issuer: string,
  audience: string,
  now: () => Date = () => new Date(),
) {
  return async (
    header: string | undefined,
  ): Promise<{ tenant: Tenant; role: Role }> => {
    try {
      const token = header?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new Error("Missing bearer token.");
      const { payload } = await jwtVerify(token, publicKey, {
        issuer,
        audience,
        algorithms: ["ES256"],
        requiredClaims: ["exp", "iat", "sub"],
        currentDate: now(),
      });
      if (
        !["alpha", "beta"].includes(String(payload.tenant)) ||
        !["editor", "viewer"].includes(String(payload.role))
      )
        throw new Error("Invalid identity claims.");
      return { tenant: payload.tenant as Tenant, role: payload.role as Role };
    } catch {
      throw new Problem(401, "Valid issuer token required.");
    }
  };
}
