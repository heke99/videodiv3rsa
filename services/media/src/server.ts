import Fastify from "fastify";
import { config } from "@videoai/config";
import { LocalStorageAdapter, storage } from "@videoai/storage";
import { contentRange, parseRange } from "./range.js";

/**
 * Media service.
 *
 * Serves objects from the local storage backend against the signed URLs that
 * `LocalStorageAdapter` issues. Its whole job is to be the thing that checks
 * the signature: without it, "local storage" would mean a directory anyone
 * could read, and the local backend would be the one deployment shape where
 * "nothing is public" quietly stopped being true.
 *
 * With an object store configured, signed URLs are issued by the provider and
 * this service is not in the path at all.
 */

const cfg = config();
const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });

const store = storage(cfg);
const local = store instanceof LocalStorageAdapter ? store : null;

app.get("/health", async () => ({ status: "ok", serving: local ? "local" : "delegated" }));

app.get("/media/*", async (request, reply) => {
  if (!local) {
    // Any other backend issues its own signed URLs; a request arriving here
    // means something is misconfigured, and guessing would be worse.
    return reply.status(404).send({ error: "This deployment serves media from its object store" });
  }

  const key = (request.params as Record<string, string>)["*"];
  const { expires, signature } = request.query as { expires?: string; signature?: string };

  if (!key || !expires || !signature) {
    return reply.status(403).send({ error: "Unsigned media request" });
  }
  if (!local.verify(key, Number(expires), signature)) {
    // Expired and forged give the same answer: distinguishing them tells a
    // caller whether a key exists.
    return reply.status(403).send({ error: "Invalid or expired media link" });
  }

  const head = await local.head(key);
  if (!head) return reply.status(404).send({ error: "Not found" });

  const body = await local.get(key);
  const range = parseRange(request.headers.range, head.size_bytes);

  reply.header("accept-ranges", "bytes");
  reply.header("content-type", head.mime);
  // Signed links expire, so a shared cache must not keep the bytes around.
  reply.header("cache-control", "private, max-age=300");

  if (!range) {
    reply.header("content-length", String(head.size_bytes));
    return reply.send(Buffer.from(body));
  }

  reply.status(206);
  reply.header("content-range", contentRange(range, head.size_bytes));
  reply.header("content-length", String(range.length));
  return reply.send(Buffer.from(body.slice(range.start, range.end + 1)));
});

const port = Number(process.env["MEDIA_PORT"] ?? 8004);
await app.listen({ port, host: "0.0.0.0" });
