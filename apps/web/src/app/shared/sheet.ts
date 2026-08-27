import { Component, HostListener, input, output } from '@angular/core';
import { Icon } from './icon';

/**
 * THE bottom sheet. Every modal surface in the app — pickers, forms,
 * option lists — projects its content into this one component so scrim,
 * entrance motion, header, and close behavior stay identical everywhere.
 * Render it inside an @if; it animates itself in via @starting-style.
 */
@Component({
  selector: 'app-sheet',
  imports: [Icon],
  template: `
    <div class="scrim" (click)="closed.emit()"></div>
    <div class="sheet" role="dialog" [attr.aria-label]="sheetTitle()">
      <div class="grabber" aria-hidden="true"></div>
      <header>
        <h2>{{ sheetTitle() }}</h2>
        <button type="button" class="close" aria-label="Close" (click)="closed.emit()">
          <app-icon name="close" [size]="18" />
        </button>
      </header>
      <div class="body">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './sheet.scss',
})
export class Sheet {
  readonly sheetTitle = input.required<string>();
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
