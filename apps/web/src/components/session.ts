"use client";

import { useEffect, useState } from "react";
import type { RequestOptions } from "@/lib/api";

/**
 * The caller's session.
 *
 * The token comes from the auth provider's own storage. It is read here and
 * nowhere else, so there is exactly one place that knows how a request is
 * authenticated.
 */
export function useSession(): RequestOptions | null {
  const [session, setSession] = useState<RequestOptions | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("videoai.session");
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
