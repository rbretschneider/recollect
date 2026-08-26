import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Raw HTTP calls for self-hosting introspection (admin). */
@Injectable({ providedIn: 'root' })
export class SystemApiService {
  private readonly http = inject(HttpClient);

  /** URL that downloads the current log file. */
  readonly logDownloadUrl = '/api/v1/system/logs/download';

  tailLogs(lines: number): Promise<{ lines: string[] }> {
    const params = new HttpParams().set('lines', lines);
    return firstValueFrom(this.http.get<{ lines: string[] }>('/api/v1/system/logs', { params }));
  }
}
