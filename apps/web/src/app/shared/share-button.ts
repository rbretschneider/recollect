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
  /** How the latest copy of a public link fared; null until one is attempted. */
  readonly copyState = signal<{ linkId: string; status: 'copied' | 'failed' } | null>(null);
  readonly copiedLinkId = computed(() => {
    const state = this.copyState();
    return state?.status === 'copied' ? state.linkId : null;
  });
  private copyAttempt = 0;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

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
   * "Create public link" and the labels explaining it. So opening never
   * copies; only an explicit Copy tap, or creating / updating a public link,
   * reaches the clipboard.
   */
  async open(): Promise<void> {
    this.isOpen.set(true);
    this.internalCopied.set(null);
    this.resetCopyState();
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
    this.resetCopyState();
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
   * The single, deliberate action that makes this content public. The new
   * link is also put on the clipboard; see `mutateAndCopy`.
   */
  async createLink(): Promise<void> {
    await this.mutateAndCopy(
      async () => {
        // Materialising happens here and only here: choosing to expose something
        // is what creates the album a look-back needs, not merely opening this.
        const id = await this.ensureTarget();
        return this.api.createLink(this.targetType(), id, this.includeJournal(), this.selectedExpiryHours);
      },
      (link) => {
        this.links.update((existing) => [link, ...existing]);
        this.changed.emit();
        this.toasts.success('Public link created.');
      },
    );
  }

  /**
   * Runs a link mutation and copies the resulting public URL.
   *
   * The clipboard write starts synchronously, inside the tap, with its text
   * supplied by a promise that settles only once the server has answered:
   * lazy targets await before the request, and Safari would otherwise treat a
   * later write as outside the user's gesture. Busy state follows the mutation
   * alone, so a pending clipboard prompt never holds the panel.
   */
  private async mutateAndCopy(
    mutate: () => Promise<{ link: ShareLinkView }>,
    onSuccess: (link: ShareLinkView) => void,
  ): Promise<void> {
    this.isBusy.set(true);
    this.resetCopyState();
    const attempt = this.copyAttempt;
    try {
      const pending = mutate();
      const outcome = this.beginCopy(pending.then(({ link }) => this.urlFor(link)));
      const { link } = await pending;
      onSuccess(link);
      void outcome.then((result) => {
        if (result !== 'skipped' && attempt === this.copyAttempt) {
          this.recordCopy(link.id, result);
        }
      });
    } finally {
      this.isBusy.set(false);
    }
  }

  /**
   * Starts writing to the clipboard now; the text arrives when `url` resolves.
   * Never rejects. 'skipped' means the mutation failed and nothing was written.
   */
  private async beginCopy(url: Promise<string>): Promise<'copied' | 'failed' | 'skipped'> {
    const settled = url.then(
      (text) => ({ text }),
      () => null,
    );
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (typeof ClipboardItem !== 'undefined' && typeof clipboard?.write === 'function') {
      try {
        const blob = url.then((text) => new Blob([text], { type: 'text/plain' }));
        blob.catch(() => undefined);
        await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        return 'copied';
      } catch {
        // Fall through: retry as plain text, but only if the mutation worked.
      }
    }
    const result = await settled;
    if (!result) {
      return 'skipped';
    }
    try {
      await clipboard.writeText(result.text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  private resetCopyState(): void {
    this.copyAttempt++;
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.copyState.set(null);
  }

  private recordCopy(linkId: string, status: 'copied' | 'failed'): void {
    this.copyState.set({ linkId, status });
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    if (status === 'copied') {
      const attempt = this.copyAttempt;
      this.copyTimer = setTimeout(() => {
        if (attempt === this.copyAttempt) {
          this.copyState.set(null);
        }
      }, 2000);
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
   * Extend / change an existing link's expiration — no new link is made. The
   * updated link's URL is copied, as on creation.
   */
  async extend(link: ShareLinkView): Promise<void> {
    await this.mutateAndCopy(
      () => this.api.updateExpiry(link.id, this.selectedExpiryHours),
      (updated) => {
        this.links.update((existing) => existing.map((item) => (item.id === updated.id ? updated : item)));
        this.changed.emit();
        this.toasts.success('Expiration updated.');
      },
    );
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
    this.resetCopyState();
    const attempt = this.copyAttempt;
    let status: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(this.urlFor(link));
    } catch {
      // No clipboard access. The URL is on screen and selectable, and a
      // failed copy must not take down whatever asked for it.
      status = 'failed';
    }
    if (attempt === this.copyAttempt) {
      this.recordCopy(link.id, status);
    }
  }
}
