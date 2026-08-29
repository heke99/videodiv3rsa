import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { signEnvelope, verifyEnvelope } from "@videoai/gpu-manager";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
/** Prefer the repo venv so the worker SDK's dependencies are importable. */
const PYTHON = existsSync(path.join(ROOT, ".venv/bin/python"))
  ? path.join(ROOT, ".venv/bin/python")
  : "python3";
const KEY = "test-signing-key-that-is-long-enough-000000";

/**
 * The gateway signs in TypeScript and workers verify in Python. Those are two
 * implementations of one wire format, which is exactly the kind of pair that
 * silently drifts, so this test signs on one side and verifies on the other.
 */
async function verifyInPython(envelope: unknown, bodyHash: string): Promise<[boolean, string]> {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "workers/_sdk"))})
from videoai_worker.security import ReplayGuard, verify_envelope
envelope = json.loads(sys.argv[1])
ok, reason = verify_envelope(sys.argv[2], envelope, sys.argv[3], ReplayGuard())
print(json.dumps([ok, reason]))
`;
  const { stdout } = await exec(PYTHON, ["-c", script, JSON.stringify(envelope), KEY, bodyHash]);
  return JSON.parse(stdout) as [boolean, string];
}

describe("worker envelope, across the language boundary", () => {
  const body = JSON.stringify({ job_id: "j1", prompt: "a shot" });
  const bodyHash = createHash("sha256").update(body).digest("hex");

  it("accepts an envelope signed by the gateway", async () => {
    const envelope = signEnvelope(KEY, { jobId: "j1", bodyHash, ttlSeconds: 120 });
    const [ok, reason] = await verifyInPython(envelope, bodyHash);
    expect(reason).toBe("ok");
    expect(ok).toBe(true);
  });

  it("rejects an envelope replayed against a different body", async () => {
    const envelope = signEnvelope(KEY, { jobId: "j1", bodyHash, ttlSeconds: 120 });
    const otherHash = createHash("sha256").update("a different job entirely").digest("hex");
    const [ok, reason] = await verifyInPython(envelope, otherHash);
    expect(ok).toBe(false);
    expect(reason).toBe("signature mismatch");
  });

  it("rejects an expired envelope", async () => {
    const envelope = signEnvelope(KEY, {
      jobId: "j1",
      bodyHash,
      ttlSeconds: 60,
      now: Date.now() - 120_000,
    });
    const [ok, reason] = await verifyInPython(envelope, bodyHash);
    expect(ok).toBe(false);
    expect(reason).toBe("envelope expired");
  });

  it("rejects a forged signature", async () => {
    const envelope = signEnvelope(KEY, { jobId: "j1", bodyHash, ttlSeconds: 120 });
    const [ok] = await verifyInPython({ ...envelope, signature: "0".repeat(64) }, bodyHash);
    expect(ok).toBe(false);
  });

  it("refuses a nonce twice on the TypeScript side too", () => {
    const envelope = signEnvelope(KEY, { jobId: "j1", bodyHash, ttlSeconds: 120 });
    const used = new Set<string>();
    const seen = (n: string) => used.has(n);

    const first = verifyEnvelope(KEY, envelope, bodyHash, seen);
    expect(first.valid).toBe(true);
    used.add(envelope.nonce);

    const second = verifyEnvelope(KEY, envelope, bodyHash, seen);
    expect(second.valid).toBe(false);
    expect(second.reason).toBe("nonce already used");
  });
});
