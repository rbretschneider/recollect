function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The og:/twitter: block that makes a pasted link unfurl in chats and socials.
 *
 * Link-preview bots never run the app, so this HTML is the whole of what a
 * shared link looks like to whoever receives it. The site name is free text an
 * admin typed, and it lands inside an HTML attribute — the escaping here is
 * the only thing between a family name with a quote in it and a broken
 * preview.
 */
export function unfurlTags(
  title: string,
  description: string,
  imageUrl: string | null,
  siteName: string,
): string {
  const safeTitle = escapeHtml(title);
  const tags = [
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
  ];
  if (imageUrl) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }
  tags.push(`<meta name="twitter:title" content="${safeTitle}">`);
  return tags.join('');
}
