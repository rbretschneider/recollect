import { Injectable, signal } from '@angular/core';

/**
 * Bridge to the `<pwa-install>` web component (wrapped by PwaInstall,
 * mounted once at the app root). The wrapper registers its element here;
 * any UI — the drawer's "Install app" button — calls prompt() to open the
 * guided dialog: a native install prompt on Chromium/Android, an
 * illustrated "Share → Add to Home Screen" walkthrough on iOS Safari.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private element: {
    showDialog: (forced?: boolean) => void;
    isUnderStandaloneMode?: boolean;
  } | null = null;

  /** True when an install can be offered — false once already installed. */
  readonly canPrompt = signal(false);

  register(el: { showDialog: (forced?: boolean) => void; isUnderStandaloneMode?: boolean }): void {
    this.element = el;
    // Don't offer Install when the app is already running installed — check the
    // display mode directly (the web component's own flag isn't reliably set at
    // registration), covering Android/desktop standalone and iOS home-screen.
    this.canPrompt.set(!isRunningStandalone() && !el.isUnderStandaloneMode);
  }

  /** Opens the install helper, even after a prior dismissal. */
  prompt(): void {
    this.element?.showDialog(true);
  }

  markInstalled(): void {
    this.canPrompt.set(false);
  }
}

/** True when the page is already running as an installed PWA. */
function isRunningStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      // iOS Safari's non-standard flag for home-screen apps.
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
