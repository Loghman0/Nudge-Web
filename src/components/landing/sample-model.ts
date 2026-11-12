/** Public demonstration data. Never reads personal memory or calls AI. */
export type Reflection = "good" | "bad" | null;
export type SampleOption = { id: string; label: string; evidence: string; weight: number };
export function hindsightOptions(reflection: Reflection): SampleOption[] {
  return [
    { id: "film", label: "Watch a film", weight: 2, evidence: "Prefers restful evenings." },
    { id: "walk", label: "Take a walk", weight: reflection === "good" ? 3 : reflection === "bad" ? 0 : 1,
      evidence: reflection === "good" ? "Your walk was a good fit." : reflection === "bad" ? "Walking was a poor fit." : "Less evidence for walking." },
  ].sort((a, b) => b.weight - a.weight);
}
export type SampleComparison = { label: string | null; reason: string };
export function compareSample(first: string, second: string): SampleComparison {
  const outdoors = /\b(walk|walks|walking|park|parks|outdoors|hike|hikes|hiking|garden|gardening)\b/i;
  const a = outdoors.test(first), b = outdoors.test(second);
  if (a === b) return { label: null, reason: "The sample memory cannot distinguish these options. Relevant evidence is needed before favoring one." };
  return { label: a ? first : second, reason: "This matches the sample preference for time outdoors. A relative fit is a starting point, not a guarantee." };
}
export const memoryNodes = [
  { id: "memory", label: "Sample memory", x: 50, y: 47, evidence: "Choices and reflections connect preferences to real outcomes." },
  { id: "quiet", label: "Quiet evenings", x: 24, y: 16, evidence: "The sample includes a preference for a restful evening. It supports choosing a film." },
  { id: "outdoors", label: "Time outdoors", x: 77, y: 25, evidence: "This sample preference connects to walking. Select a reflection in the hero to see how evidence changes a ranking." },
  { id: "films", label: "Films", x: 20, y: 75, evidence: "A sample preference supports films. New outcomes may reinforce or weaken that support." },
  { id: "walks", label: "Walking", x: 76, y: 82, evidence: "A positive outcome can support walking. A negative outcome can count against it." },
] as const;
export const memoryEdges = [[0, 1], [0, 2], [0, 3], [2, 4], [1, 3]] as const;
