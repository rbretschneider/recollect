import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One camera seen in the library, with the Person (if any) it's mapped to. */
export interface DeviceView {
  cameraMake: string;
  cameraModel: string;
  assetCount: number;
  personId: string | null;
  personName: string | null;
}

/** Raw HTTP calls for camera→person mapping (admin). */
@Injectable({ providedIn: 'root' })
export class DevicesApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ devices: DeviceView[] }> {
    return firstValueFrom(this.http.get<{ devices: DeviceView[] }>('/api/v1/devices'));
  }

  setOwner(cameraMake: string, cameraModel: string, personId: string | null): Promise<void> {
    return firstValueFrom(
      this.http.put<void>('/api/v1/devices/owner', { cameraMake, cameraModel, personId }),
    );
  }
}
