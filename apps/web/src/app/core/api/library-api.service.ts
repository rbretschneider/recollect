import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BrowseListing, LibraryFailure, LibraryRootView, LibraryStatus } from './api-models';

/** Mirrors the server's schedule response. */
export interface ScanScheduleView {
  schedule: {
    mode: 'off' | 'interval' | 'daily' | 'weekly';
    time: string;
    weekday: number;
  };
  nextRunAt: string | null;
  serverTimeZone: string;
}

/** Raw HTTP calls for library roots and indexing status. */
@Injectable({ providedIn: 'root' })
export class LibraryApiService {
  private readonly http = inject(HttpClient);

  listRoots(): Promise<{ roots: LibraryRootView[] }> {
    return firstValueFrom(this.http.get<{ roots: LibraryRootView[] }>('/api/v1/library/roots'));
  }

  createRoot(path: string, name: string): Promise<{ root: LibraryRootView }> {
    return firstValueFrom(
      this.http.post<{ root: LibraryRootView }>('/api/v1/library/roots', { path, name }),
    );
  }

  getStatus(): Promise<LibraryStatus> {
    return firstValueFrom(this.http.get<LibraryStatus>('/api/v1/library/status'));
  }

  rescan(rootId: string): Promise<{ accepted: true }> {
    return firstValueFrom(
      this.http.post<{ accepted: true }>(`/api/v1/library/roots/${rootId}/scan`, {}),
    );
  }

  getSchedule(): Promise<ScanScheduleView> {
    return firstValueFrom(this.http.get<ScanScheduleView>('/api/v1/library/schedule'));
  }

  setSchedule(schedule: ScanScheduleView['schedule']): Promise<ScanScheduleView> {
    return firstValueFrom(
      this.http.patch<ScanScheduleView>('/api/v1/library/schedule', schedule),
    );
  }

  cancelScan(): Promise<{ canceled: number }> {
    return firstValueFrom(this.http.post<{ canceled: number }>('/api/v1/library/scan/cancel', {}));
  }

  removeRoot(rootId: string): Promise<{ affectedAssets: number }> {
    return firstValueFrom(
      this.http.delete<{ affectedAssets: number }>(`/api/v1/library/roots/${rootId}`),
    );
  }

  setRootEnabled(rootId: string, enabled: boolean): Promise<{ root: LibraryRootView }> {
    return firstValueFrom(
      this.http.patch<{ root: LibraryRootView }>(`/api/v1/library/roots/${rootId}`, { enabled }),
    );
  }

  listFailures(): Promise<{ failures: LibraryFailure[] }> {
    return firstValueFrom(
      this.http.get<{ failures: LibraryFailure[] }>('/api/v1/library/failures'),
    );
  }

  /** Folder picker over the server's mounted library volumes (admin). */
  browse(path?: string): Promise<BrowseListing> {
    let params = new HttpParams();
    if (path) {
      params = params.set('path', path);
    }
    return firstValueFrom(this.http.get<BrowseListing>('/api/v1/library/browse', { params }));
  }
}
