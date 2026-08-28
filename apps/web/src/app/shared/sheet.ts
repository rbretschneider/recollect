import { Component, ElementRef, HostListener, inject, input, OnInit, output } from '@angular/core';
import { Icon } from './icon';
import { OverlayFocus } from './overlay-focus.directive';

let sheetSeq = 0;

/**
 * THE bottom sheet. Every modal surface in the app — pickers, forms,
 * option lists, confirmations — projects its content into this one component so
 * scrim, entrance motion, header, focus handling, and close behavior stay
 * identical everywhere. Render it inside an @if; it animates itself in via
 * @starting-style.
 */
@Component({
  selector: 'app-sheet',
  imports: [Icon, OverlayFocus],
  template: `
    <div class="scrim" (click)="closed.emit()"></div>
    <div
      class="sheet"
      [class.danger]="danger()"
      [class.wide]="wide()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [overlayFocus]="initialFocus()"
    >
      <div class="grabber" aria-hidden="true"></div>
      <header>
        <h2 [id]="titleId">{{ sheetTitle() }}</h2>
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
export class Sheet implements OnInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly sheetTitle = input.required<string>();
  /** CSS selector for the control to focus on open (e.g. a Cancel button). */
  readonly initialFocus = input<string>('');
  /** Tints the grabber/edge for destructive sheets. */
  readonly danger = input(false);
  /** Widens the panel for grid content (e.g. the photo picker). */
  readonly wide = input(false);
  readonly closed = output<void>();

  /** Stable id so the panel's aria-labelledby points at its own heading. */
  protected readonly titleId = `sheet-title-${sheetSeq++}`;

  ngOnInit(): void {
    // Portal to <body>: a host inside any stacking context (a z-indexed hero
    // button, a transformed card) would otherwise paint the sheet UNDER
    // fixed chrome like the bottom nav. Angular still owns the node, so
    // destroy/cleanup work unchanged.
    document.body.appendChild(this.host.nativeElement);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
