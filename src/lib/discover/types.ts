export const DISCOVER_TOPICS = [
  ["food", "Food & cooking"], ["movies", "Movies & stories"], ["music", "Music"],
  ["travel", "Travel"], ["shopping", "Shopping"], ["health", "Movement & health"],
  ["career", "Work & career"], ["relationships", "Relationships"], ["finance", "Money"],
  ["hobbies", "Hobbies"], ["home", "Home"], ["learning", "Learning"],
  ["digital", "Digital life"], ["values", "Values"], ["time", "Time & routines"],
  ["creativity", "Creativity"], ["sustainability", "Sustainability"], ["wellbeing", "Rest & wellbeing"],
  ["gaming", "Games"], ["outdoors", "Outdoors"], ["reading", "Reading"],
  ["making", "Making & repair"], ["community", "Community"], ["sports", "Sport & play"],
] as const;
export type DiscoverTopic = typeof DISCOVER_TOPICS[number][0];
export function discoverTopic(value: unknown): DiscoverTopic | null {
  return DISCOVER_TOPICS.some(([key]) => key === value) ? value as DiscoverTopic : null;
}
export interface DailyQuestion {
  id: string; prompt: string; option_a: string; option_b: string;
  maps_to_key_a: string | null; maps_to_key_b: string | null;
  context?: { topic?: string; connection?: string; depth?: number };
}
export interface AnswerResult {
  next: DailyQuestion | null; answeredToday: number; totalAnswered: number; remaining: number;
  topic?: DiscoverTopic | null;
}
export interface VerificationItem {
  id: string; nodeId: string; prompt: string; key: string; label: string;
  polarity: "like" | "dislike" | "neutral";
}
export interface DiscoverActions {
  changeTopic(currentTopic: string | null): Promise<AnswerResult>;
  answerQuestion(id: string, choice: "a" | "b" | "skip", topic?: DiscoverTopic | null): Promise<AnswerResult>;
  answerVerification(id: string, answer: "still_true" | "not_anymore" | "forget"): Promise<{ error?: string }>;
  confirmInsight(key: string, confirmed: boolean): Promise<{ error?: string }>;
}
