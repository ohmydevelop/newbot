/** A directory is usable only for the configuration that produced it. A newer
 * revision during discovery requires a new read, not an older result commit. */
export async function readCurrentConfiguration<T>(
  revision: () => string,
  read: () => Promise<T>,
  isCurrent: () => boolean,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 3 && isCurrent(); attempt++) {
    const before = revision();
    try {
      const result = await read();
      if (!isCurrent()) return;
      if (before === revision()) return result;
    } catch (error) {
      if (!isCurrent()) return;
      if (before === revision()) throw error;
    }
  }
  if (isCurrent()) throw new Error("模型配置已变化，请刷新目录。");
}
