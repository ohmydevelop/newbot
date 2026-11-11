/** Never expose an upstream HTML page, parser exception or reflected secret. */
export async function responseJson<T = any>(response: Response): Promise<T> {
  const type = response.headers.get("content-type") || "";
  if (type && !/\bjson\b|\+json\b/i.test(type))
    throw new Error("服务暂时未返回有效数据，请恢复连接后重试。");
  try {
    return await response.json();
  } catch {
    throw new Error("服务响应未能读取，请重新查询状态。");
  }
}
