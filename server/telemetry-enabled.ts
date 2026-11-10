import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  traceOperation,
  traceIdentifier,
  traceTurnStatus,
  traceErrorType,
} from "./telemetry-policy.js";
// Explicit spans only. No HTTP/process auto-instrumentation and no prompts, results, args or env attributes.
export function enabledTelemetry() {
  const enabled = true;
  const sdk = enabled
    ? new NodeSDK({
        serviceName: "minimal-agent",
        // Default process resource detection includes command-line arguments.
        // Keep exports independent of argv, environment and host identity.
        autoDetectResources: false,
        resourceDetectors: [],
        traceExporter: new OTLPTraceExporter(),
        instrumentations: [],
      })
    : undefined;
  sdk?.start();
  const tracer = trace.getTracer("minimal-agent", "0.2.0");
  const turns = new Map<string, Span>();
  return {
    enabled,
    async operation<T>(name: string, fn: () => Promise<T>): Promise<T> {
      return tracer.startActiveSpan(traceOperation(name), async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute("error.type", traceErrorType(e));
          throw e;
        } finally {
          span.end();
        }
      });
    },
    turnStart(threadId: string, runId: string) {
      const span = tracer.startSpan("agent.turn");
      span.setAttribute("conversation.id", traceIdentifier(threadId));
      span.setAttribute("run.id", traceIdentifier(runId));
      turns.set(runId, span);
    },
    turnEnd(runId: string, status: string) {
      const span = turns.get(runId);
      if (span) {
        span.setAttribute("agent.turn.status", traceTurnStatus(status));
        span.setStatus({
          code: status === "failed" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
        span.end();
        turns.delete(runId);
      }
    },
    async close() {
      for (const span of turns.values()) {
        span.setAttribute("agent.turn.status", "process_stopped");
        span.end();
      }
      turns.clear();
      await sdk?.shutdown();
    },
  };
}
