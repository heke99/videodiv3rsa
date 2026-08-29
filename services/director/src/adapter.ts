import { z, type ZodTypeAny } from "zod";
import { directorJsonSchema, type CapabilitySnapshot } from "@videoai/contracts";

/**
 * Director adapter (spec section 9).
 *
 * The Director is a local reasoning model behind our own interface. It plans;
 * it never generates media, and it never emits free text to a generator. Every
 * response is validated against the same Zod schema the JSON Schema was
 * generated from, so the model's output format and our runtime expectations
 * cannot drift apart.
 *
 * No external LLM is involved or permitted (spec sections 1, 2).
 */

export interface DirectorRequest<T extends ZodTypeAny> {
  /** Which versioned output is being asked for, e.g. "shot_plan". */
  output: string;
  schema: T;
  system: string;
  user: string;
  /** What the Director is allowed to reference. Nothing outside this exists. */
  capabilities: CapabilitySnapshot;
  temperature?: number;
  max_attempts?: number;
}

export interface DirectorBackend {
  complete(params: {
    system: string;
    user: string;
    json_schema: object;
    temperature: number;
  }): Promise<string>;
}

export class DirectorSchemaError extends Error {
  constructor(
    readonly output: string,
    readonly issues: string[],
    readonly raw: string,
  ) {
    super(
      `Director returned ${output} that does not satisfy its schema:\n` +
        issues.map((i) => `  - ${i}`).join("\n"),
    );
    this.name = "DirectorSchemaError";
  }
}

export class Director {
  constructor(private readonly backend: DirectorBackend) {}

  /**
   * Ask for one structured output.
   *
   * A schema violation is retried with the validation errors fed back, because
   * a model that produced nearly-valid JSON usually fixes it when told exactly
   * what was wrong. After the attempt budget it throws: planning that cannot
   * produce a valid plan must fail loudly rather than hand something
   * half-formed to a generator.
   */
  async plan<T extends ZodTypeAny>(request: DirectorRequest<T>): Promise<z.infer<T>> {
    const schema = directorJsonSchema(request.output);
    const maxAttempts = request.max_attempts ?? 3;
    let user = buildPrompt(request);
    let lastIssues: string[] = [];
    let lastRaw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastRaw = await this.backend.complete({
        system: request.system,
        user,
        json_schema: schema,
        // Planning is deterministic work; creative variation belongs in the
        // content, not in whether the output parses.
        temperature: request.temperature ?? 0.4,
      });

      const parsed = parseJson(lastRaw);
      if (parsed.ok) {
        const validated = request.schema.safeParse(parsed.value);
        if (validated.success) return validated.data;
        lastIssues = validated.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        );
      } else {
        lastIssues = [parsed.error];
      }

      user = `${user}\n\nYour previous response was rejected:\n${lastIssues
        .map((i) => `- ${i}`)
        .join("\n")}\n\nReturn only corrected JSON.`;
    }

    throw new DirectorSchemaError(request.output, lastIssues, lastRaw);
  }
}

function buildPrompt<T extends ZodTypeAny>(request: DirectorRequest<T>): string {
  // The capability snapshot is part of the prompt rather than an afterthought:
  // it is what stops the Director inventing a model or a skill that does not
  // exist (spec section 108).
  const capabilities = [
    "Models available to you:",
    ...request.capabilities.models.map(
      (m) => `  - ${m.model_id} (${m.generation_kinds.join(", ")}, up to ${m.max_duration_frames} frames)`,
    ),
    "Skills available to you:",
    ...request.capabilities.skills.map((s) => `  - ${s.skill_id}`),
    `Voices available: ${request.capabilities.voices.join(", ") || "none yet"}`,
    "",
    "You may only reference the models, skills and voices listed above.",
    "If none of them can do what a shot needs, say so in the plan rather than inventing one.",
  ].join("\n");

  return `${capabilities}\n\n${request.user}`;
}

/** Models often wrap JSON in prose or a fence; recover it before giving up. */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
      } catch {
        /* fall through to the error below */
      }
    }
    return { ok: false, error: "response was not valid JSON" };
  }
}
