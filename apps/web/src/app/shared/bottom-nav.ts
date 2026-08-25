import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The app-wide bottom navigation (Photos · Memories · Search). */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="bottomnav" aria-label="Main">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
        Photos
      </a>
      <a routerLink="/memories" routerLinkActive="active">Memories</a>
      <button type="button" disabled title="Coming soon">Search</button>
    </nav>
  `,
  styleUrl: './bottom-nav.scss',
})
export class BottomNav {}
