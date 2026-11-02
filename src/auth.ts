import { randomUUID } from "node:crypto";
import type { Tenant, Role } from "../contracts/schemas.ts";
import { Problem } from "./problem.ts";

type Identity = { tenant: Tenant; role: Role; expires: number };
export class Sessions {
  private readonly tokens = new Map<string, Identity>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  issue(tenant: Tenant, role: Role): string {
    for (const [token, identity] of this.tokens)
      if (identity.expires <= this.now()) this.tokens.delete(token);
    if (this.tokens.size >= 1000)
      throw new Problem(503, "Demo session capacity reached.");
    const token = randomUUID();
    this.tokens.set(token, { tenant, role, expires: this.now() + 900_000 });
    return token;
  }
  authenticate(header: string | undefined): Identity {
    const token = header?.match(/^Bearer ([0-9a-f-]{36})$/)?.[1];
    const identity = token ? this.tokens.get(token) : undefined;
    if (!identity || identity.expires <= this.now()) {
      if (token) this.tokens.delete(token);
      throw new Problem(401, "Sign in required.");
    }
    return { ...identity };
  }
  revoke(header: string | undefined) {
    this.authenticate(header);
    this.tokens.delete(header!.slice(7));
  }
}
