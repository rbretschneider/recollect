/** Where the household's name is stored in app_setting. */
export const PUBLIC_NAME_KEY = 'library.publicName';

/** Long enough for "The Bretschneider Family", short enough for a link preview. */
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
 * from — "Shared from the Bretschneiders" rather than a product name, because
 * what reassures someone opening a link is whose it is.
 */
export function sharedFromFor(name: string): string {
  return name ? `Shared from ${name}.` : DEFAULT_SHARED_FROM;
}

/** The footer on a public page, and the invitation on a contribute page. */
export function sharedWithFor(name: string): string {
  return name ? `Shared from ${name}` : `Shared with ${DEFAULT_SITE_NAME}`;
}
