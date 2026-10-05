import { Component, input } from '@angular/core';

/**
 * THE selection action bar: the floating strip that appears once photos are
 * picked. Any grid that can select — the timeline, search results, a memory —
 * uses this one shell, so "what can I do with these?" always appears in the
 * same place, in the same shape.
 *
 * It owns no state and no verbs. Hosts project their own buttons, because the
 * answer differs by surface: the timeline files and trashes, a memory captions
 * and removes. What stays constant is where the answer appears.
 */
@Component({
  selector: 'app-selection-bar',
  template: `
    <div class="action-bar" role="toolbar" [attr.aria-label]="label()">
      <ng-content />
    </div>
  `,
  styleUrl: './selection-bar.scss',
})
export class SelectionBar {
  readonly label = input<string>('Selection actions');
}
