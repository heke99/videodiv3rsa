import { queryOne, userClient } from "@videoai/database";

/**
 * Authentication and tenant resolution (spec section 61).
 *
 * Two rules hold everywhere below this: the caller's identity comes from their
 * token and never from the request body, and the organisation they are acting
 * in is verified against membership rather than trusted from a header. RLS is
 * the backstop; this is the front door.
 *
 * Framework-independent on purpose, so the API service and anything else that
 * needs to authenticate a caller share one implementation.
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

export interface AuthInput {
  authorization?: string | undefined;
  /** The organisation the caller claims to be acting in. Verified, not trusted. */
  organization_id?: string | undefined;
}

export async function authenticateToken(input: AuthInput): Promise<Caller> {
  if (!input.authorization?.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token", 401);
  }
  const token = input.authorization.slice(7);

  const { data, error } = await userClient(token).auth.getUser();
  if (error || !data.user) throw new AuthError("Invalid or expired token", 401);

  const membership = await queryOne<{ organization_id: string; role: string }>(
    input.organization_id
      ? `select organization_id, role from public.organization_members
         where user_id = $1 and organization_id = $2 and status = 'active'`
      : `select organization_id, role from public.organization_members
         where user_id = $1 and status = 'active'
         order by created_at asc limit 1`,
    input.organization_id ? [data.user.id, input.organization_id] : [data.user.id],
  );

  if (!membership) {
    throw new AuthError(
      input.organization_id
        ? "You are not a member of that organisation"
        : "You belong to no organisation",
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

export type OwnedTable = "projects" | "generation_jobs" | "assets" | "renders" | "exports";

/**
 * Confirm a resource belongs to the caller's organisation.
 *
 * Not found and not yours give the same answer on purpose: distinguishing them
 * tells a caller which ids exist.
 */
export async function assertOwnedBy(
  table: OwnedTable,
  id: string,
  caller: Caller,
): Promise<void> {
  const row = await queryOne<{ organization_id: string }>(
    `select organization_id from public.${table} where id = $1`,
    [id],
  );
  if (!row || row.organization_id !== caller.organization_id) {
    throw new AuthError("Not found", 404);
  }
}

/** Whether the caller is platform staff. */
export async function isPlatformAdmin(caller: Caller): Promise<boolean> {
  const row = await queryOne<{ user_id: string }>(
    "select user_id from public.platform_admins where user_id = $1",
    [caller.user_id],
  );
  return row !== null;
}
