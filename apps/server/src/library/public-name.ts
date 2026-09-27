/** Where the household's name is stored in app_setting. */
export const PUBLIC_NAME_KEY = 'library.publicName';

/** Long enough for "The Smith Family", short enough for a link preview. */
export const PUBLIC_NAME_MAX = 60;

/**
 * What an outsider sees when a link is shared: the site name on a link
 * preview, and the line under it.
 *
 * Unset falls back to the product's own wording, so a server that has never
 * been given a name still reads like something rather than like a blank.
 */
export interface PublicName {
  /** Empty when never set — callers use the defaults below. */
  name: string;
}

export const DEFAULT_SITE_NAME = 'Recollect';
export const DEFAULT_SHARED_FROM = 'Shared from our family photo home.';

/**
 * The line itself, without trailing punctuation so both a footer and a
 * sentence can use it.
 *
 * A comma rather than a possessive: turning an arbitrary name into one means
 * guessing between Smith's and Smiths', and getting somebody's own family name
 * wrong is a worse outcome than a slightly longer line.
 */
function sharedFromLine(name: string): string {
  return `Shared from ${name}, a Recollect photo library`;
}

/** Trimmed, collapsed and capped; whitespace-only is the same as unset. */
export function normalizePublicName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PUBLIC_NAME_MAX);
}

/** The og:site_name for a share page. */
export function siteNameFor(name: string): string {
  return name || DEFAULT_SITE_NAME;
}

/**
 * The line under a shared link's title. Named or not, it says where this came
 * from — the family, not just a product name, because what reassures someone
 * opening a link is whose it is.
 */
export function sharedFromFor(name: string): string {
  return name ? `${sharedFromLine(name)}.` : DEFAULT_SHARED_FROM;
}

/** The footer on a public page, and the invitation on a contribute page. */
export function sharedWithFor(name: string): string {
  return name ? sharedFromLine(name) : `Shared with ${DEFAULT_SITE_NAME}`;
}
