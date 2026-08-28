import { Component } from '@angular/core';
import { ActivitySpinner } from './activity-spinner';
import { Brand } from './brand';

/**
 * The persistent app header: brand (opens the left drawer), live activity,
 * and projected page actions. The bottom nav says where you are; this bar
 * stays the same everywhere.
 */
@Component({
  selector: 'app-topbar',
  imports: [ActivitySpinner, Brand],
  template: `
    <header class="topbar">
      <app-brand />
      <app-activity-spinner />
      <span class="spacer"></span>
      <ng-content />
    </header>
  `,
  styles: `
    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      min-width: 0;
    }

    .spacer {
      flex: 1;
    }
  `,
})
export class AppTopbar {}
