import { Component, inject, signal } from '@angular/core';
import { AuthStateService } from '../core/auth/auth-state.service';
import { AppDrawer } from './app-drawer';

/**
 * The avatar button that opens the app drawer. Lives in EVERY page's topbar
 * (top-level and drill-in alike) so the menu is never more than one tap away
 * — landing on Folders must not strand you.
 */
@Component({
  selector: 'app-avatar-menu',
  imports: [AppDrawer],
  template: `
    <button type="button" class="avatar" aria-label="Menu" (click)="isDrawerOpen.set(true)">
      {{ userInitial }}
    </button>
    @if (isDrawerOpen()) {
      <app-drawer (closed)="isDrawerOpen.set(false)" />
    }
  `,
  styles: `
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
      flex-shrink: 0;
    }
  `,
})
export class AvatarMenu {
  private readonly auth = inject(AuthStateService);

  readonly isDrawerOpen = signal(false);

  get userInitial(): string {
    return (this.auth.user()?.displayName ?? '').charAt(0).toUpperCase();
  }
}
