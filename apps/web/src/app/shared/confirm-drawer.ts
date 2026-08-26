import { Component, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';

/**
 * The bottom-sheet that ConfirmService.ask() opens. Hosted once at the app
 * root; tapping the scrim or Cancel resolves false, the action button true.
 */
@Component({
  selector: 'app-confirm-drawer',
  templateUrl: './confirm-drawer.html',
  styleUrl: './confirm-drawer.scss',
})
export class ConfirmDrawer {
  protected readonly confirms = inject(ConfirmService);
}
