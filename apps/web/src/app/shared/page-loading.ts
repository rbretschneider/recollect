import { Component, input } from '@angular/core';

/**
 * The one way a view says "content is on its way": a centered ring shown
 * while a page's primary data hasn't arrived. Every navigable view renders
 * this instead of a blank screen (three-signal standard).
 */
@Component({
  selector: 'app-page-loading',
  template: `
    <div class="loading" role="status" [attr.aria-label]="label()">
      <div class="ring" aria-hidden="true"></div>
      <p>{{ label() }}</p>
    </div>
  `,
  styles: `
    .loading {
      display: grid;
      place-items: center;
      gap: 0.75rem;
      padding: 4rem 1rem;
    }

    .ring {
      width: 2rem;
      height: 2rem;
      border: 3px solid color-mix(in srgb, var(--accent) 25%, transparent);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: page-loading-spin 0.9s linear infinite;
    }

    p {
      margin: 0;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    @keyframes page-loading-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class PageLoading {
  readonly label = input<string>('Loading…');
}
