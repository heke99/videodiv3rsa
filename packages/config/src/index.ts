import { z } from "zod";

/**
 * All environment-specific configuration (spec sections 58, 94).
 *
 * Deliberately there are no fallback values for anything identifying: no
 * default domain, no default provider, no default bucket, no default model
 * path. A missing variable is a startup failure, which is what makes the
 * portability guarantee real rather than aspirational.
 */

const Url = z.string().url();

const BaseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Branding and domain — everything the UI shows comes from here.
  PUBLIC_APP_URL: Url,
  APP_NAME: z.string().min(1),
  APP_DOMAIN: z.string().min(1),
  APP_LOGO_URL: z.string().min(1).optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
  LEGAL_ENTITY: z.string().min(1).optional(),
  AUTH_CALLBACK_URL: Url,

  // Data plane
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: Url.optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Storage
  STORAGE_PROVIDER: z.enum(["supabase", "s3", "local"]),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_PUBLIC_BASE: z.string().min(1).optional(),
  STORAGE_LOCAL_ROOT: z.string().min(1).optional(),
  S3_ENDPOINT: Url.optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  // Compute
  GPU_PROVIDER: z.enum(["manual", "ssh", "runpod"]),
  GPU_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  GPU_GATEWAY_SIGNING_KEY: z.string().min(32),
  /**
   * Shared secret a worker's supervisor presents when it registers and
   * heartbeats. Separate from the gateway key: that one signs requests going
   * out to a worker, this one authenticates a worker calling in.
   */
  GPU_WORKER_TOKEN: z.string().min(32),
  GPU_ENVELOPE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  MODEL_ROOT: z.string().min(1),
  /** Where the skill packages live. No default: it is a deployment path. */
  SKILLS_ROOT: z.string().min(1),
  MODEL_REGISTRY_MODE: z.enum(["strict", "permissive"]).default("strict"),

  // Orchestration
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("videoai"),

  // Local reasoning and QC models — served by our own runtimes.
  DIRECTOR_MODEL: z.string().min(1),
  DIRECTOR_ENDPOINT: Url,
  QC_MODEL: z.string().min(1),
  QC_ENDPOINT: Url.optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: Url.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Port the media service listens on. Only used when STORAGE_PROVIDER=local. */
  MEDIA_PORT: z.coerce.number().int().positive().default(8004),
});

export type AppConfig = z.infer<typeof BaseSchema>;

/**
 * Provider-specific requirements that a flat schema cannot express: selecting a
 * provider makes its own variables mandatory.
 */
const Schema = BaseSchema.superRefine((cfg, ctx) => {
  const require = (key: keyof AppConfig, why: string) => {
    if (!cfg[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required ${why}`,
      });
    }
  };

  // Every authenticated request resolves the caller through Supabase auth,
  // whatever the storage backend is. Requiring these only for
  // STORAGE_PROVIDER=supabase let the API start clean on a local or S3
  // deployment and then throw on the first request a user made, which is the
  // opposite of failing closed.
  require("SUPABASE_URL", "to authenticate callers");
  require("SUPABASE_ANON_KEY", "to authenticate callers");

  if (cfg.STORAGE_PROVIDER === "supabase") {
    require("SUPABASE_SERVICE_ROLE_KEY", "when STORAGE_PROVIDER=supabase");
  }
  if (cfg.STORAGE_PROVIDER === "s3") {
    require("S3_ENDPOINT", "when STORAGE_PROVIDER=s3");
    require("S3_REGION", "when STORAGE_PROVIDER=s3");
    require("S3_ACCESS_KEY_ID", "when STORAGE_PROVIDER=s3");
    require("S3_SECRET_ACCESS_KEY", "when STORAGE_PROVIDER=s3");
  }
  if (cfg.STORAGE_PROVIDER === "local") {
    require("STORAGE_LOCAL_ROOT", "when STORAGE_PROVIDER=local");
  }
});

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

/** Cached accessor for long-lived processes. */
export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test seam: drop the cache so a test can load a different environment. */
export function resetConfigCache(): void {
  cached = null;
}

/** Brand surface consumed by the web and admin apps. */
export function brand(cfg: AppConfig = config()) {
  return {
    name: cfg.APP_NAME,
    domain: cfg.APP_DOMAIN,
    appUrl: cfg.PUBLIC_APP_URL,
    logoUrl: cfg.APP_LOGO_URL ?? null,
    supportEmail: cfg.SUPPORT_EMAIL ?? null,
    legalEntity: cfg.LEGAL_ENTITY ?? null,
  };
}
