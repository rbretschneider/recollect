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
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { PlacesApiService, PlaceView } from '../../core/api/places-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { Icon } from '../../shared/icon';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
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
  imports: [AccountBadge, Icon, MenuButton, BackButton, AssetViewer, PageLoading, SafeResourcePipe, LoadError],
  templateUrl: './places-page.html',
  styleUrl: './places-page.scss',
})
export class PlacesPage implements OnInit, OnDestroy {
  private readonly api = inject(PlacesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly places = signal<PlaceView[]>([]);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
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
  private mapResizeObserver: ResizeObserver | null = null;

  constructor() {
    // (Re)build the map whenever the host div exists and places are in —
    // covers both view switches and the initial load racing each other.
    effect(() => {
      const host = this.mapHost();
      const places = this.places();
      if (host && places.length > 0) {
        this.renderMap(host.nativeElement, places);
      } else if (!host && this.map) {
        this.teardownMap();
      }
    });
  }

  private teardownMap(): void {
    this.mapResizeObserver?.disconnect();
    this.mapResizeObserver = null;
    this.map?.remove();
    this.map = null;
  }

  ngOnDestroy(): void {
    this.teardownMap();
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
      return localStorage.getItem(PLACES_VIEW_KEY) === 'cards' ? 'cards' : 'map';
    } catch {
      return 'map';
    }
  }

  /** One bubble per place, sized by how much of life happened there. */
  private renderMap(host: HTMLDivElement, places: PlaceView[]): void {
    this.teardownMap();

    let userTookOver = false;

    // Building a Leaflet map in a zero-size container (a hidden tab, or a phone
    // whose dvh-based height hasn't resolved on first paint) caches a broken
    // size: it fits the bubbles at world zoom, requests one tile, and never
    // recovers — the grey box users saw. So the whole thing is driven by a
    // ResizeObserver: build only once the container has real dimensions, then
    // keep the size in sync and re-fit until the user takes the map over (a real
    // pointer/wheel gesture, which a programmatic fitBounds never fires).
    const bounds = L.latLngBounds([]);
    const sync = (): void => {
      if (host.clientWidth === 0 || host.clientHeight === 0) {
        return;
      }
      if (!this.map) {
        const map = L.map(host, { zoomControl: true, attributionControl: true });
        this.map = map;
        // Same-origin tile proxy (see PlacesController.tile): the browser only
        // ever talks to us, so no cross-origin CSP/CORP/DNS wall can blank the map.
        L.tileLayer('/api/v1/places/tiles/{z}/{x}/{y}', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        const accent =
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
          '#7aa2f7';
        const maxCount = Math.max(...places.map((place) => place.assetCount));
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
        map.on('mousedown touchstart wheel', () => {
          userTookOver = true;
        });
      }
      this.map.invalidateSize();
      if (!userTookOver && bounds.isValid()) {
        this.map.fitBounds(bounds.pad(0.15));
      }
    };

    this.mapResizeObserver = new ResizeObserver(sync);
    this.mapResizeObserver.observe(host);
    sync();
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
    return assetThumbUrl(assetId, size);
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

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const { places } = await this.api.list();
      this.places.set(places);
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
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
    } catch {
      // A failed place fetch shouldn't vanish silently into an empty grid.
      this.toasts.error("Couldn't load photos for this place.", {
        label: 'Retry',
        run: () => void this.loadPlace(label),
      });
    } finally {
      this.isLoadingPlace.set(false);
    }
  }
}
