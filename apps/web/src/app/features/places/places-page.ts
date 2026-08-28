import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { PlacesApiService, PlaceView } from '../../core/api/places-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { Icon } from '../../shared/icon';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';
import { SafeResourcePipe } from '../../shared/safe-resource.pipe';
import { AssetViewer } from '../viewer/asset-viewer';

const PLACES_VIEW_KEY = 'recollect.placesView';

/**
 * Places (Google Photos-style): every geocoded spot as a cover card OR as a
 * bubble map of where the whole library clusters, drilling into that place's
 * photos. Driven by ?place=<label>.
 */
@Component({
  selector: 'app-places-page',
  imports: [Icon, MenuButton, BackButton, AssetViewer, BottomNav, PageLoading, SafeResourcePipe],
  templateUrl: './places-page.html',
  styleUrl: './places-page.scss',
})
export class PlacesPage implements OnInit, OnDestroy {
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

  /** 'cards' (cover grid) or 'map' (bubble map of the whole library). */
  readonly viewMode = signal<'cards' | 'map'>(this.loadViewMode());
  private readonly mapHost = viewChild<ElementRef<HTMLDivElement>>('mapHost');
  private map: L.Map | null = null;

  constructor() {
    // (Re)build the map whenever the host div exists and places are in —
    // covers both view switches and the initial load racing each other.
    effect(() => {
      const host = this.mapHost();
      const places = this.places();
      if (host && places.length > 0) {
        this.renderMap(host.nativeElement, places);
      } else if (!host && this.map) {
        this.map.remove();
        this.map = null;
      }
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  setViewMode(mode: 'cards' | 'map'): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(PLACES_VIEW_KEY, mode);
    } catch {
      // Storage can be unavailable; the toggle still works for this visit.
    }
  }

  private loadViewMode(): 'cards' | 'map' {
    try {
      return localStorage.getItem(PLACES_VIEW_KEY) === 'map' ? 'map' : 'cards';
    } catch {
      return 'cards';
    }
  }

  /** One bubble per place, sized by how much of life happened there. */
  private renderMap(host: HTMLDivElement, places: PlaceView[]): void {
    if (this.map) {
      this.map.remove();
    }
    const map = L.map(host, { zoomControl: true, attributionControl: true });
    this.map = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7aa2f7';
    const maxCount = Math.max(...places.map((place) => place.assetCount));
    const bounds = L.latLngBounds([]);
    for (const place of places) {
      const point = L.latLng(place.gpsLat, place.gpsLon);
      bounds.extend(point);
      const radius = 10 + 22 * Math.sqrt(place.assetCount / maxCount);
      const marker = L.circleMarker(point, {
        radius,
        color: accent,
        weight: 2,
        fillColor: accent,
        fillOpacity: 0.35,
      }).addTo(map);
      marker.bindTooltip(`${place.town} · ${place.assetCount.toLocaleString()} photos`, {
        direction: 'top',
      });
      marker.on('click', () => this.openPlace(place));
    }
    map.fitBounds(bounds.pad(0.15));
  }

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
