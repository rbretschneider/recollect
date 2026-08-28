import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

let toastSeq = 0;

/**
 * App-wide transient feedback — the completion/failure half of the three-signal
 * rule. `success()` confirms an action landed; `error()` reports one that didn't
 * and can carry a Retry. Errors linger longer and never auto-dismiss while a
 * retry is offered, so the user can act on them.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  success(message: string): void {
    this.push({ kind: 'success', message });
  }

  /** Report a failed action; pass an action to offer a one-tap Retry. */
  error(message: string, action?: ToastAction): void {
    this.push({ kind: 'error', message, action });
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(partial: Omit<Toast, 'id'>): void {
    const toast: Toast = { ...partial, id: toastSeq++ };
    this.toasts.update((list) => [...list, toast]);
    // Success is disposable; an error with a retry stays until acted on.
    if (toast.kind === 'success') {
      setTimeout(() => this.dismiss(toast.id), 3200);
    } else if (!toast.action) {
      setTimeout(() => this.dismiss(toast.id), 6000);
    }
  }
}
