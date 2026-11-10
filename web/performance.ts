// Opt-in browser benchmark (?profile=1). DOM-readable aggregates only: no API URLs or content.
export function installPerformanceProbe() {
  if (new URL(location.href).searchParams.get("profile") !== "1") return;
  if (document.getElementById("newbot-performance")) return;
  const output = document.createElement("output");
  output.id = "newbot-performance";
  output.hidden = true;
  document.body.append(output);
  let historyReadyMs: number | null = null,
    appReadyMs: number | null = null;
  let uiReadyMs: number | null = null,
    timer: ReturnType<typeof setTimeout>;
  function publish() {
    if (uiReadyMs === null && document.querySelector(".workspace,.login"))
      uiReadyMs = performance.now();
    if (
      historyReadyMs === null &&
      document.querySelector(".assistant-message,.user-message")
    )
      historyReadyMs = performance.now();
    if (
      appReadyMs === null &&
      [...document.querySelectorAll(".app-bar")].some((b) =>
        b.textContent?.includes("已连接"),
      )
    )
      appReadyMs = performance.now();
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    output.textContent = JSON.stringify({
      sampledAtMs: performance.now(),
      uiReadyMs,
      historyReadyMs,
      appReadyMs,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd,
      loadMs: navigation?.loadEventEnd,
      paint: performance
        .getEntriesByType("paint")
        .map((p) => ({ name: p.name, startMs: p.startTime })),
      assets: performance
        .getEntriesByType("resource")
        .filter((r) => new URL(r.name).pathname.startsWith("/assets/"))
        .slice(0, 200)
        .map((r) => {
          const e = r as PerformanceResourceTiming;
          return {
            path: new URL(e.name).pathname,
            encodedBytes: e.encodedBodySize,
            decodedBytes: e.decodedBodySize,
            transferBytes: e.transferSize,
            durationMs: e.duration,
          };
        }),
    });
  }
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(publish, 80);
  };
  const observer = new MutationObserver(update);
  observer.observe(document.getElementById("root")!, {
    childList: true,
    subtree: true,
  });
  const perf = new PerformanceObserver(update);
  perf.observe({ entryTypes: ["paint", "resource", "navigation"] });
  window.addEventListener("load", update, { once: true });
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(timer);
      observer.disconnect();
      perf.disconnect();
    },
    { once: true },
  );
  publish();
}
