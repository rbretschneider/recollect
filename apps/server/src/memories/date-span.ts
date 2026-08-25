/**
 * Human-readable span for a cluster's seed title, e.g. "July 18, 2025",
 * "July 18–21, 2025", or "Jul 30 – Aug 2, 2025" (FRD story S7.2 fallback
 * when no place name is available).
 */
export function formatDateSpan(startAt: Date, endAt: Date): string {
  const sameDay =
    startAt.getFullYear() === endAt.getFullYear() &&
    startAt.getMonth() === endAt.getMonth() &&
    startAt.getDate() === endAt.getDate();
  if (sameDay) {
    return format(startAt, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  const sameMonth =
    startAt.getFullYear() === endAt.getFullYear() && startAt.getMonth() === endAt.getMonth();
  if (sameMonth) {
    const month = format(startAt, { month: 'long' });
    return `${month} ${startAt.getDate()}–${endAt.getDate()}, ${endAt.getFullYear()}`;
  }
  const start = format(startAt, { month: 'short', day: 'numeric' });
  const end = format(endAt, { month: 'short', day: 'numeric' });
  return `${start} – ${end}, ${endAt.getFullYear()}`;
}

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', options).format(date);
}
