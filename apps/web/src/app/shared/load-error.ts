import { Component, input, output } from '@angular/core';

/**
 * The failure half of a page load. Show this whenever a load() rejects, so a
 * backend hiccup reads as "couldn't load — try again" instead of an endless
 * spinner or a misleading empty state. Give it (retry) to wire the button.
 */
@Component({
  selector: 'app-load-error',
  template: `
    <div class="load-error" role="alert">
      <p class="msg">{{ message() }}</p>
      <button type="button" class="retry" (click)="retry.emit()">Try again</button>
    </div>
  `,
  styleUrl: './load-error.scss',
})
export class LoadError {
  readonly message = input('Something went wrong loading this.');
  readonly retry = output<void>();
}
