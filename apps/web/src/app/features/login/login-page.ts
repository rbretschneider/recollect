import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';

/** Sign-in page. */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login-page.html',
  styleUrl: '../setup/setup-page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  email = '';
  password = '';

  async signIn(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.email, this.password);
      // An admin-reset account must pick its own password before anything else.
      await this.router.navigateByUrl(
        this.auth.user()?.mustChangePassword ? '/change-password' : '/',
      );
    } catch (raw) {
      const status = (raw as { status?: number })?.status;
      const message = (raw as { error?: { message?: string } })?.error?.message;
      this.error.set(
        status === 429 && message ? message : 'That email or password is not right.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
