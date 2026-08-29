import type { FastifyRequest } from "fastify";
import { queryOne, userClient } from "@videoai/database";

/**
 * Request authentication and tenant resolution.
 *
 * Two rules hold everywhere below this: the caller's identity comes from their
 * token and never from the request body, and the organisation they are acting
 * in is verified against membership rather than trusted from a header. RLS is
 * the backstop; this is the front door.
 */

export interface Caller {
  user_id: string;
  organization_id: string;
  role: string;
  access_token: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function authenticate(request: FastifyRequest): Promise<Caller> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token", 401);
  }
  const token = header.slice(7);

  const { data, error } = await userClient(token).auth.getUser();
  if (error || !data.user) throw new AuthError("Invalid or expired token", 401);

  const requested = request.headers["x-organization-id"];
  const organizationId = Array.isArray(requested) ? requested[0] : requested;

  // Membership is checked here rather than taken on faith. A caller naming an
  // organisation they do not belong to gets 403, not that organisation's data.
  const membership = await queryOne<{ organization_id: string; role: string }>(
    organizationId
      ? `select organization_id, role from public.organization_members
         where user_id = $1 and organization_id = $2 and status = 'active'`
      : `select organization_id, role from public.organization_members
         where user_id = $1 and status = 'active'
         order by created_at asc limit 1`,
    organizationId ? [data.user.id, organizationId] : [data.user.id],
  );

  if (!membership) {
    throw new AuthError(
      organizationId ? "You are not a member of that organisation" : "You belong to no organisation",
      403,
    );
  }

  return {
    user_id: data.user.id,
    organization_id: membership.organization_id,
    role: membership.role,
    access_token: token,
  };
}

/** Confirm a resource belongs to the caller's organisation before acting on it. */
export async function assertOwned(
  table: "projects" | "generation_jobs" | "assets" | "renders",
  id: string,
  caller: Caller,
): Promise<void> {
  const row = await queryOne<{ organization_id: string }>(
    `select organization_id from public.${table} where id = $1`,
    [id],
  );
  // Not found and not yours give the same response on purpose: distinguishing
  // them would tell a caller which ids exist.
  if (!row || row.organization_id !== caller.organization_id) {
    throw new AuthError("Not found", 404);
  }
}
