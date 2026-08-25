# Recollect ML Sidecar

Phase 2+ service — not yet implemented. See [docs/plan.md](../../docs/plan.md) E12/E15.

Planned: Python 3.12 + FastAPI + ONNX Runtime.

- `POST /faces/detect` — face boxes + embeddings for a batch of images
- `POST /embed/clip` — CLIP image embeddings
- `POST /embed/text` — CLIP text embedding for semantic search queries
- `GET /health` — model versions + readiness

Contract rules (from the FRD): CPU-only baseline, bounded batch sizes, every
embedding response includes its model version, and the core app must function
fully when this service is absent.
