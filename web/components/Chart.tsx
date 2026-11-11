import { Code } from "./Renderer";
import { useEffect, useRef, useState } from "react";
import { useResolvedTheme } from "../appearance";
import { useMediaQuery } from "../media";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  TitleComponent,
  DatasetComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  TitleComponent,
  DatasetComponent,
  SVGRenderer,
]);
export default function Chart({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [error, setError] = useState("");
  useEffect(() => {
    if (streaming) return;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    setError("");
    try {
      const option = JSON.parse(code);
      // A previous streamed fragment may have been invalid; let React restore the container first.
      frame = requestAnimationFrame(() => {
        try {
          chart = echarts.init(
            ref.current!,
            theme === "dark" ? "dark" : undefined,
            { renderer: "svg" },
          );
          chart.setOption({
            ...option,
            backgroundColor: option.backgroundColor ?? "transparent",
            ...(reducedMotion ? { animation: false } : {}),
            tooltip: { ...option.tooltip, renderMode: "richText" },
          });
          observer = new ResizeObserver(() => chart?.resize());
          observer.observe(ref.current!);
        } catch {
          setError("ECharts 需要有效的 JSON 配置");
        }
      });
    } catch {
      setError("ECharts 需要有效的 JSON 配置");
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      chart?.dispose();
    };
  }, [code, theme, reducedMotion, streaming]);
  return (
    <figure className="chart" aria-label="交互图表">
      {streaming ? (
        <p className="muted" role="status">
          正在绘制图表…
        </p>
      ) : error ? (
        <>
          <p className="muted">图表配置无法解析，以下为原始数据。</p>
          <Code language="json" code={code} />
        </>
      ) : null}
      <div
        ref={ref}
        style={{
          height: 320,
          width: "100%",
          display: error || streaming ? "none" : undefined,
        }}
      />
    </figure>
  );
}
