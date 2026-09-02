import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

/** Where the emailed link lands: choose a new password, then sign in. */
@Component({
  selector: 'app-reset-password-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password-page.html',
  styleUrl: '../setup/setup-page.scss',
})
export class ResetPasswordPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasToken = signal(true);

  password = '';
  confirm = '';
  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.hasToken.set(this.token.length > 0);
  }

  async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (this.password.length < 8) {
      this.error.set('Use at least 8 characters.');
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set("Those two passwords don't match.");
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/v1/auth/password/reset', {
          token: this.token,
          password: this.password,
        }),
      );
      this.done.set(true);
    } catch (raw) {
      const message = (raw as { error?: { message?: string } })?.error?.message;
      this.error.set(message ?? "Couldn't reset your password. Ask for a fresh link.");
    } finally {
      this.busy.set(false);
    }
  }

  goToLogin(): void {
    void this.router.navigateByUrl('/login');
  }
}
