import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharingApiService } from '../core/api/sharing-api.service';
import { ShareLinkView } from '../core/api/api-models';
import { ConfirmService } from './confirm.service';
import { Icon } from './icon';
import { Sheet } from './sheet';

/** Expiration choices offered when making something public. */
const EXPIRY_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: 'Until turned off', hours: null },
] as const;

/**
 * Sharing control. Everything is private until the user explicitly creates a
 * public link here — choosing an expiration first. Existing links are listed
 * with their expiry and view count, and can be turned off at any time.
 * All public views are read-only.
 */
@Component({
  selector: 'app-share-button',
  imports: [FormsModule, Icon, Sheet],
  templateUrl: './share-button.html',
  styleUrl: './share-button.scss',
})
export class ShareButton {
  private readonly api = inject(SharingApiService);
  private readonly confirms = inject(ConfirmService);

  readonly targetType = input.required<'memory' | 'album'>();
  readonly targetId = input.required<string>();
  /** For memories: whether the shared page includes journal text. */
  readonly includeJournal = input<boolean>(false);
  /** 'overlay': circular chrome for photo heroes; 'icon': bordered icon for action rows. */
  readonly variant = input<'button' | 'overlay' | 'icon'>('button');

  readonly isOpen = signal(false);
  readonly links = signal<ShareLinkView[]>([]);
  readonly isBusy = signal(false);
  readonly copiedLinkId = signal<string | null>(null);

  readonly expiryOptions = EXPIRY_OPTIONS;
  selectedExpiryHours: number | null = 24 * 7;

  async open(): Promise<void> {
    this.isOpen.set(true);
    const { links } = await this.api.listFor(this.targetType(), this.targetId());
    this.links.set(links);
  }

  close(): void {
    this.isOpen.set(false);
  }

  urlFor(link: ShareLinkView): string {
    return `${location.origin}/s/${link.token}`;
  }

  expiryLabel(link: ShareLinkView): string {
    if (link.expiresAt === null) {
      return 'No expiration';
    }
    const remaining = new Date(link.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      return 'Expired';
    }
    const hours = Math.round(remaining / (60 * 60 * 1000));
    return hours < 48 ? `Expires in ${hours}h` : `Expires in ${Math.round(hours / 24)} days`;
  }

  /** The single, deliberate action that makes this content public. */
  async createLink(): Promise<void> {
    this.isBusy.set(true);
    try {
      const { link } = await this.api.createLink(
        this.targetType(),
        this.targetId(),
        this.includeJournal(),
        this.selectedExpiryHours,
      );
      this.links.update((existing) => [link, ...existing]);
    } finally {
      this.isBusy.set(false);
    }
  }

  async turnOff(link: ShareLinkView): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: 'Turn off this link?',
      message: 'Anyone with the link loses access immediately. This link can never be turned back on — you can always create a new one.',
      confirmLabel: 'Turn off',
    });
    if (!confirmed) {
      return;
    }
    await this.api.revoke(link.id);
    this.links.update((existing) => existing.filter((item) => item.id !== link.id));
  }

  async copy(link: ShareLinkView): Promise<void> {
    await navigator.clipboard.writeText(this.urlFor(link));
    this.copiedLinkId.set(link.id);
    setTimeout(() => this.copiedLinkId.set(null), 2000);
  }
}
