import { DestroyRef } from '@angular/core';

/**
 * Make a fullscreen overlay swallow the next browser / Android back press.
 *
 * On open it pushes a history entry; when Back pops that entry it calls `close`
 * (closing the overlay) instead of letting the router navigate the page
 * underneath — the failure mode where backing out of a slideshow lands you on
 * the login screen. If the overlay is instead closed by other means (✕, Escape,
 * finishing), it consumes the entry it pushed so the next Back isn't swallowed.
 *
 * Call once from the component's constructor (an injection context), passing its
 * DestroyRef and a close callback.
 */
export function closeOnBrowserBack(destroyRef: DestroyRef, close: () => void): void {
  let hasEntry = false;
  history.pushState({ recollectOverlay: true }, '', location.href);
  hasEntry = true;

  const onPopState = (): void => {
    hasEntry = false;
    close();
  };
  window.addEventListener('popstate', onPopState);

  destroyRef.onDestroy(() => {
    window.removeEventListener('popstate', onPopState);
    // Closed some other way? Consume the entry we pushed so the next back
    // press doesn't have to be pressed twice.
    if (hasEntry) {
      hasEntry = false;
      history.back();
    }
  });
}
