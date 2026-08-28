import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStateService } from '../core/auth/auth-state.service';
import { Sheet } from './sheet';

/**
 * The always-present avatar in every topbar's top-right: who am I, what can
 * I do, and Sign out — one tap away everywhere. (The app menu is the brand
 * icon on the LEFT; this is only about the account.)
 */
@Component({
  selector: 'app-account-badge',
  imports: [Sheet],
  templateUrl: './account-badge.html',
  styleUrl: './account-badge.scss',
})
export class AccountBadge {
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);

  readonly isOpen = signal(false);

  get userInitial(): string {
    return (this.auth.user()?.displayName ?? '').charAt(0).toUpperCase();
  }

  get userName(): string {
    return this.auth.user()?.displayName ?? '';
  }

  get userEmail(): string {
    return this.auth.user()?.email ?? '';
  }

  /** What this account can do, so "why can't I delete?" answers itself. */
  get grantLabel(): string {
    const user = this.auth.user();
    if (!user) {
      return '';
    }
    const grant = {
      read: 'Can view',
      write: 'Can view & organize',
      delete: 'Can view, organize & delete',
    }[user.permission];
    return user.isAdmin ? `${grant} · Admin` : grant;
  }

  async signOut(): Promise<void> {
    await this.auth.logout();
    this.isOpen.set(false);
    await this.router.navigateByUrl('/login');
  }
}
