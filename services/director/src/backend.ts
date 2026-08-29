import type { AppConfig } from "@videoai/config";
import type { DirectorBackend } from "./adapter.js";

/**
 * Local reasoning backend.
 *
 * Speaks the OpenAI-compatible chat completions shape, which is what every
 * local inference server (vLLM, llama.cpp, TGI, SGLang) exposes. The endpoint
 * is configuration and points at our own runtime; there is no hosted provider
 * involved and no fallback to one (spec sections 1, 2, 9).
 */
export class LocalReasoningBackend implements DirectorBackend {
  constructor(
    private readonly opts: {
      endpoint: string;
      model: string;
      timeoutMs?: number;
      apiKey?: string;
    },
  ) {}

  static fromConfig(cfg: AppConfig): LocalReasoningBackend {
    return new LocalReasoningBackend({
      endpoint: cfg.DIRECTOR_ENDPOINT,
      model: cfg.DIRECTOR_MODEL,
    });
  }

  async complete(params: {
    system: string;
    user: string;
    json_schema: object;
    temperature: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 180_000);

    try {
      const response = await fetch(`${this.opts.endpoint.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: params.temperature,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
          // Constrained decoding where the server supports it. The adapter
          // validates regardless, so an server that ignores this still cannot
          // produce an invalid plan that reaches a generator.
          response_format: {
            type: "json_schema",
            json_schema: { name: "plan", strict: true, schema: params.json_schema },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Local reasoning model returned ${response.status}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("Local reasoning model returned an empty response");
      return content;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error("Local reasoning model timed out while planning", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
