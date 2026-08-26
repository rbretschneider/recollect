import { Component, inject, input, signal } from '@angular/core';
import { SharingApiService } from '../core/api/sharing-api.service';

/**
 * Creates (or reuses) a public share link for a memory or album and presents
 * the URL with one-tap copy. Anyone with the link can view — no account.
 */
@Component({
  selector: 'app-share-button',
  imports: [],
  templateUrl: './share-button.html',
  styleUrl: './share-button.scss',
})
export class ShareButton {
  private readonly api = inject(SharingApiService);

  readonly targetType = input.required<'memory' | 'album'>();
  readonly targetId = input.required<string>();
  /** For memories: whether the shared page includes journal text. */
  readonly includeJournal = input<boolean>(false);

  readonly shareUrl = signal<string | null>(null);
  readonly copied = signal(false);
  readonly isBusy = signal(false);

  async share(): Promise<void> {
    this.isBusy.set(true);
    try {
      const { links } = await this.api.listFor(this.targetType(), this.targetId());
      const link =
        links.find((existing) => existing.includeJournal === this.includeJournal()) ??
        (await this.api.createLink(this.targetType(), this.targetId(), this.includeJournal())).link;
      this.shareUrl.set(`${location.origin}/s/${link.token}`);
    } finally {
      this.isBusy.set(false);
    }
  }

  async copy(): Promise<void> {
    const url = this.shareUrl();
    if (!url) {
      return;
    }
    await navigator.clipboard.writeText(url);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  dismiss(): void {
    this.shareUrl.set(null);
  }
}
