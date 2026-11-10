/** Largest selection the server will zip in one request. */
export const MAX_BULK_DOWNLOAD = 1000;

/**
 * Starts a browser-native download of the given originals: one id fetches the
 * file itself, several arrive as a single ZIP. A form POST (rather than an
 * XHR blob) lets the browser stream the archive to disk with the session cookie.
 */
export function downloadAssets(assetIds: readonly string[]): void {
  if (assetIds.length === 1) {
    const anchor = document.createElement('a');
    anchor.href = `/api/v1/assets/${assetIds[0]}/download`;
    anchor.download = '';
    anchor.click();
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/v1/assets/download.zip';
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'assetIds';
  input.value = assetIds.join(',');
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
