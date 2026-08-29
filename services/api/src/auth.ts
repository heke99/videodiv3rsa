import type { FastifyRequest } from "fastify";
import {
  AuthError,
  HttpError,
  assertOwnedBy,
  authenticateToken,
  conflict,
  isPlatformAdmin,
  notFound,
  type Caller,
  type OwnedTable,
} from "@videoai/auth";

/**
 * Fastify adapter over the shared auth package. The rules live there; this
 * only pulls the two values out of the request that they need.
 */

export { AuthError, HttpError, conflict, isPlatformAdmin, notFound };
export type { Caller };

export async function authenticate(request: FastifyRequest): Promise<Caller> {
  const requested = request.headers["x-organization-id"];
  return authenticateToken({
    authorization: request.headers.authorization,
    organization_id: Array.isArray(requested) ? requested[0] : requested,
  });
}

export async function assertOwned(table: OwnedTable, id: string, caller: Caller): Promise<void> {
  return assertOwnedBy(table, id, caller);
}
