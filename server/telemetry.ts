// No SDK, exporter, spans or buffers are loaded when telemetry is disabled.
export async function telemetry() {
  if (
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  )
    return (await import("./telemetry-enabled.js")).enabledTelemetry();
  return {
    enabled: false,
    operation<T>(_name: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    turnStart(_threadId: string, _runId: string) {},
    turnEnd(_runId: string, _status: string) {},
    async close() {},
  };
}
