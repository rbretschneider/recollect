import { Component, input } from '@angular/core';

/** The icon names available; paths are from the Lucide icon set (ISC). */
export type IconName =
  | 'heart'
  | 'heart-filled'
  | 'trash'
  | 'info'
  | 'close'
  | 'view-cards'
  | 'view-mosaic'
  | 'view-large';

/**
 * Crisp stroke icons, inlined so the app stays dependency-free. Sized by the
 * `size` input and colored by the surrounding text color.
 */
@Component({
  selector: 'app-icon',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('heart') {
          <path
            d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
          />
        }
        @case ('heart-filled') {
          <path
            fill="currentColor"
            d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
          />
        }
        @case ('trash') {
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        }
        @case ('close') {
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        }
        @case ('view-cards') {
          <rect width="18" height="14" x="3" y="3" rx="2" />
          <path d="M4 21h1" />
          <path d="M9 21h1" />
          <path d="M14 21h1" />
          <path d="M19 21h1" />
        }
        @case ('view-mosaic') {
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        }
        @case ('view-large') {
          <rect width="18" height="18" x="3" y="3" rx="2" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<number>(20);
}
