import { Component, inject, signal } from '@angular/core';
import { AuthStateService } from '../core/auth/auth-state.service';
import { ActivitySpinner } from './activity-spinner';
import { AppDrawer } from './app-drawer';
import { Brand } from './brand';
import { EditToggle } from './edit-toggle';

/**
 * The persistent app header: brand (taps home), live activity, projected
 * page actions, and the avatar menu. The bottom nav says where you are;
 * this bar stays the same everywhere.
 */
@Component({
  selector: 'app-topbar',
  imports: [ActivitySpinner, AppDrawer, Brand, EditToggle],
  template: `
    <header class="topbar">
      <app-brand />
      <app-activity-spinner />
      <span class="spacer"></span>
      <ng-content />
      <app-edit-toggle />
      <button type="button" class="avatar" aria-label="Menu" (click)="isDrawerOpen.set(true)">
        {{ userInitial }}
      </button>
    </header>
    @if (isDrawerOpen()) {
      <app-drawer (closed)="isDrawerOpen.set(false)" />
    }
  `,
  styles: `
    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      min-width: 0;
    }

    .spacer {
      flex: 1;
    }

    .avatar {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: var(--accent);
      color: var(--accent-contrast);
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: transform 0.15s ease;

      &:active {
        transform: scale(0.92);
      }
    }
  `,
})
export class AppTopbar {
  private readonly auth = inject(AuthStateService);

  readonly isDrawerOpen = signal(false);

  get userInitial(): string {
    return (this.auth.user()?.displayName ?? '').charAt(0).toUpperCase();
  }
}
