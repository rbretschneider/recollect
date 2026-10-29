/**
 * Formats a date range the way memories and shares show it: a single date when
 * start and end land on the same day, otherwise "start – end". Returns '' when
 * either bound is missing (a share without dates renders nothing).
 */
export function formatDateSpan(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso || !endIso) {
    return '';
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  const format = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return start.toDateString() === end.toDateString()
    ? format.format(start)
    : `${format.format(start)} – ${format.format(end)}`;
}

/** Human byte size: GB/MB with one decimal, KB (min 1) below a megabyte. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Shown when an item has no usable capture date. */
const UNKNOWN_DATE_LABEL = 'Date unknown';

/**
 * Long, locale-aware capture date for headings and alt text.
 *
 * Intl THROWS on an invalid date, and lists built by toViewerAsset() carry an
 * empty capturedAt - which took the whole date heading down with it.
 */
export function formatCapturedDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) {
    return UNKNOWN_DATE_LABEL;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}
