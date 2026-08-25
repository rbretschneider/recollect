/** Keyset-pagination cursor for the photo timeline (captured_at DESC, id DESC). */
export interface TimelineCursor {
  capturedAt: Date;
  id: string;
}

/** Encodes a cursor for the client as an opaque token. */
export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(`${cursor.capturedAt.toISOString()}|${cursor.id}`).toString('base64url');
}

/** Decodes a client token; returns null when malformed rather than throwing. */
export function decodeTimelineCursor(token: string): TimelineCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separatorIndex = decoded.indexOf('|');
  if (separatorIndex < 0) {
    return null;
  }
  const capturedAt = new Date(decoded.slice(0, separatorIndex));
  const id = decoded.slice(separatorIndex + 1);
  if (Number.isNaN(capturedAt.getTime()) || id.length === 0) {
    return null;
  }
  return { capturedAt, id };
}
