import { beforeEach, describe, expect, it } from "vitest";
import { MemoryExporter, METRICS, SPANS, metric, setExporter, startSpan, traced } from "@videoai/telemetry";
import { costUnits } from "@videoai/usage";

/**
 * Instrumentation has to be cheap enough to leave in the hot paths and correct
 * enough to base decisions on. These cover both: no-op when unconfigured, and
 * accurate when it is.
 */

let exporter: MemoryExporter;

beforeEach(() => {
  exporter = new MemoryExporter();
  setExporter(exporter);
});

describe("spans", () => {
  it("records a span with its attributes", () => {
    const span = startSpan(SPANS.generation, { model_id: "wan2.2-t2v-a14b" });
    span.setAttribute("shot_id", "shot_01");
    span.end();

    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]!.name).toBe(SPANS.generation);
    expect(exporter.spans[0]!.attributes).toMatchObject({
      model_id: "wan2.2-t2v-a14b",
      shot_id: "shot_01",
    });
  });

  it("does not double-count a span ended twice", () => {
    // Double counting would inflate every metric derived from spans, which is
    // worse than losing one.
    const span = startSpan(SPANS.qc);
    span.end();
    span.end();
    expect(exporter.spans).toHaveLength(1);
  });

  it("records an error without swallowing it", async () => {
    await expect(
      traced(SPANS.generation, {}, async () => {
        throw new Error("no CUDA device");
      }),
    ).rejects.toThrow("no CUDA device");

    expect(exporter.spans[0]!.error).toContain("no CUDA device");
  });

  it("ends the span even when the body throws", async () => {
    await traced(SPANS.qc, {}, async () => "ok");
    await traced(SPANS.qc, {}, async () => {
      throw new Error("boom");
    }).catch(() => undefined);

    expect(exporter.spans).toHaveLength(2);
  });

  it("is a no-op when no exporter is configured", () => {
    setExporter(null);
    const span = startSpan(SPANS.render);
    span.end();
    metric(METRICS.successRate, 1);
    // Nothing thrown, nothing recorded: instrumentation stays in the code
    // path without requiring a collector in development.
    expect(exporter.spans).toHaveLength(0);
  });
});

describe("derived measures", () => {
  it("computes a percentile from recorded spans", () => {
    for (const duration of [10, 20, 30, 40, 50]) {
      exporter.span({ name: SPANS.generation, attributes: {}, duration_ms: duration, started_at: 0 });
    }
    expect(exporter.percentile(SPANS.generation, 50)).toBe(30);
    expect(exporter.percentile(SPANS.generation, 100)).toBe(50);
  });

  it("returns zero for a span nobody recorded", () => {
    expect(exporter.percentile("never.happened", 95)).toBe(0);
  });

  it("computes an error rate", () => {
    exporter.span({ name: SPANS.qc, attributes: {}, duration_ms: 1, started_at: 0 });
    exporter.span({ name: SPANS.qc, attributes: {}, duration_ms: 1, started_at: 0, error: "x" });
    expect(exporter.errorRate(SPANS.qc)).toBe(0.5);
  });

  it("bounds what it keeps, so a long-running process cannot grow forever", () => {
    const bounded = new MemoryExporter(3);
    for (let i = 0; i < 10; i++) {
      bounded.span({ name: "s", attributes: {}, duration_ms: i, started_at: 0 });
    }
    expect(bounded.spans).toHaveLength(3);
    expect(bounded.spans[2]!.duration_ms).toBe(9);
  });
});

describe("cost units", () => {
  it("derives cost from a configured rate rather than an assumed one", () => {
    expect(costUnits(60, 0.05)).toBe(3);
    expect(costUnits(37.5, 0.02)).toBe(0.75);
  });

  it("keeps enough precision for a short generation to register", () => {
    expect(costUnits(0.5, 0.001)).toBeGreaterThan(0);
  });
});
