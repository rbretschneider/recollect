import { Injectable, signal } from '@angular/core';

/** What a confirmation drawer should say. */
export interface ConfirmRequest {
  title: string;
  message: string;
  /** Label on the confirming button, e.g. "Delete album". */
  confirmLabel: string;
  /** Styles the confirm button as destructive. Defaults to true. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

/**
 * App-wide confirmation drawer. Every deletion — permanent or staged via
 * Trash — must pass through ask() before calling the API; the drawer itself
 * is rendered once at the app root.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  /** Resolves true only when the user taps the confirming button. */
  ask(request: ConfirmRequest): Promise<boolean> {
    // A second ask while one is open auto-cancels the first (shouldn't happen).
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...request, resolve }));
  }

  settle(confirmed: boolean): void {
    const pending = this.pending();
    this.pending.set(null);
    pending?.resolve(confirmed);
  }
}
