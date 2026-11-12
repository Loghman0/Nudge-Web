import type { DecisionCategory, Preference } from "../types";

export const CATEGORY_PREFIXES: Record<DecisionCategory, readonly string[]> = {
  food: ["food", "cuisine", "drink", "taste", "diet", "condiment", "nutrition"],
  entertainment: ["watch", "genre", "music", "media", "culture", "entertainment", "reading"],
  travel: ["travel", "destination", "transport", "accommodation"],
  shopping: ["shopping", "product", "brand", "gift", "tech", "property"],
  lifestyle: ["activity", "rhythm", "habit", "rest", "home"],
  work: ["work", "focus"],
  social: ["social", "people"],
  health: ["health", "fitness", "wellness", "sleep", "body", "sport"],
  career: ["career", "work", "learning", "skill", "focus"],
  relationships: ["social", "family", "relationship", "people", "pet", "community"],
  finance: ["money", "spend", "finance", "invest", "save", "budget"],
  hobbies: ["hobby", "craft", "play", "creative", "game", "outdoor"],
  other: [],
};

export function knowledgeCategoryForDecision(category: DecisionCategory): string {
  if (category === "entertainment") return "movies";
  if (category === "work") return "career";
  if (category === "social") return "relationships";
  if (category === "other") return "lifestyle";
  return category;
}

export function preferencesForCategory(preferences: Preference[], category: DecisionCategory): Preference[] {
  if (category === "other") return preferences;
  return preferences.filter((pref) => {
    if (/^(style|values)\./.test(pref.key)) return true;
    // New learned keys encode their original decision category.
    if (pref.key.startsWith(`learned.${category}.`)) return true;
    // Legacy learned keys are scoped using the graph's projected category.
    if (pref.key.startsWith("learned.")) {
      return pref.category_slug === knowledgeCategoryForDecision(category);
    }
    return CATEGORY_PREFIXES[category].some((prefix) => pref.key.startsWith(`${prefix}.`));
  });
}
