import { Component, inject } from '@angular/core';
import { ActivityService } from '../core/activity.service';

/**
 * A small live spinner shown only while background work is really running,
 * with the remaining count beside it. Renders nothing when the library is idle.
 */
@Component({
  selector: 'app-activity-spinner',
  template: `
    @if (activity.isWorking()) {
      <span class="activity" role="status" [attr.aria-label]="activity.progressLabel() + ' processing'">
        <span class="ring" aria-hidden="true"></span>
        <span class="count">{{ activity.progressLabel() }}</span>
      </span>
    }
  `,
  styles: `
    .activity {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.2rem 0.6rem;
      border-radius: 1rem;
      background: var(--surface-raised);
      border: 1px solid var(--border);
    }

    .ring {
      width: 0.85rem;
      height: 0.85rem;
      border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: activity-spin 0.9s linear infinite;
    }

    .count {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    // Narrow phones: the ring alone signals activity; the count needs too much room.
    @media (width < 460px) {
      .count {
        display: none;
      }
    }

    @keyframes activity-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class ActivitySpinner {
  protected readonly activity = inject(ActivityService);
}
