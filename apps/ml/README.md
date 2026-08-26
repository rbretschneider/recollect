# Recollect ML Sidecar

Python + FastAPI + ONNX Runtime / open_clip. Face detection & ArcFace
embeddings (E12) and CLIP image/text embeddings (E15). The core app talks to it
over the private compose network and **degrades fully when it's absent** — no
faces or semantic search, everything else works.

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `GET /health` | — | device + loaded model ids/dim |
| `POST /faces/detect` | `{images:[{id, image_b64}]}` | per image: face boxes + 512-d embeddings |
| `POST /embed/clip` | `{images:[{id, image_b64}]}` | per image: CLIP image embedding |
| `POST /embed/text` | `{texts:[...]}` | CLIP text embeddings (same space) |

Images are base64 in the request body — the core app already holds the bytes,
so the sidecar needs no filesystem access. One bad image fails only its own
entry. Every response carries its model id.

## Configuration (all env, all optional)

| Var | Default | Notes |
|---|---|---|
| `RECOLLECT_ML_DEVICE` | `cuda` | `cpu` for GPU-less hosts |
| `RECOLLECT_FACE_MODEL` | `antelopev2` | `buffalo_l` (Immich parity) / `buffalo_s` (CPU) |
| `RECOLLECT_FACE_MIN_SCORE` | `0.5` | drop low-confidence detections |
| `RECOLLECT_CLIP_MODEL` | `ViT-L-14` | `ViT-B-32` to save VRAM |
| `RECOLLECT_CLIP_PRETRAINED` | `laion2b_s32b_b82k` | open_clip tag |
| `RECOLLECT_ML_MAX_BATCH` | `16` | per-request cap |

**Defaults target a 24 GB GPU.** A modest box runs the same image with
`RECOLLECT_ML_DEVICE=cpu`, `RECOLLECT_FACE_MODEL=buffalo_s`,
`RECOLLECT_CLIP_MODEL=ViT-B-32` — slower, no other change.

## Build & run

Pinned to CUDA 12.2 / cuDNN 8 (NVIDIA driver 535). Model weights download once
into the `/models` cache volume.

```
docker build -t recollect-ml apps/ml
docker run --rm --gpus '"device=0"' -p 8000:8000 -v recollect_ml-models:/models recollect-ml
```
