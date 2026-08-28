import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
// Side-effect import: registers the <pwa-install> custom element.
import '@khmyznikov/pwa-install';
import { PwaInstallService } from '../core/pwa-install.service';

/**
 * Thin wrapper around khmyznikov's `<pwa-install>` Lit component — mounted
 * ONCE at the app root, manual-only (never nags). The drawer's Install
 * button opens it via {@link PwaInstallService}; the dialog itself handles
 * the platform split (native prompt vs. iOS add-to-home-screen walkthrough)
 * and reads name/icons from the manifest.
 */
@Component({
  selector: 'app-pwa-install',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <pwa-install
      #el
      manifest-url="/manifest.webmanifest"
      name="Recollect"
      description="The family's own photo home — photos, memories, and albums on your own server."
      icon="/icons/icon-192x192.png"
      use-local-storage
      manual-apple
      manual-chrome
      (pwa-install-success-event)="onInstalled()"
    ></pwa-install>
  `,
})
export class PwaInstall implements AfterViewInit {
  private readonly el =
    viewChild.required<ElementRef<{ showDialog: (forced?: boolean) => void }>>('el');
  private readonly svc = inject(PwaInstallService);

  ngAfterViewInit(): void {
    this.svc.register(this.el().nativeElement);
  }

  onInstalled(): void {
    this.svc.markInstalled();
  }
}
