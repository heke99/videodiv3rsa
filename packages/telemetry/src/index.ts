import { performance } from "node:perf_hooks";

/**
 * Telemetry (spec section 82).
 *
 * OpenTelemetry-shaped spans and metrics without taking the SDK as a hard
 * dependency: an exporter is attached when one is configured, and when none is
 * the calls are cheap no-ops. That keeps instrumentation in the code paths
 * that matter without making local development require a collector.
 */

export type Attributes = Record<string, string | number | boolean | undefined>;

export interface Span {
  name: string;
  attributes: Attributes;
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface SpanRecord {
  name: string;
  attributes: Attributes;
  duration_ms: number;
  error?: string;
  started_at: number;
}

export interface MetricRecord {
  name: string;
  value: number;
  attributes: Attributes;
}

export interface Exporter {
  span(record: SpanRecord): void;
  metric(record: MetricRecord): void;
}

let exporter: Exporter | null = null;

export function setExporter(next: Exporter | null): void {
  exporter = next;
}

/** The spans the spec asks to be traceable end to end. */
export const SPANS = {
  request: "http.request",
  workflow: "workflow.production",
  planning: "workflow.planning",
  generation: "gpu.generation",
  modelLoad: "gpu.model_load",
  qc: "qc.evaluate",
  repair: "qc.repair",
  render: "render.compose",
} as const;

export function startSpan(name: string, attributes: Attributes = {}): Span {
  const started = performance.now();
  const collected: Attributes = { ...attributes };
  let error: string | undefined;
  let ended = false;

  return {
    name,
    attributes: collected,
    setAttribute(key, value) {
      collected[key] = value;
    },
    recordError(thrown) {
      error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    },
    end() {
      // Ending twice would double-count the operation in every metric derived
      // from spans, which is worse than losing one.
      if (ended) return;
      ended = true;
      exporter?.span({
        name,
        attributes: collected,
        duration_ms: performance.now() - started,
        error,
        started_at: Date.now(),
      });
    },
  };
}

/** Run something inside a span, recording failures without swallowing them. */
export async function traced<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    return await fn(span);
  } catch (error) {
    span.recordError(error);
    throw error;
  } finally {
    span.end();
  }
}

/** The metric names from the spec, so they are spelled one way everywhere. */
export const METRICS = {
  queueTime: "videoai.queue_time_seconds",
  generationTime: "videoai.generation_time_seconds",
  timeToFirstPreview: "videoai.time_to_first_preview_seconds",
  successRate: "videoai.success_rate",
  repairRate: "videoai.repair_rate",
  gpuUtilization: "videoai.gpu_utilization",
  vramPeak: "videoai.vram_peak_bytes",
  costPerSecondVideo: "videoai.cost_per_second_video",
  costPerApprovedShot: "videoai.cost_per_approved_shot",
  qcFailureReason: "videoai.qc_failure_reason",
} as const;

export function metric(name: string, value: number, attributes: Attributes = {}): void {
  exporter?.metric({ name, value, attributes });
}

/**
 * An in-memory exporter, for tests and for the admin overview's live view.
 * Bounded so a long-running process cannot accumulate spans indefinitely.
 */
export class MemoryExporter implements Exporter {
  readonly spans: SpanRecord[] = [];
  readonly metrics: MetricRecord[] = [];

  constructor(private readonly limit = 1000) {}

  span(record: SpanRecord): void {
    this.spans.push(record);
    if (this.spans.length > this.limit) this.spans.shift();
  }

  metric(record: MetricRecord): void {
    this.metrics.push(record);
    if (this.metrics.length > this.limit) this.metrics.shift();
  }

  clear(): void {
    this.spans.length = 0;
    this.metrics.length = 0;
  }

  /** Percentile latency for one span name, which is what an operator asks for. */
  percentile(name: string, p: number): number {
    const durations = this.spans.filter((s) => s.name === name).map((s) => s.duration_ms).sort((a, b) => a - b);
    if (durations.length === 0) return 0;
    const index = Math.min(durations.length - 1, Math.floor((p / 100) * durations.length));
    return durations[index]!;
  }

  errorRate(name: string): number {
    const matching = this.spans.filter((s) => s.name === name);
    if (matching.length === 0) return 0;
    return matching.filter((s) => s.error).length / matching.length;
  }
}
