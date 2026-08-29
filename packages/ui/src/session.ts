"use client";

import { useEffect, useState } from "react";

/** What a request needs to be attributed to a caller and an organisation. */
export interface Session {
  token: string;
  organizationId?: string;
}

const STORAGE_KEY = "videoai.session";

/**
 * The caller's session.
 *
 * The token comes from the auth provider's own storage. It is read here and
 * nowhere else, so there is exactly one place in either app that knows how a
 * request is authenticated.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { token?: string; organization_id?: string };
      if (!parsed.token) return;
      setSession({ token: parsed.token, organizationId: parsed.organization_id });
    } catch {
      // A malformed or unreadable session is the same as no session; the app
      // shows the signed-out state rather than failing to render.
    }
  }, []);

  return session;
}
