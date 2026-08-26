"""Runtime configuration for the ML sidecar, all overridable by environment.

The defaults target the box this was built for (an RTX 3090, antelopev2 faces,
a strong CLIP model). Every value is an env var so a resource-constrained
deployment can drop to CPU and lighter models without code changes:

    RECOLLECT_ML_DEVICE=cpu
    RECOLLECT_FACE_MODEL=buffalo_s
    RECOLLECT_CLIP_MODEL=ViT-B-32
    RECOLLECT_CLIP_PRETRAINED=laion2b_s34b_b79k
"""

import os


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


class Config:
    """Immutable view of the sidecar's environment configuration."""

    # "cuda" or "cpu". Drives both the ONNX Runtime providers (faces) and the
    # torch device (CLIP).
    device: str = os.getenv("RECOLLECT_ML_DEVICE", "cuda").lower()

    # InsightFace model pack. antelopev2 = SCRFD detection + a large ArcFace
    # (512-d) — a notch above Immich's default buffalo_l. buffalo_s is the
    # lightweight CPU-friendly fallback.
    face_model: str = os.getenv("RECOLLECT_FACE_MODEL", "antelopev2")
    face_det_size: int = _int("RECOLLECT_FACE_DET_SIZE", 640)
    # Faces below this detector confidence are dropped before embedding.
    face_min_score: float = float(os.getenv("RECOLLECT_FACE_MIN_SCORE", "0.5"))

    # open_clip model + pretrained tag. ViT-L-14/laion2b beats Immich's stock
    # ViT-B CLIP on retrieval quality; swap to ViT-B-32 to save VRAM.
    clip_model: str = os.getenv("RECOLLECT_CLIP_MODEL", "ViT-L-14")
    clip_pretrained: str = os.getenv("RECOLLECT_CLIP_PRETRAINED", "laion2b_s32b_b82k")

    # Guards a single request from pinning the GPU for too long.
    max_batch: int = _int("RECOLLECT_ML_MAX_BATCH", 16)

    @classmethod
    def use_cuda(cls) -> bool:
        return cls.device == "cuda"
