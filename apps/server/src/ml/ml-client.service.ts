import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

/** One detected face from the sidecar. */
export interface DetectedFace {
  /** Pixel [x1, y1, x2, y2] in the image that was sent (the 720 thumbnail). */
  bbox: number[];
  score: number;
  embedding: number[];
}

/** Face detection result for one image. */
export interface FaceDetectResult {
  faces: DetectedFace[];
  model: string;
}

/** CLIP embedding result. */
export interface ClipEmbedResult {
  embedding: number[];
  model: string;
}

/**
 * HTTP client for the ML sidecar (apps/ml). The whole feature is optional:
 * with no RECOLLECT_ML_URL configured, isEnabled is false and callers skip
 * ML work entirely — the app runs fully without it.
 */
@Injectable()
export class MlClientService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isEnabled(): boolean {
    return this.config.mlUrl.length > 0;
  }

  /** Detects faces in an image file (reads and base64s it for the sidecar). */
  async detectFaces(imagePath: string): Promise<FaceDetectResult> {
    const body = await this.imageRequestBody(imagePath);
    const response = await this.post<{
      results: Array<{ id: string; faces: Array<{ bbox: number[]; score: number; embedding: number[] }> }>;
      model: string;
    }>('/faces/detect', body);
    const first = response.results[0];
    return {
      faces: (first?.faces ?? []).map((f) => ({ bbox: f.bbox, score: f.score, embedding: f.embedding })),
      model: response.model,
    };
  }

  /** CLIP image embedding for one image file. */
  async embedImage(imagePath: string): Promise<ClipEmbedResult> {
    const body = await this.imageRequestBody(imagePath);
    const response = await this.post<{
      results: Array<{ id: string; embedding: number[] }>;
      model: string;
    }>('/embed/clip', body);
    return { embedding: response.results[0]?.embedding ?? [], model: response.model };
  }

  /** CLIP text embedding (same space as images), for semantic search. */
  async embedText(text: string): Promise<ClipEmbedResult> {
    const response = await this.post<{ embeddings: number[][]; model: string }>('/embed/text', {
      texts: [text],
    });
    return { embedding: response.embeddings[0] ?? [], model: response.model };
  }

  private async imageRequestBody(imagePath: string): Promise<object> {
    const bytes = await readFile(imagePath);
    return { images: [{ id: 'img', image_b64: bytes.toString('base64') }] };
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const response = await fetch(`${this.config.mlUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`ML sidecar ${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
