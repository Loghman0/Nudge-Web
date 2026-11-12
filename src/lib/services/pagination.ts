export interface PageResult<T> { data: T[] | null; error: unknown }
/** Follow actual returned offsets, including deployments with a smaller row cap. */
export async function collectPages<T>(load: (from: number, to: number) => PromiseLike<PageResult<T>>, pageSize = 200): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid page size");
  const rows: T[] = [];
  for (;;) {
    const result = await load(rows.length, rows.length + pageSize - 1);
    if (result.error || result.data == null) throw new Error("Could not load an export dataset");
    if (!result.data.length) return rows;
    rows.push(...result.data);
  }
}
