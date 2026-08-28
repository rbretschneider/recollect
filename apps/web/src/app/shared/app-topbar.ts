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
  // .topbar is styled globally (styles.scss) so every page header — this bar
  // and each subpage's — shares one definition and the sheet-safe blur fix.
})
export class AppTopbar {}
