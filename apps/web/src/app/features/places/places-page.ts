import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PlacesApiService, PlaceView } from '../../core/api/places-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AvatarMenu } from '../../shared/avatar-menu';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';
import { SafeResourcePipe } from '../../shared/safe-resource.pipe';
import { AssetViewer } from '../viewer/asset-viewer';

/**
 * Places (Google Photos-style): every geocoded spot as a cover card, drilling
 * into that place's photos with a map. Driven by ?place=<label>.
 */
@Component({
  selector: 'app-places-page',
  imports: [AvatarMenu, BackButton, AssetViewer, BottomNav, PageLoading, SafeResourcePipe],
  templateUrl: './places-page.html',
  styleUrl: './places-page.scss',
})
export class PlacesPage implements OnInit {
  private readonly api = inject(PlacesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly places = signal<PlaceView[]>([]);
  readonly isLoaded = signal(false);
  readonly selectedLabel = signal<string | null>(null);
  readonly placeAssets = signal<TimelineAsset[]>([]);
  readonly isLoadingPlace = signal(false);
  readonly viewerIndex = signal<number | null>(null);

  readonly selectedPlace = computed(() =>
    this.places().find((place) => place.label === this.selectedLabel()),
  );

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const label = params.get('place');
      this.selectedLabel.set(label);
      if (label) {
        void this.loadPlace(label);
      }
    });
    void this.load();
  }

  thumbUrl(assetId: string, size: 240 | 720 = 240): string {
    return `/api/v1/assets/${assetId}/thumb/${size}`;
  }

  openPlace(place: PlaceView): void {
    void this.router.navigate([], { queryParams: { place: place.label } });
  }

  mapEmbedUrl(place: PlaceView): string {
    const delta = 0.03;
    const bbox = [
      place.gpsLon - delta,
      place.gpsLat - delta,
      place.gpsLon + delta,
      place.gpsLat + delta,
    ].join('%2C');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${place.gpsLat}%2C${place.gpsLon}`;
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  onViewerDeleted(assetId: string): void {
    this.placeAssets.update((assets) => assets.filter((asset) => asset.id !== assetId));
  }

  private async load(): Promise<void> {
    const { places } = await this.api.list();
    this.places.set(places);
    this.isLoaded.set(true);
  }

  private async loadPlace(label: string): Promise<void> {
    this.isLoadingPlace.set(true);
    this.placeAssets.set([]);
    try {
      const { items } = await this.api.getAssets(label);
      // Ignore late responses after the user has moved on to another place.
      if (this.selectedLabel() === label) {
        this.placeAssets.set(items);
      }
    } finally {
      this.isLoadingPlace.set(false);
    }
  }
}
