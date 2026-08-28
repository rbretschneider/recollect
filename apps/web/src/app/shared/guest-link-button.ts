import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ContributionLinkView,
  ContributionsApiService,
} from '../core/api/contributions-api.service';
import { ConfirmService } from './confirm.service';
import { Icon } from './icon';
import { Sheet } from './sheet';

/** How long guests can keep adding photos. Events end; so do their links. */
const EXPIRY_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 24 * 3 },
  { label: '1 week', hours: 24 * 7 },
  { label: '1 month', hours: 24 * 30 },
] as const;

/**
 * Guest contributions control for an album: create/copy/turn off the upload
 * link. Guests never see the library — their photos wait in the review queue.
 */
@Component({
  selector: 'app-guest-link-button',
  imports: [FormsModule, Icon, Sheet],
  templateUrl: './guest-link-button.html',
  styleUrl: './guest-link-button.scss',
})
export class GuestLinkButton {
  private readonly api = inject(ContributionsApiService);
  private readonly confirms = inject(ConfirmService);

  readonly albumId = input.required<string>();

  readonly isOpen = signal(false);
  readonly links = signal<ContributionLinkView[]>([]);
  readonly isBusy = signal(false);
  readonly copiedLinkId = signal<string | null>(null);

  readonly expiryOptions = EXPIRY_OPTIONS;
  selectedExpiryHours = 24 * 7;
  poolView = true;

  async open(): Promise<void> {
    this.isOpen.set(true);
    const { links } = await this.api.listLinks(this.albumId());
    this.links.set(links);
  }

  close(): void {
    this.isOpen.set(false);
  }

  urlFor(link: ContributionLinkView): string {
    return `${location.origin}/c/${link.token}`;
  }

  expiryLabel(link: ContributionLinkView): string {
    const remaining = new Date(link.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      return 'Expired';
    }
    const hours = Math.round(remaining / (60 * 60 * 1000));
    return hours < 48 ? `Expires in ${hours}h` : `Expires in ${Math.round(hours / 24)} days`;
  }

  async createLink(): Promise<void> {
    this.isBusy.set(true);
    try {
      const { link } = await this.api.createLink(
        this.albumId(),
        this.poolView,
        this.selectedExpiryHours,
      );
      this.links.update((existing) => [link, ...existing]);
    } finally {
      this.isBusy.set(false);
    }
  }

  async turnOff(link: ContributionLinkView): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: 'Turn off this guest link?',
      message:
        'Guests with the link can no longer add photos. Photos already waiting for review are kept.',
      confirmLabel: 'Turn off',
    });
    if (!confirmed) {
      return;
    }
    await this.api.revoke(link.id);
    this.links.update((existing) => existing.filter((item) => item.id !== link.id));
  }

  async copy(link: ContributionLinkView): Promise<void> {
    await navigator.clipboard.writeText(this.urlFor(link));
    this.copiedLinkId.set(link.id);
    setTimeout(() => this.copiedLinkId.set(null), 2000);
  }
}
