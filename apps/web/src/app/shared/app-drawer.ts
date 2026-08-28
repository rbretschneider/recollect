import { Component, ElementRef, HostListener, inject, OnInit, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActivityService } from '../core/activity.service';
import { LibraryApiService } from '../core/api/library-api.service';
import { LibraryFailure, LibraryStatus } from '../core/api/api-models';
import { AuthStateService } from '../core/auth/auth-state.service';
import { PwaInstallService } from '../core/pwa-install.service';
import { ActivitySpinner } from './activity-spinner';
import { OverlayFocus } from './overlay-focus.directive';

/**
 * The app side panel: account, library management, and destinations that don't
 * earn a bottom-nav slot (Trash, and future Faces/Places/Settings).
 */
@Component({
  selector: 'app-drawer',
  imports: [ActivitySpinner, RouterLink, OverlayFocus],
  templateUrl: './app-drawer.html',
  styleUrl: './app-drawer.scss',
})
export class AppDrawer implements OnInit {
  private readonly auth = inject(AuthStateService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly router = inject(Router);
  protected readonly activity = inject(ActivityService);
  protected readonly pwa = inject(PwaInstallService);

  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  readonly status = signal<LibraryStatus | null>(null);
  readonly isRescanBusy = signal(false);
  readonly failures = signal<LibraryFailure[] | null>(null);

  get userName(): string {
    return this.auth.user()?.displayName ?? '';
  }

  get userEmail(): string {
    return this.auth.user()?.email ?? '';
  }

  get userInitial(): string {
    return this.userName.charAt(0).toUpperCase();
  }

  get canDelete(): boolean {
    return this.auth.user()?.permission === 'delete';
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

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  private readonly host = inject(ElementRef<HTMLElement>);

  ngOnInit(): void {
    // Portal to <body> (same as app-sheet): hosted inside a topbar, the
    // backdrop-filter/z-index context breaks the fixed panel and scrim.
    document.body.appendChild(this.host.nativeElement);
    void this.loadStatus();
  }

  /** Loads (or hides) the plain-language list behind the failed count. */
  async toggleFailures(): Promise<void> {
    if (this.failures() !== null) {
      this.failures.set(null);
      return;
    }
    const { failures } = await this.libraryApi.listFailures();
    this.failures.set(failures);
  }

  async rescan(): Promise<void> {
    this.isRescanBusy.set(true);
    try {
      const { roots } = await this.libraryApi.listRoots();
      for (const root of roots) {
        await this.libraryApi.rescan(root.id);
      }
      await this.loadStatus();
    } finally {
      this.isRescanBusy.set(false);
    }
  }

  private async loadStatus(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      // The drawer stays useful without stats.
    }
  }
}
