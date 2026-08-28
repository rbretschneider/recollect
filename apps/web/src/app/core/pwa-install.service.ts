import { Injectable, signal } from '@angular/core';

/** Chrome's deferred install prompt (not in the standard lib types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Captures the browser's PWA install prompt so the drawer can offer a real
 * "Install app" button. Chrome/Edge/Android fire beforeinstallprompt; iOS
 * Safari never does (there it's Share → Add to Home Screen).
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** True while the browser is offering installation and we've captured it. */
  readonly canInstall = signal(false);

  /** True when already running as an installed app. */
  get isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  }

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    });
  }

  async install(): Promise<void> {
    const prompt = this.deferredPrompt;
    if (!prompt) {
      return;
    }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    }
  }
}
