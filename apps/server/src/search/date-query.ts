/** A date range recovered from a search query, with a human label. */
export interface DateQueryRange {
  from: Date;
  to: Date;
  label: string;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Recognizes date-shaped queries: "july 2025", "aug 2024", "2023".
 * Month names may be abbreviated to three letters. Returns null for
 * anything ambiguous — text search handles the rest.
 */
export function parseDateQuery(query: string): DateQueryRange | null {
  const normalized = query.trim().toLowerCase();
  const monthYear = normalized.match(/^([a-z]{3,9})\.?\s+((?:19|20)\d{2})$/);
  if (monthYear) {
    const monthIndex = MONTHS.findIndex((month) => month.startsWith(monthYear[1]));
    if (monthIndex >= 0) {
      const year = Number(monthYear[2]);
      return {
        from: new Date(year, monthIndex, 1),
        to: new Date(year, monthIndex + 1, 1),
        label: `${capitalize(MONTHS[monthIndex])} ${year}`,
      };
    }
  }
  const yearOnly = normalized.match(/^((?:19|20)\d{2})$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1), label: String(year) };
  }
  return null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
