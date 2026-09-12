import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turns a failed request into a sentence a person can act on.
 *
 * The server already says why - "That suggestion is no longer available",
 * "Some selected photos are no longer available", a validation message - and
 * for a long time every toast threw that away for "Couldn't do X". On a
 * self-hosted app the person reading the toast is usually the one who can fix
 * it, so the reason is the useful part.
 */
export function describeError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  if (error.status === 0) {
    return `${fallback} You appear to be offline.`;
  }
  if (error.status === 403) {
    return `${fallback} You don't have permission to do that.`;
  }
  const detail = serverMessage(error);
  if (error.status >= 500) {
    return detail
      ? `${fallback} The server said: ${detail}`
      : `${fallback} The server hit an error (${error.status}) - the log will say why.`;
  }
  return detail ? `${fallback} ${detail}` : `${fallback} (${error.status})`;
}

/** NestJS puts the reason in body.message - a string, or a list for validation. */
function serverMessage(error: HttpErrorResponse): string | null {
  const body = error.error as { message?: unknown } | null;
  const message = body?.message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return endWithPeriod(message);
  }
  if (Array.isArray(message) && message.length > 0) {
    return endWithPeriod(message.map(String).join(' '));
  }
  return null;
}

function endWithPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
