import { Component, input, output } from '@angular/core';

/**
 * THE selection action bar. Any grid that lets you pick photos — the timeline,
 * search results, a person — floats this same bar, so "what can I do with
 * these?" has one answer and one shape everywhere in the app.
 *
 * It owns no selection state: the host page keeps that (grids differ — the
 * timeline also selects whole days) and passes down only the count. Filing
 * goes through the shared pickers, which both create-on-demand, so there is no
 * separate "new album" or "new memory" button to get wrong.
 */
@Component({
  selector: 'app-selection-bar',
  template: `
    <div class="action-bar" role="toolbar" aria-label="Selection actions">
      <button type="button" (click)="addToAlbum.emit()">Add to album</button>
      <button type="button" (click)="addToMemory.emit()">Add to memory</button>
      @if (canDelete()) {
        <button type="button" class="danger" (click)="deleteSelected.emit()">Move to Trash</button>
      }
    </div>
  `,
  styleUrl: './selection-bar.scss',
})
export class SelectionBar {
  /** Whether to offer the destructive action; the delete grant decides. */
  readonly canDelete = input(false);

  readonly addToAlbum = output<void>();
  readonly addToMemory = output<void>();
  readonly deleteSelected = output<void>();
}
