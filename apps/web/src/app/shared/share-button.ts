import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SharingApiService } from '../core/api/sharing-api.service';
import { ShareLinkView } from '../core/api/api-models';
import { ConfirmService } from './confirm.service';
import { ToastService } from './toast.service';
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
  private readonly toasts = inject(ToastService);

  readonly targetType = input.required<'memory' | 'album' | 'asset'>();
  readonly targetId = input.required<string>();
  /** For memories: whether the shared page includes journal text. */
  readonly includeJournal = input<boolean>(false);
  /** 'overlay': circular chrome; 'icon': bordered icon; 'labeled': icon over a tiny label. */
  readonly variant = input<'button' | 'overlay' | 'icon' | 'labeled'>('button');
  /** Fires after any share change (create / revoke / extend) so hosts can
   *  refresh their own "publicly shared" badge. */
  readonly changed = output<void>();

  /** Human word for the sheet copy — "asset" is engineer-speak. */
  get targetLabel(): string {
    return this.targetType() === 'asset' ? 'photo' : this.targetType();
  }

  readonly isOpen = signal(false);
  readonly links = signal<ShareLinkView[]>([]);
  readonly isBusy = signal(false);
  readonly copiedLinkId = signal<string | null>(null);

  /** Already public? Then the sheet manages the link — it never offers "create". */
  readonly isShared = computed(() => this.links().length > 0);

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

  /**
   * The single, deliberate action that makes this content public - and it
   * puts the link on the clipboard in the same tap, because "create, then
   * find the Copy button" is two taps for the one thing anyone wants next.
   *
   * The link doesn't exist until the server answers, and iOS Safari only lets a
   * page write the clipboard inside the tap itself, not after an await. Its
   * sanctioned way round that is a ClipboardItem whose text is a promise:
   * the write starts synchronously in the gesture and is filled in when the
   * request returns. Browsers that don't take a promise there fall through to a
   * plain write after the fact, which they allow. If neither works, the Copy
   * button is still there as it always was.
   */
  async createLink(): Promise<void> {
    this.isBusy.set(true);
    const created = this.api.createLink(
      this.targetType(),
      this.targetId(),
      this.includeJournal(),
      this.selectedExpiryHours,
    );
    let copied = false;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const text = created.then(({ link }) => new Blob([this.urlFor(link)], { type: 'text/plain' }));
        text.catch(() => undefined); // a failed create is reported below, not as an unhandled rejection here
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
        copied = true;
      }
    } catch {
      // Fall through - some browsers reject a promise-valued item.
    }
    try {
      const { link } = await created;
      if (!copied) {
        try {
          await navigator.clipboard.writeText(this.urlFor(link));
          copied = true;
        } catch {
          // No clipboard access; the Copy button remains.
        }
      }
      this.links.update((existing) => [link, ...existing]);
      this.changed.emit();
      if (copied) {
        this.toasts.success('Link copied — ready to paste.');
        this.copiedLinkId.set(link.id);
        setTimeout(() => this.copiedLinkId.set(null), 2000);
      }
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Extend / change an existing link's expiration — no new link is made. */
  async extend(link: ShareLinkView): Promise<void> {
    this.isBusy.set(true);
    try {
      const { link: updated } = await this.api.updateExpiry(link.id, this.selectedExpiryHours);
      this.links.update((existing) => existing.map((item) => (item.id === updated.id ? updated : item)));
      this.changed.emit();
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
    this.changed.emit();
  }

  async copy(link: ShareLinkView): Promise<void> {
    await navigator.clipboard.writeText(this.urlFor(link));
    this.copiedLinkId.set(link.id);
    setTimeout(() => this.copiedLinkId.set(null), 2000);
  }
}
