import { AssetDetail, TimelineAsset, toViewerAsset, UserProfile } from '../../core/api/api-models';

/** Spec fixtures shared by the panel, viewer and slideshow tests. */

export const FIXTURE_ASSET: TimelineAsset = toViewerAsset('asset-1', 'image', '2021-09-25T10:30:00.000Z');

/** A fully-populated record, so every row of the panel renders. */
export const FIXTURE_DETAIL: AssetDetail = {
  id: 'asset-1',
  mediaType: 'image',
  mime: 'image/jpeg',
  title: 'Summit at dawn',
  capturedAt: '2021-09-25T10:30:00.000Z',
  capturedAtSource: 'exif',
  width: 4000,
  height: 3000,
  durationMs: null,
  cameraMake: 'Fuji',
  cameraModel: 'X100V',
  lensModel: null,
  takenBy: 'Alex',
  takenByPersonId: 'person-1',
  uploadedByGuest: null,
  isPhotosphere: false,
  motionPhoto: false,
  isFavorite: false,
  gpsLat: 44.3386,
  gpsLon: -68.2733,
  relPath: 'trips/acadia/summit.jpg',
  rootId: 'root-1',
  sizeBytes: 3 * 1024 * 1024,
  hasThumbnail: true,
  stageErrors: null,
};

export function userWithPermission(permission: UserProfile['permission']): UserProfile {
  return {
    id: 'user-1',
    email: 't@example.com',
    displayName: 'Test',
    permission,
    isAdmin: false,
    mustChangePassword: false,
    personId: null,
  };
}
