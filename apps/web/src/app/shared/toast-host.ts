import { Component, inject } from '@angular/core';
import { Icon } from './icon';
import { ToastService } from './toast.service';

/**
 * Renders the ToastService queue. Hosted once at the app root. Lives in an
 * aria-live region so screen readers hear completions and failures announced.
 */
@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  template: `
    <div class="toast-host" role="status" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [class.error]="toast.kind === 'error'">
          <span class="msg">{{ toast.message }}</span>
          @if (toast.action; as action) {
            <button type="button" class="action" (click)="action.run(); toasts.dismiss(toast.id)">
              {{ action.label }}
            </button>
          }
          <button type="button" class="close" aria-label="Dismiss" (click)="toasts.dismiss(toast.id)">
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast-host.scss',
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
}
