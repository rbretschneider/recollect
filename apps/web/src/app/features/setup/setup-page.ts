import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LibraryApiService } from '../../core/api/library-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';

/** First-run wizard: create the admin account, then point Recollect at a photo folder. */
@Component({
  selector: 'app-setup-page',
  imports: [FormsModule],
  templateUrl: './setup-page.html',
  styleUrl: './setup-page.scss',
})
export class SetupPage {
  private readonly auth = inject(AuthStateService);
  private readonly library = inject(LibraryApiService);
  private readonly router = inject(Router);

  readonly step = signal<1 | 2>(1);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  displayName = '';
  email = '';
  password = '';
  libraryPath = '';

  async createAccount(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.completeSetup(this.email, this.displayName, this.password);
      this.step.set(2);
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not create the account.'));
    } finally {
      this.busy.set(false);
    }
  }

  async addLibrary(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.library.createRoot(this.libraryPath, 'Photos');
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not add that folder.'));
    } finally {
      this.busy.set(false);
    }
  }

  async skipLibrary(): Promise<void> {
    await this.router.navigateByUrl('/');
  }

  private messageFrom(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: string | string[] } })?.error?.message;
    if (Array.isArray(message)) {
      return message[0] ?? fallback;
    }
    return message ?? fallback;
  }
}
