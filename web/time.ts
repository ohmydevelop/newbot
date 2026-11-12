const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

/** Compact recency label for lists. Values are epoch milliseconds. */
export function relativeTime(value: number | undefined, now = Date.now()) {
  if (!value || !Number.isFinite(value)) return "";
  const delta = Math.max(0, now - value);
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < week) return `${Math.floor(delta / day)} 天前`;
  if (delta < 5 * week) return `${Math.floor(delta / week)} 周前`;
  const date = new Date(value);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** Exact local time for tooltips. */
export function absoluteTime(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
