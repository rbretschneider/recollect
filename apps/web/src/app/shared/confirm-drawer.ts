import { Component, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';
import { Sheet } from './sheet';

/**
 * The confirmation that ConfirmService.ask() opens. Hosted once at the app
 * root; tapping the scrim, Escape, or Cancel resolves false, the action button
 * true. Chrome comes from the shared <app-sheet>, which focuses Cancel first.
 */
@Component({
  selector: 'app-confirm-drawer',
  imports: [Sheet],
  templateUrl: './confirm-drawer.html',
  styleUrl: './confirm-drawer.scss',
})
export class ConfirmDrawer {
  protected readonly confirms = inject(ConfirmService);
}
