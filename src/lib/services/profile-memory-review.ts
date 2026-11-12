export const MEMORY_KINDS = ["fact", "goal", "habit", "constraint"] as const;
export type ReviewedMemoryKind = typeof MEMORY_KINDS[number];
export interface ReviewedMemory { kind: ReviewedMemoryKind; content: string }
export interface ProfileMemoryDraft { generation: number; suggestions: ReviewedMemory[] }
export interface MemoryReviewInput { requestId: string; generation: number; reviewed: true; memories: ReviewedMemory[] }

/** Confirmation is explicit user input, independent of provider confidence. */
export function parseMemoryReview(raw: unknown): { value?: MemoryReviewInput; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Review and select the memories you want to save." };
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !["requestId", "generation", "reviewed", "memories"].includes(key)) || value.reviewed !== true
    || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
    || !Number.isSafeInteger(value.generation) || Number(value.generation) < 0
    || !Array.isArray(value.memories) || value.memories.length < 1 || value.memories.length > 6) {
    return { error: "Select one to six memories and confirm that you reviewed them." };
  }
  const memories: ReviewedMemory[] = [], seen = new Set<string>();
  for (const entry of value.memories) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "Check each selected memory's type and text." };
    const memory = entry as Record<string, unknown>;
    if (Object.keys(memory).some(key => !["kind", "content"].includes(key)) || !MEMORY_KINDS.includes(memory.kind as ReviewedMemoryKind)
      || typeof memory.content !== "string" || !memory.content.trim() || memory.content.length > 300) {
      return { error: "Use a valid type and 1 to 300 characters for each selected memory." };
    }
    const content = memory.content.trim(), kind = memory.kind as ReviewedMemoryKind;
    const key = `${kind}:${content.toLowerCase().replace(/\s+/gu, " ")}`;
    if (seen.has(key)) return { error: "Select each memory only once." };
    seen.add(key); memories.push({ kind, content });
  }
  return { value: { requestId: value.requestId, generation: Number(value.generation), reviewed: true, memories } };
}
