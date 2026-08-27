import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ExifDateTime, exiftool, Tags } from 'exiftool-vendored';
import { basename } from 'path';
import { parseDateFromFilename } from './filename-date';
import { MediaTypeInfo } from './media-types';

/** Everything the pipeline learns about a media file from its metadata. */
export interface ExtractedMetadata {
  capturedAt: Date;
  capturedAtSource: 'exif' | 'filename' | 'file_mtime';
  capturedTzOffsetMin: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  orientation: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAltM: number | null;
  videoCodec: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  /** Shutter speed as shown to photographers, e.g. "1/120". */
  exposureTime: string | null;
  /** Aperture f-number, e.g. 1.85. */
  fNumber: number | null;
  /** 35mm-equivalent focal length in millimeters. */
  focalLength35: number | null;
  /** Full raw tag dump, persisted to asset_metadata. */
  raw: Record<string, unknown>;
}

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Extracts EXIF/QuickTime metadata via exiftool with a deterministic capture-time
 * fallback chain: EXIF → filename pattern → filesystem mtime (FRD story S3.1).
 */
@Injectable()
export class MetadataExtractorService implements OnApplicationShutdown {
  async extract(
    absolutePath: string,
    typeInfo: MediaTypeInfo,
    fileMtime: Date,
  ): Promise<ExtractedMetadata> {
    const tags = await exiftool.read(absolutePath);
    const captured = this.resolveCapturedAt(tags, absolutePath, fileMtime);
    return {
      ...captured,
      width: tags.ImageWidth ?? null,
      height: tags.ImageHeight ?? null,
      durationMs: this.resolveDurationMs(tags, typeInfo),
      orientation: typeof tags.Orientation === 'number' ? tags.Orientation : null,
      gpsLat: typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : null,
      gpsLon: typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : null,
      gpsAltM: typeof tags.GPSAltitude === 'number' ? tags.GPSAltitude : null,
      videoCodec: this.resolveVideoCodec(tags, typeInfo),
      cameraMake: tags.Make ?? null,
      cameraModel: tags.Model ?? null,
      lensModel: tags.LensModel ?? null,
      iso: typeof tags.ISO === 'number' ? tags.ISO : null,
      exposureTime: this.resolveExposureTime(tags),
      fNumber: typeof tags.FNumber === 'number' ? tags.FNumber : null,
      focalLength35: this.resolveFocalLength35(tags),
      raw: JSON.parse(JSON.stringify(tags)) as Record<string, unknown>,
    };
  }

  /** ExposureTime arrives as "1/120" (string) or seconds (number). */
  private resolveExposureTime(tags: Tags): string | null {
    const value = tags.ExposureTime;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (typeof value === 'number' && value > 0) {
      return value >= 1 ? `${value}s` : `1/${Math.round(1 / value)}`;
    }
    return null;
  }

  /** "24 mm" / 24 → 24; prefers the 35mm-equivalent tag. */
  private resolveFocalLength35(tags: Tags): number | null {
    const value =
      (tags as Record<string, unknown>).FocalLengthIn35mmFormat ??
      (tags as Record<string, unknown>).FocalLength35efl;
    if (typeof value === 'number') {
      return Math.round(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
    return null;
  }

  async onApplicationShutdown(): Promise<void> {
    await exiftool.end();
  }

  private resolveCapturedAt(
    tags: Tags,
    absolutePath: string,
    fileMtime: Date,
  ): Pick<ExtractedMetadata, 'capturedAt' | 'capturedAtSource' | 'capturedTzOffsetMin'> {
    const exifDate = this.pickExifDate(tags);
    if (exifDate) {
      return {
        capturedAt: exifDate.toDate(),
        capturedAtSource: 'exif',
        capturedTzOffsetMin: exifDate.tzoffsetMinutes ?? null,
      };
    }
    const filenameDate = parseDateFromFilename(basename(absolutePath));
    if (filenameDate) {
      return {
        capturedAt: filenameDate,
        capturedAtSource: 'filename',
        capturedTzOffsetMin: -filenameDate.getTimezoneOffset(),
      };
    }
    return {
      capturedAt: fileMtime,
      capturedAtSource: 'file_mtime',
      capturedTzOffsetMin: -fileMtime.getTimezoneOffset(),
    };
  }

  private pickExifDate(tags: Tags): ExifDateTime | null {
    const candidates = [tags.DateTimeOriginal, tags.CreateDate, tags.MediaCreateDate];
    for (const candidate of candidates) {
      if (candidate instanceof ExifDateTime) {
        return candidate;
      }
    }
    return null;
  }

  private resolveVideoCodec(tags: Tags, typeInfo: MediaTypeInfo): string | null {
    if (typeInfo.mediaType !== 'video') {
      return null;
    }
    const codec = tags.CompressorID ?? (tags as Record<string, unknown>).VideoCodecID;
    return typeof codec === 'string' ? codec.toLowerCase() : null;
  }

  private resolveDurationMs(tags: Tags, typeInfo: MediaTypeInfo): number | null {
    if (typeInfo.mediaType !== 'video' || typeof tags.Duration !== 'number') {
      return null;
    }
    return Math.round(tags.Duration * MILLISECONDS_PER_SECOND);
  }
}
