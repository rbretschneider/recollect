import { inject, Injectable, signal } from '@angular/core';
import { AuthApiService } from '../api/auth-api.service';
import { UserProfile } from '../api/api-models';

/**
 * Session state for the whole app. Holds the signed-in user as a signal and
 * resolves the "where should this visitor land?" question (setup vs login vs app).
 */
@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly api = inject(AuthApiService);

  readonly user = signal<UserProfile | null>(null);

  private refreshInFlight: Promise<boolean> | null = null;

  /**
   * Refreshes the access token, deduping concurrent callers (a resumed tab
   * fires many 401s at once — they all await the same refresh). Returns
   * whether the session is alive afterwards.
   */
  tryRefresh(): Promise<boolean> {
    this.refreshInFlight ??= this.api
      .refresh()
      .then(({ user }) => {
        this.user.set(user);
        return true;
      })
      .catch(() => {
        this.user.set(null);
        return false;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  /**
   * Restores the session on app start: tries /me, then one refresh.
   * Returns the destination the router should send an unauthenticated visitor to.
   */
  async resolveEntry(): Promise<'app' | 'login' | 'setup'> {
    try {
      const { user } = await this.api.me();
      this.user.set(user);
      return 'app';
    } catch {
      return this.resolveWhenSignedOut();
    }
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await this.api.login(email, password);
    this.user.set(user);
  }

  async completeSetup(email: string, displayName: string, password: string): Promise<void> {
    const { user } = await this.api.completeSetup(email, displayName, password);
    this.user.set(user);
  }

  async logout(): Promise<void> {
    await this.api.logout();
    this.user.set(null);
  }

  private async resolveWhenSignedOut(): Promise<'app' | 'login' | 'setup'> {
    try {
      const { user } = await this.api.refresh();
      this.user.set(user);
      return 'app';
    } catch {
      const { needsSetup } = await this.api.getSetupStatus();
      return needsSetup ? 'setup' : 'login';
    }
  }
}
