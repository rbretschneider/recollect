import { Component, signal } from '@angular/core';
import { AppDrawer } from './app-drawer';

/** The app icon + wordmark; tapping it opens the side panel from the left. */
@Component({
  selector: 'app-brand',
  imports: [AppDrawer],
  template: `
    <h1>
      <button type="button" aria-label="Open menu" (click)="isDrawerOpen.set(true)">
        <img src="icons/icon.svg" alt="" width="26" height="26" />
        <span>Recollect</span>
      </button>
    </h1>
    @if (isDrawerOpen()) {
      <app-drawer (closed)="isDrawerOpen.set(false)" />
    }
  `,
  styles: `
    h1 {
      margin: 0;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      cursor: pointer;
      min-height: 40px;
      border-radius: 0.5rem;
      transition: opacity 0.15s ease;

      &:active {
        opacity: 0.7;
      }
    }

    img {
      display: block;
      border-radius: 0.4rem;
    }

    // On narrow phones the toolbar needs the room; the icon alone is the brand.
    @media (width < 460px) {
      span {
        display: none;
      }
    }
  `,
})
export class Brand {
  readonly isDrawerOpen = signal(false);
}
