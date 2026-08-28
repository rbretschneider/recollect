import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UserProfile } from './api-models';

/** Raw HTTP calls for setup and session endpoints. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  getSetupStatus(): Promise<{ needsSetup: boolean }> {
    return firstValueFrom(this.http.get<{ needsSetup: boolean }>('/api/v1/setup/status'));
  }

  completeSetup(email: string, displayName: string, password: string): Promise<{ user: UserProfile }> {
    return firstValueFrom(
      this.http.post<{ user: UserProfile }>('/api/v1/setup', { email, displayName, password }),
    );
  }

  login(email: string, password: string): Promise<{ user: UserProfile }> {
    return firstValueFrom(
      this.http.post<{ user: UserProfile }>('/api/v1/auth/login', { email, password }),
    );
  }

  me(): Promise<{ user: UserProfile }> {
    return firstValueFrom(this.http.get<{ user: UserProfile }>('/api/v1/auth/me'));
  }

  refresh(): Promise<{ user: UserProfile }> {
    return firstValueFrom(this.http.post<{ user: UserProfile }>('/api/v1/auth/refresh', {}));
  }

  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/logout', {}));
  }

  changePassword(currentPassword: string, newPassword: string): Promise<{ user: UserProfile }> {
    return firstValueFrom(
      this.http.post<{ user: UserProfile }>('/api/v1/auth/password', {
        currentPassword,
        newPassword,
      }),
    );
  }

  /** Revokes every session on every device, this one included. */
  logoutAll(): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/v1/auth/logout-all', {}));
  }

  /** Admin: reset a member's password; they must choose a new one at next login. */
  resetMemberPassword(userId: string, password: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`/api/v1/auth/users/${userId}/password`, { password }),
    );
  }
}
