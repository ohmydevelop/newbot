import {
  Blocks,
  Box,
  Code2,
  FileText,
  Globe,
  Palette,
  Search,
  Server,
  Cpu,
} from "lucide-react";
export default function CatalogIcon({
  name,
  kind = "skill",
}: {
  name: string;
  kind?: "skill" | "plugin" | "connection" | "gateway";
}) {
  const text = name.toLowerCase();
  const [Icon] = /design|brand|设计|图像/.test(text)
    ? ([Palette, "rose"] as const)
    : /code|review|dev|代码|审查/.test(text)
      ? ([Code2, "violet"] as const)
      : /search|research|web|搜索/.test(text)
        ? ([Search, "teal"] as const)
        : /file|document|docs|文档/.test(text)
          ? ([FileText, "amber"] as const)
          : /browser|http|浏览/.test(text)
            ? ([Globe, "blue"] as const)
            : kind === "gateway"
              ? ([Cpu, "teal"] as const)
              : kind === "connection"
                ? ([Server, "blue"] as const)
                : kind === "plugin"
                  ? ([Blocks, "violet"] as const)
                  : ([Box, "amber"] as const);
  return (
    <span className="catalog-icon" aria-hidden="true">
      <Icon size={23} strokeWidth={1.8} />
    </span>
  );
}
