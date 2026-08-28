import { Component, ElementRef, HostListener, inject, OnInit, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStateService } from '../core/auth/auth-state.service';
import { PwaInstallService } from '../core/pwa-install.service';
import { OverlayFocus } from './overlay-focus.directive';

/**
 * The app side panel: account and the destinations. Kept deliberately short so
 * the whole list — and the install button anchoring the footer — stays on
 * screen; library stats and controls live on the Library page, not here.
 */
@Component({
  selector: 'app-drawer',
  imports: [RouterLink, OverlayFocus],
  templateUrl: './app-drawer.html',
  styleUrl: './app-drawer.scss',
})
export class AppDrawer implements OnInit {
  private readonly auth = inject(AuthStateService);
  protected readonly pwa = inject(PwaInstallService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

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

  ngOnInit(): void {
    // Portal to <body> (same as app-sheet): hosted inside a topbar, the
    // backdrop-filter/z-index context breaks the fixed panel and scrim.
    document.body.appendChild(this.host.nativeElement);
  }
}
