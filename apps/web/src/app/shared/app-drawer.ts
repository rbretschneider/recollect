import { Component, inject, OnInit, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LibraryApiService } from '../core/api/library-api.service';
import { LibraryStatus } from '../core/api/api-models';
import { AuthStateService } from '../core/auth/auth-state.service';

/**
 * The app side panel: account, library management, and destinations that don't
 * earn a bottom-nav slot (Trash, and future Faces/Places/Settings).
 */
@Component({
  selector: 'app-drawer',
  imports: [RouterLink],
  templateUrl: './app-drawer.html',
  styleUrl: './app-drawer.scss',
})
export class AppDrawer implements OnInit {
  private readonly auth = inject(AuthStateService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly router = inject(Router);

  readonly closed = output<void>();

  readonly status = signal<LibraryStatus | null>(null);
  readonly isRescanBusy = signal(false);

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

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    void this.loadStatus();
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

  async signOut(): Promise<void> {
    await this.auth.logout();
    this.closed.emit();
    await this.router.navigateByUrl('/login');
  }

  private async loadStatus(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      // The drawer stays useful without stats.
    }
  }
}
