import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStateService } from '../../core/auth/auth-state.service';

/** Sign-in page. */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: '../setup/setup-page.scss',
})
export class LoginPage implements OnInit {
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly http = inject(HttpClient);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Self-service reset needs SMTP; hide the link when the server can't email. */
  readonly canResetPassword = signal(false);

  email = '';
  password = '';

  ngOnInit(): void {
    void firstValueFrom(
      this.http.get<{ available: boolean }>('/api/v1/auth/password/forgot'),
    )
      .then((result) => this.canResetPassword.set(result.available))
      .catch(() => this.canResetPassword.set(false));
  }

  async signIn(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.email, this.password);
      // An admin-reset account must pick its own password before anything else.
      if (this.auth.user()?.mustChangePassword) {
        await this.router.navigateByUrl('/change-password');
      } else {
        await this.router.navigateByUrl(this.safeReturnUrl());
      }
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

  /** Only ever a same-origin app path — never an open redirect off-site. */
  private safeReturnUrl(): string {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  }
}
