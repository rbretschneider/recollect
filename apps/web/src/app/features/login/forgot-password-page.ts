import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

/**
 * Asks for a reset link. The confirmation is deliberately identical whether or
 * not the address has an account — anything else would let a stranger check who
 * is in the household.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './forgot-password-page.html',
  styleUrl: '../setup/setup-page.scss',
})
export class ForgotPasswordPage {
  private readonly http = inject(HttpClient);

  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  email = '';

  async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/v1/auth/password/forgot', { email: this.email }),
      );
      this.sent.set(true);
    } catch (raw) {
      const status = (raw as { status?: number })?.status;
      const message = (raw as { error?: { message?: string } })?.error?.message;
      this.error.set(
        status === 429 && message
          ? message
          : "Couldn't send that just now. Try again in a moment.",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
