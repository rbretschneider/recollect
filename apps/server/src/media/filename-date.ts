/**
 * Attempts to recover a capture date from common camera/phone filename patterns,
 * e.g. `IMG_20250718_123456.jpg`, `PXL_20250718_183021123.jpg`,
 * `20250718_123456.mp4`, `IMG-20250718-WA0001.jpg`.
 * Returns null when no plausible date is present.
 */
export function parseDateFromFilename(fileName: string): Date | null {
  const withTime = fileName.match(/(20\d{2})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/);
  if (withTime) {
    return buildDate(withTime[1], withTime[2], withTime[3], withTime[4], withTime[5], withTime[6]);
  }
  const dateOnly = fileName.match(/(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?:[^\d]|$)/);
  if (dateOnly) {
    return buildDate(dateOnly[1], dateOnly[2], dateOnly[3], '12', '00', '00');
  }
  return null;
}

function buildDate(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): Date | null {
  const monthIndex = Number(month) - 1;
  const date = new Date(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const isValid =
    date.getFullYear() === Number(year) &&
    date.getMonth() === monthIndex &&
    date.getDate() === Number(day) &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60;
  return isValid ? date : null;
}
