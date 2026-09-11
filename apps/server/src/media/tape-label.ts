/**
 * Reads the human label off a digitised-tape filename.
 *
 * Capture software names files `<label>.<YY-MM-DD>_<HH-MM>.<NN>.avi`, where the
 * stamp is the day the tape was *digitised* (useless as a capture date) and
 * the label is whatever was written on the cassette - which is the only real
 * information about when the footage was shot. `parseDateFromFilename`
 * deliberately ignores the label, because guessing from it unsupervised
 * misfires; this reads it so a person can confirm the guess.
 *
 *   christmas-2007        -> "Christmas 2007",     2007-12-25 (day)
 *   christmas1999         -> "Christmas 1999",     1999-12-25 (day)
 *   christmas-95-96       -> "Christmas 1995–96",  1995-12-25 (day, from the first year)
 *   christmas-12-25-95    -> "Christmas 1995",     1995-12-25 (day, explicit)
 *   Ryan91-93             -> "Ryan 1991–93",       1991       (year only)
 *   Germany               -> "Germany",            no date
 */
export interface TapeLabelGuess {
  /** The raw label, for "from the label '…'" in the UI. */
  label: string;
  /** Human title derived from the label. */
  title: string;
  /** ISO calendar date (YYYY-MM-DD) or null when the label carries no year. */
  date: string | null;
  /** How much of `date` the label actually states. */
  precision: 'day' | 'year' | null;
  /** A second year when the label gives a range ("95-96"). */
  yearEnd: number | null;
}

/** Two-digit years: 30 and up are 19xx, below are 20xx. Tapes predate 2030. */
function fullYear(two: string): number {
  const n = Number(two);
  return n >= 30 ? 1900 + n : 2000 + n;
}

/** The only holiday word safe enough to imply a month and day. */
const HOLIDAYS: ReadonlyArray<{ word: RegExp; month: number; day: number }> = [
  // Letters bound the word, not \b: a year is often glued on ("christmas1999").
  { word: /(?<![a-z])(?:christmas|xmas)(?![a-z])/i, month: 12, day: 25 },
];

export function parseTapeLabel(fileName: string): TapeLabelGuess | null {
  // Strip the capture stamp and extension; if there is no stamp this is not a
  // digitised-tape name and the label heuristics do not apply.
  const m = fileName.match(/^(.*?)\.\d{2}-\d{2}-\d{2}_\d{2}-\d{2}\.\d{2}\.[^.]+$/);
  if (!m || m[1].length === 0) {
    return null;
  }
  const label = m[1];
  let rest = label;
  let year: number | null = null;
  let yearEnd: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  // Explicit full date in the label: MM-DD-YY or MM-DD-YYYY.
  const full = rest.match(/(?:^|[-_ ])(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?=$|[-_ ])/);
  if (full) {
    month = Number(full[1]); day = Number(full[2]);
    year = full[3].length === 4 ? Number(full[3]) : fullYear(full[3]);
    rest = rest.replace(full[0], full[0].startsWith(full[1]) ? '' : full[0][0]);
  } else {
    // Four-digit year, optionally a range: 2007, 1995-96, 1995-1996.
    const y4 = rest.match(/(?:^|\D)((?:19|20)\d{2})(?:-((?:19|20)\d{2}|\d{2}))?(?=$|\D)/);
    if (y4) {
      year = Number(y4[1]);
      if (y4[2]) yearEnd = y4[2].length === 4 ? Number(y4[2]) : Math.floor(year / 100) * 100 + Number(y4[2]);
      rest = rest.replace(y4[0], y4[0].match(/^\D/) ? y4[0][0] : '');
    } else {
      // Two-digit year, optionally a range, glued to or dashed off the word: 91-93, christmas95.
      const y2 = rest.match(/(?:^|\D)(\d{2})(?:-(\d{2}))?(?=$|\D)/);
      if (y2) {
        year = fullYear(y2[1]);
        if (y2[2]) yearEnd = fullYear(y2[2]);
        rest = rest.replace(y2[0], y2[0].match(/^\D/) ? y2[0][0] : '');
      }
    }
  }

  if (year !== null && month === null) {
    const holiday = HOLIDAYS.find((h) => h.word.test(label));
    if (holiday) { month = holiday.month; day = holiday.day; }
  }

  // Title: the words of the label, tidied, with the year(s) appended.
  const words = rest
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s.]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  let title = words.join(' ');
  if (year !== null) {
    const span = yearEnd !== null && yearEnd !== year ? `${year}–${String(yearEnd).slice(-2)}` : String(year);
    title = title ? `${title} ${span}` : span;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  if (year === null) {
    return { label, title, date: null, precision: null, yearEnd: null };
  }
  if (month !== null && day !== null) {
    return { label, title, date: `${year}-${pad(month)}-${pad(day)}`, precision: 'day', yearEnd };
  }
  return { label, title, date: `${year}-01-01`, precision: 'year', yearEnd };
}
