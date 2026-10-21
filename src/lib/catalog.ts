// Product categories and item conditions (completeness grades).
// Categories in CONDITION_CATEGORIES turn on per-condition tracking; the rest
// (apparel, books, etc.) ignore condition entirely.

export const CATEGORIES = [
  "Video Game",
  "Video Game Console",
  "Game Guide",
  "Movie",
  "Music",
  "Trading Card",
  "Apparel",
  "Book",
  "Collectible",
  "Other"
] as const;

export const CONDITION_CATEGORIES = new Set<string>(["Video Game", "Video Game Console", "Game Guide", "Movie", "Music", "Trading Card"]);

// Default completeness/condition grades — games, movies, cards.
export const CONDITIONS = [
  "Sealed / New",
  "Complete (CIB)",
  "Loose / disc only",
  "Box / case only",
  "No manual",
  "For parts"
] as const;

// Music CDs grade by jewel-case completeness + disc condition, not "CIB/manual".
const MUSIC_CD_CONDITIONS = [
  "Sealed / New",
  "Like new",
  "Complete (case + booklet)",
  "No booklet / inserts",
  "Disc only",
  "Scratched / for parts"
] as const;

// Consoles grade by hardware completeness (cables/controllers/box), not disc wear.
const CONSOLE_CONDITIONS = [
  "Sealed / New",
  "Console only",
  "Boxed (no manual)",
  "Complete (CIB)",
  "Bundle (extra games/controllers)",
  "Modded",
  "For parts / not working"
] as const;

// Strategy/game guides grade by wear + markings like books, not "CIB/manual".
const GAME_GUIDE_CONDITIONS = [
  "Sealed / New",
  "Like new",
  "Good (light wear)",
  "Heavy wear",
  "Writing / markings",
  "For parts"
] as const;

// Categories whose condition options differ from the default list.
const CONDITIONS_BY_CATEGORY: Record<string, readonly string[]> = {
  Music: MUSIC_CD_CONDITIONS,
  "Game Guide": GAME_GUIDE_CONDITIONS,
  "Video Game Console": CONSOLE_CONDITIONS
};

/** The condition options for a category (falls back to the default list). */
export function conditionsFor(category?: string | null): readonly string[] {
  return (category && CONDITIONS_BY_CATEGORY[category]) || CONDITIONS;
}

/** Every distinct condition value — for the category-agnostic bulk-edit picker. */
export const ALL_CONDITIONS: string[] = [
  ...new Set<string>([...CONDITIONS, ...Object.values(CONDITIONS_BY_CATEGORY).flat()])
];

export function tracksCondition(category?: string | null): boolean {
  return !!category && CONDITION_CATEGORIES.has(category);
}

/** Grouping key for analytics: products that track condition split by condition. */
export function variantKey(productId: string, category?: string | null, condition?: string | null): string {
  return tracksCondition(category) ? `${productId}|${condition || "Unspecified"}` : productId;
}

/** Display label: appends the condition for condition-tracked products. */
export function variantLabel(name: string, category?: string | null, condition?: string | null): string {
  return tracksCondition(category) && condition ? `${name} — ${condition}` : name;
}
