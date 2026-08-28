import { Component, signal } from '@angular/core';
import { AppDrawer } from './app-drawer';

/**
 * Drill-in pages' handle on the side panel: the app icon opens the same
 * left drawer the brand does — landing on Folders must not strand you.
 */
@Component({
  selector: 'app-menu-button',
  imports: [AppDrawer],
  template: `
    <button type="button" class="menu" aria-label="Open menu" (click)="isDrawerOpen.set(true)">
      <img src="icons/icon.svg" alt="" width="26" height="26" />
    </button>
    @if (isDrawerOpen()) {
      <app-drawer (closed)="isDrawerOpen.set(false)" />
    }
  `,
  styles: `
    .menu {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      border-radius: 0.5rem;
      background: none;
      cursor: pointer;
      flex-shrink: 0;

      &:active {
        opacity: 0.7;
      }
    }

    img {
      display: block;
      border-radius: 0.4rem;
    }
  `,
})
export class MenuButton {
  readonly isDrawerOpen = signal(false);
}
