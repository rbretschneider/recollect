import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';

/**
 * Change your password. Reached voluntarily from Settings, or forcibly right
 * after login when an admin reset the account (mustChangePassword) — in that
 * state the server refuses everything else until this succeeds.
 */
@Component({
  selector: 'app-change-password-page',
  imports: [FormsModule],
  templateUrl: './change-password-page.html',
  styleUrl: './change-password-page.scss',
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  readonly isBusy = signal(false);
  readonly error = signal<string | null>(null);

  get isForced(): boolean {
    return this.auth.user()?.mustChangePassword === true;
  }

  get canSubmit(): boolean {
    return (
      this.currentPassword.length > 0 &&
      this.newPassword.length >= 8 &&
      this.newPassword === this.confirmPassword &&
      !this.isBusy()
    );
  }

  async submit(): Promise<void> {
    if (!this.canSubmit) {
      return;
    }
    this.isBusy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      await this.router.navigateByUrl('/');
    } catch (raw) {
      const error = raw as { status?: number; error?: { message?: string } };
      this.error.set(
        error?.status === 401
          ? 'Current password is incorrect.'
          : (error?.error?.message ?? 'Something went wrong — try again.'),
      );
    } finally {
      this.isBusy.set(false);
    }
  }
}
