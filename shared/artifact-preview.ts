// Keep expensive renderers bounded even when the registered snapshot is larger.
export const PREVIEW_CHARACTERS = 64_000;
export function previewText(text: string, limit = PREVIEW_CHARACTERS) {
  return { text: text.slice(0, limit), truncated: text.length > limit };
}
export function artifactLanguage(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return (
    (
      {
        ts: "typescript",
        tsx: "tsx",
        js: "javascript",
        jsx: "jsx",
        mjs: "javascript",
        py: "python",
        rs: "rust",
        go: "go",
        sh: "bash",
        yaml: "yaml",
        yml: "yaml",
        toml: "toml",
        json: "json",
        html: "html",
        css: "css",
        md: "markdown",
        xml: "xml",
        sql: "sql",
      } as Record<string, string>
    )[extension] || "text"
  );
}
export function jsonPreview(text: string) {
  if (text.length > 192_000)
    return {
      ...previewText(text),
      error: "文件较大，仅显示源码预览。",
      formatted: false,
    };
  try {
    return {
      ...previewText(
        JSON.stringify(JSON.parse(text.replace(/^\uFEFF/, "")), null, 2),
      ),
      error: "",
      formatted: true,
    };
  } catch {
    return {
      ...previewText(text),
      error: "JSON 格式无效，已显示原始内容。",
      formatted: false,
    };
  }
}
export function csvPreview(input: string, maxRows = 101, maxColumns = 30) {
  const limit = 192_000;
  const text = input.replace(/^\uFEFF/, "").slice(0, limit);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let truncated = input.length > limit;
  let columns = 0;
  const field = () => {
    if (columns < maxColumns) row.push(cell.slice(0, 2000));
    if (cell.length > 2000 || columns >= maxColumns) truncated = true;
    columns++;
    cell = "";
    closed = false;
  };
  const record = () => {
    field();
    rows.push(row);
    row = [];
    columns = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        return { rows: [], truncated, error: "CSV 引号格式无效，请查看源码。" };
      quoted = true;
    } else if (c === ",") field();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record();
      if (rows.length >= maxRows)
        return { rows, truncated: truncated || i < text.length - 1, error: "" };
    } else {
      if (closed)
        return { rows: [], truncated, error: "CSV 引号格式无效，请查看源码。" };
      cell += c;
    }
  }
  if (quoted && input.length <= limit)
    return { rows: [], truncated, error: "CSV 引号未闭合，请查看源码。" };
  if (input.length <= limit && (cell || row.length || closed)) record();
  return { rows, truncated, error: "" };
}
export function formatFileSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1024 * 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
