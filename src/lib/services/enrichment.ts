/**
 * Candidate enrichment.
 *
 * Fills the option slots when a user knows they need to decide something but
 * cannot name the alternatives. Three sources, in priority order:
 *
 *  1. the user's own memory — liked preferences and past choices worth revisiting
 *  2. optional real-world APIs (TMDB for films, Google/Foursquare Places for
 *     venues), used only when the matching key is present in .env
 *  3. a small curated fallback set per category, so the feature always works
 *
 * Everything here returns plain option labels: the deterministic engine still
 * does the ranking. Enrichment widens the field, it never picks a winner.
 */

import type { DecisionCategory, Preference } from "@/lib/types";
import type { HistorySignal } from "./decision-engine";
import { preferencesForCategory } from "./categories";
import { isSameChoice } from "./similarity";

export interface EnrichmentInput {
  category: DecisionCategory;
  preferences: Preference[];
  history: HistorySignal[];
  region?: string | null;
}

const FALLBACKS: Record<DecisionCategory, string[]> = {
  food: ["Pizza", "Sushi", "Ramen", "Burger", "Salad bowl", "Home cooking", "Kebab", "Pasta"],
  entertainment: ["A film", "A series episode", "A book", "A podcast", "Video game", "Live music"],
  travel: ["Beach town", "Mountains", "A nearby city", "Countryside stay", "Somewhere new", "Stay local"],
  shopping: ["Buy it now", "Wait for a sale", "Buy second-hand", "Skip it", "Cheaper alternative"],
  lifestyle: ["Gym session", "Long walk", "Yoga", "Early night", "Rest day", "Swim"],
  work: ["Do it now", "Schedule it", "Delegate it", "Decline it", "Sleep on it"],
  social: ["Host at home", "Go out", "Quiet dinner", "Reschedule", "Group meetup"],
  health: ["Gym session", "Home workout", "Long walk", "Rest day", "Book a checkup", "Early night"],
  career: ["Take the course", "Ask for feedback", "Update CV", "Network event", "Stay the course", "Sleep on it"],
  relationships: ["Call them", "Plan a dinner", "Write a message", "Give it space", "Meet in person"],
  finance: ["Save it", "Invest it", "Pay down debt", "Buy it now", "Wait a month", "Set a budget"],
  hobbies: ["Read a book", "Creative session", "Learn something new", "Board game night", "Photography walk"],
  other: ["Option A", "Option B", "Do nothing", "Wait a week"],
};

function titleCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Labels the user has liked, drawn from their preference keys. */
function fromPreferences(preferences: Preference[], category: DecisionCategory): string[] {
  return preferencesForCategory(preferences, category)
    .filter((p) => p.polarity === "like")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6)
    .map((p) => titleCase((p.value ?? p.key.split(".").pop() ?? "").replace(/-/g, " ")));
}

/** Past choices that went well and are due another turn. */
function fromHistory(history: HistorySignal[]): string[] {
  return history
    .filter((h) => {
      if (!h.selectedLabel) return false;
      const rating = h.reflection?.rating;
      const days = h.decision.decided_at
        ? (Date.now() - new Date(h.decision.decided_at).getTime()) / 86_400_000
        : Infinity;
      return (rating == null || rating >= 4) && days > 14;
    })
    .map((h) => h.selectedLabel!)
    .slice(0, 6);
}

// ---------- Optional external providers ------------------------------------

/** TMDB — free API key at themoviedb.org. */
async function fromTmdb(): Promise<string[]> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/popular?api_key=${key}&page=1`,
      { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { title: string }[] };
    return (data.results ?? []).slice(0, 6).map((m) => m.title);
  } catch {
    return [];
  }
}

/** Google Places text search — needs GOOGLE_PLACES_API_KEY. */
async function fromPlaces(query: string, region: string | null): Promise<string[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName",
      },
      body: JSON.stringify({
        textQuery: region ? `${query} in ${region}` : query,
        maxResultCount: 6,
      }),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { places?: { displayName?: { text: string } }[] };
    return (data.places ?? [])
      .map((p) => p.displayName?.text)
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

async function fromExternal(input: EnrichmentInput): Promise<string[]> {
  switch (input.category) {
    case "entertainment":
      return fromTmdb();
    case "food":
      return fromPlaces("popular restaurants", input.region ?? null);
    case "travel":
      return fromPlaces("places to visit", input.region ?? null);
    default:
      return [];
  }
}

/**
 * Suggest 4–6 option labels. Always returns something, with or without keys.
 */
export async function suggestCandidates(input: EnrichmentInput): Promise<string[]> {
  const external = await fromExternal(input).catch(() => []);

  const pool = [
    ...fromPreferences(input.preferences, input.category),
    ...fromHistory(input.history),
    ...external,
    ...FALLBACKS[input.category],
  ];

  // De-duplicate using the same fuzzy matcher the engine uses, so
  // "Sushi" and "sushi place" don't both appear.
  const chosen: string[] = [];
  for (const label of pool) {
    const clean = label.trim();
    if (!clean || clean.length > 60) continue;
    if (chosen.some((existing) => isSameChoice(existing, clean))) continue;
    chosen.push(clean);
    if (chosen.length === 6) break;
  }
  return chosen;
}
