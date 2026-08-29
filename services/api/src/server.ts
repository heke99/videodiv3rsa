import Fastify from "fastify";
import { z } from "zod";
import { config } from "@videoai/config";
import { AuthError, authenticate } from "./auth.js";
import { UploadRejected } from "./uploads.js";
import { assetRoutes } from "./routes/assets.js";
import { exportRoutes } from "./routes/exports.js";
import { libraryRoutes } from "./routes/library.js";
import { projectRoutes } from "./routes/projects.js";
import { shotRoutes } from "./routes/shots.js";
import { timelineRoutes } from "./routes/timeline.js";

/**
 * The public API. This is the only thing a browser talks to: it never reaches
 * a GPU worker, a model runtime or Temporal directly (spec section 77).
 */

const cfg = config();
const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AuthError) {
    return reply.status(error.status).send({ error: error.message });
  }
  if (error instanceof UploadRejected) {
    return reply.status(415).send({ error: error.message });
  }
  // Routes raise conflicts and not-founds by attaching a status code, so the
  // handler stays in one place rather than being repeated per route.
  const known = error as { statusCode?: number; message?: string };
  if (known.statusCode && known.statusCode >= 400 && known.statusCode < 500) {
    return reply.status(known.statusCode).send({ error: known.message ?? "Request rejected" });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: "Invalid request", issues: error.issues });
  }
  app.log.error(error);
  // Internal detail stays in the logs; the client gets a stable shape.
  return reply.status(500).send({ error: "Something went wrong on our side" });
});

app.get("/health", async () => ({ status: "ok" }));

await app.register(projectRoutes);
await app.register(shotRoutes);
await app.register(timelineRoutes);
await app.register(assetRoutes);
await app.register(libraryRoutes);
await app.register(exportRoutes);

const port = Number(process.env["PORT"] ?? 8000);
await app.listen({ port, host: "0.0.0.0" });
