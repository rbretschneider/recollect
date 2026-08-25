import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LibraryRootView, LibraryStatus } from './api-models';

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
}
