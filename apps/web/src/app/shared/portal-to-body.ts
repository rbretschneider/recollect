import { DestroyRef, ElementRef } from '@angular/core';

/**
 * Moves an overlay's host element to <body> — and, just as importantly, takes
 * it away again when the component is destroyed.
 *
 * The move is what lets a fixed panel and its scrim escape whatever stacking
 * context they were declared in (a z-indexed hero button, a transformed card,
 * a backdrop-filtered topbar), instead of painting under the app chrome.
 *
 * The cleanup is not belt-and-braces. When Angular tears down a whole subtree
 * at once — the slideshow closing, the viewer closing, a route change — it
 * removes the ancestor element and skips removing each descendant, because
 * they leave with it. A node that has been moved to <body> is no longer a
 * descendant, so it survives its own component: an inert, unstyled copy of the
 * panel (its component's stylesheet is ref-counted away with the last
 * instance) stuck to the bottom of every page until a reload. That is the
 * stray "Share this photo" block, and the ghost sheet visible through the
 * see-through scrim of the slideshow's actions drawer.
 */
export function portalToBody(host: ElementRef<HTMLElement>, destroyRef: DestroyRef): void {
  const element = host.nativeElement;
  document.body.appendChild(element);
  // A no-op in the common case where Angular already removed it.
  destroyRef.onDestroy(() => element.remove());
}
