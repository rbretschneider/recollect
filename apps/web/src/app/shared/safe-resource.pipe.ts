import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Marks an app-constructed URL as safe for a resource context (iframe src).
 * Only ever use with URLs the app builds itself — never raw user input.
 */
@Pipe({ name: 'safeResource' })
export class SafeResourcePipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
