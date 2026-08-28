import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountBadge } from './account-badge';
import { ActivitySpinner } from './activity-spinner';
import { Brand } from './brand';
import { Icon } from './icon';

/**
 * The persistent app header: brand (opens the left drawer), a centered
 * search pill, live activity, projected page actions, and the account
 * badge top-right. This bar stays the same everywhere.
 */
@Component({
  selector: 'app-topbar',
  imports: [AccountBadge, ActivitySpinner, Brand, Icon, RouterLink],
  template: `
    <header class="topbar">
      <app-brand />
      <app-activity-spinner />
      <a class="search-pill" routerLink="/search" aria-label="Search">
        <app-icon name="search" [size]="17" />
        <span>Search</span>
      </a>
      <ng-content />
      <app-account-badge />
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

    .search-pill {
      flex: 1;
      min-width: 0;
      max-width: 26rem;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-height: 38px;
      border: 1px solid var(--border);
      border-radius: 2rem;
      background: var(--surface);
      color: var(--text-muted);
      font-size: 0.9rem;
      text-decoration: none;
      transition: background-color 0.15s ease;

      &:hover {
        background: var(--surface-raised);
      }
    }
  `,
})
export class AppTopbar {}
