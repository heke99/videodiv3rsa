import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WorkerEnvelope } from "@videoai/contracts";

/**
 * Signed envelope for backend to worker calls (spec section 77).
 *
 * The browser never reaches a worker. Requests travel
 * browser -> API -> workflow -> gateway -> worker, and the worker accepts only
 * envelopes that are signed, unexpired and not replayed. The signature covers
 * the body hash as well as the metadata, so an intercepted envelope cannot be
 * reused to run a different job.
 */

export interface SignOptions {
  jobId: string;
  bodyHash: string;
  ttlSeconds: number;
  now?: number;
}

export function signEnvelope(key: string, opts: SignOptions): WorkerEnvelope {
  const issued = Math.floor((opts.now ?? Date.now()) / 1000);
  const envelope = {
    job_id: opts.jobId,
    nonce: randomBytes(16).toString("hex"),
    issued_at: issued,
    expires_at: issued + opts.ttlSeconds,
  };
  return { ...envelope, signature: computeSignature(key, envelope, opts.bodyHash) };
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

/**
 * `seenNonce` is supplied by the caller so the worker can back replay
 * protection with whatever store it has, without this module owning state.
 */
export function verifyEnvelope(
  key: string,
  envelope: WorkerEnvelope,
  bodyHash: string,
  seenNonce: (nonce: string) => boolean,
  now = Date.now(),
): VerifyResult {
  const seconds = Math.floor(now / 1000);
  if (envelope.expires_at <= seconds) return { valid: false, reason: "envelope expired" };
  // A far-future issue time means clock skew or a forged envelope; either way
  // it should not be honoured.
  if (envelope.issued_at > seconds + 60) return { valid: false, reason: "issued in the future" };
  if (seenNonce(envelope.nonce)) return { valid: false, reason: "nonce already used" };

  const expected = computeSignature(
    key,
    {
      job_id: envelope.job_id,
      nonce: envelope.nonce,
      issued_at: envelope.issued_at,
      expires_at: envelope.expires_at,
    },
    bodyHash,
  );
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(envelope.signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "signature mismatch" };
  }
  return { valid: true, reason: "ok" };
}

function computeSignature(
  key: string,
  envelope: Omit<WorkerEnvelope, "signature">,
  bodyHash: string,
): string {
  const payload = [envelope.job_id, envelope.nonce, envelope.issued_at, envelope.expires_at, bodyHash].join(
    "\n",
  );
  return createHmac("sha256", key).update(payload).digest("hex");
}
