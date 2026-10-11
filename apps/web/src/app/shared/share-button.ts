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
  /** Empty only for things that have no row until someone asks — see `resolveTarget`. */
  readonly targetId = input<string>('');
  /**
   * Called the first time a PUBLIC link is actually needed, for content that
   * is computed rather than stored. A look-back has no row to point a token
   * at, so one is materialised on demand — but only when someone chooses to
   * expose it, never just to send the family a link.
   */
  readonly resolveTarget = input<(() => Promise<string>) | null>(null);
  /**
   * Where a signed-in household member should land. Derived from the target
   * for the things that have their own route; passed explicitly for the ones
   * that don't, like a look-back.
   */
  readonly internalPath = input<string | null>(null);
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

  /** A target materialised by `resolveTarget`; empty until one is needed. */
  private readonly resolvedId = signal('');
  private readonly effectiveId = computed(() => this.resolvedId() || this.targetId());

  /** How the household link fared — the sheet says so rather than a toast. */
  readonly internalCopied = signal<'copied' | 'failed' | null>(null);

  /**
   * The link for someone who already has an account. It is just an app URL:
   * every route is behind the auth guard, which carries a returnUrl through
   * sign-in, so they land exactly here. Nothing is exposed, nothing is minted,
   * and there is nothing to revoke afterwards.
   */
  readonly internalUrl = computed(() => {
    const explicit = this.internalPath();
    if (explicit) {
      return `${location.origin}${explicit}`;
    }
    const id = this.effectiveId();
    switch (this.targetType()) {
      case 'memory':
        return `${location.origin}/memories/${id}`;
      case 'album':
        return `${location.origin}/albums/${id}`;
      default:
        return `${location.origin}/photos?asset=${id}`;
    }
  });

  /** Already public? Then the sheet manages the link — it never offers "create". */
  readonly isShared = computed(() => this.links().length > 0);

  readonly expiryOptions = EXPIRY_OPTIONS;
  selectedExpiryHours: number | null = 24 * 7;

  /**
   * Opens the sheet. Nothing is copied.
   *
   * This used to put the household link straight on the clipboard to save a
   * tap, and it backfired: Android answers every clipboard write with a system
   * toast pinned to the bottom of the screen, which landed squarely on top of
   * "Create public link" and the labels explaining it. The one rule in this
   * panel now is that nothing reaches the clipboard until someone taps Copy.
   */
  async open(): Promise<void> {
    this.isOpen.set(true);
    this.internalCopied.set(null);
    const id = this.effectiveId();
    // Nothing is shared yet for a target that does not exist; don't ask.
    if (id) {
      const { links } = await this.api.listFor(this.targetType(), id);
      this.links.set(links);
    }
  }

  /** Copies the household link — only ever from the Copy button's own tap. */
  async copyInternal(): Promise<void> {
    const url = this.internalUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.internalCopied.set('copied');
    } catch {
      // No clipboard access (insecure origin, permissions): the sheet shows
      // the URL in a selectable field, so this is a downgrade, not a dead end.
      this.internalCopied.set('failed');
    }
  }

  /**
   * The phone route: hands the link to the OS share sheet, straight into
   * Messages, rather than going via the clipboard at all.
   */
  get canSendNatively(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  async sendInternal(): Promise<void> {
    try {
      await navigator.share({ url: this.internalUrl() });
    } catch {
      // Dismissed, or unavailable after all. The URL is on screen either way,
      // with Copy next to it.
    }
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
   * The single, deliberate action that makes this content public.
   *
   * It no longer copies the new link for you. Saving that one tap cost a whole
   * Android system clipboard toast parked over this very row, hiding the link
   * it had just made and the controls around it. The link appears in the panel
   * with Copy beside it, and copying is the user's tap to make.
   */
  async createLink(): Promise<void> {
    this.isBusy.set(true);
    try {
      // Materialising happens here and only here: choosing to expose something
      // is what creates the album a look-back needs, not merely opening this.
      const id = await this.ensureTarget();
      const { link } = await this.api.createLink(
        this.targetType(),
        id,
        this.includeJournal(),
        this.selectedExpiryHours,
      );
      this.links.update((existing) => [link, ...existing]);
      this.changed.emit();
      this.toasts.success('Public link created.');
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Resolves the public target, materialising it the first time it is needed. */
  private async ensureTarget(): Promise<string> {
    const existing = this.effectiveId();
    if (existing) {
      return existing;
    }
    const resolve = this.resolveTarget();
    if (!resolve) {
      throw new Error('This has nothing to share publicly.');
    }
    const id = await resolve();
    this.resolvedId.set(id);
    return id;
  }

  /**
   * Extend / change an existing link's expiration — no new link is made, and
   * nothing is copied: same rule as everywhere else in this panel.
   */
  async extend(link: ShareLinkView): Promise<void> {
    this.isBusy.set(true);
    try {
      const { link: updated } = await this.api.updateExpiry(link.id, this.selectedExpiryHours);
      this.links.update((existing) => existing.map((item) => (item.id === updated.id ? updated : item)));
      this.changed.emit();
      this.toasts.success('Expiration updated.');
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
    try {
      await navigator.clipboard.writeText(this.urlFor(link));
      this.copiedLinkId.set(link.id);
      setTimeout(() => this.copiedLinkId.set(null), 2000);
    } catch {
      // No clipboard access. The URL is on screen and selectable, and a
      // failed copy must not take down whatever asked for it.
    }
  }
}
