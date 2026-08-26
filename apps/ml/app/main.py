"""Recollect ML sidecar (E12/E15): face detection + embeddings and CLIP.

Stateless HTTP over the private compose network. The core app degrades fully
when this service is down, so every route is best-effort: one bad image in a
batch fails only its own entry, never the request.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .clip_embed import ClipEngine
from .config import Config
from .faces import FaceEngine
from .schemas import (
    ClipImageRequest,
    ClipImageResponse,
    DetectRequest,
    DetectResponse,
    EmbeddingResult,
    FaceResult,
    HealthResponse,
    TextRequest,
    TextResponse,
)

# Loaded once at startup; heavy models must not be constructed per request.
engines: dict[str, object] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    engines["faces"] = FaceEngine()
    engines["clip"] = ClipEngine()
    yield
    engines.clear()


app = FastAPI(title="Recollect ML", lifespan=lifespan)


def _faces() -> FaceEngine:
    return engines["faces"]  # type: ignore[return-value]


def _clip() -> ClipEngine:
    return engines["clip"]  # type: ignore[return-value]


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    clip = _clip()
    return HealthResponse(
        status="ok",
        device=Config.device,
        face_model=_faces().model_name,
        clip_model=clip.name,
        clip_dim=clip.dim,
    )


@app.post("/faces/detect", response_model=DetectResponse)
def detect_faces(request: DetectRequest) -> DetectResponse:
    faces = _faces()
    results: list[FaceResult] = []
    for image in request.images[: Config.max_batch]:
        try:
            detected = faces.detect(image.image_b64)
            results.append(FaceResult(id=image.id, faces=detected))
        except Exception as error:  # noqa: BLE001 — isolate one bad image
            results.append(FaceResult(id=image.id, faces=[], error=str(error)))
    return DetectResponse(model=faces.model_name, results=results)


@app.post("/embed/clip", response_model=ClipImageResponse)
def embed_clip(request: ClipImageRequest) -> ClipImageResponse:
    clip = _clip()
    images = request.images[: Config.max_batch]
    results: list[EmbeddingResult] = []
    # One decode failure would sink a whole batched encode, so embed per image
    # and let the healthy ones through.
    for image in images:
        try:
            [vector] = clip.embed_images([image.image_b64])
            results.append(EmbeddingResult(id=image.id, embedding=vector))
        except Exception as error:  # noqa: BLE001
            results.append(EmbeddingResult(id=image.id, error=str(error)))
    return ClipImageResponse(model=clip.name, dim=clip.dim, results=results)


@app.post("/embed/text", response_model=TextResponse)
def embed_text(request: TextRequest) -> TextResponse:
    clip = _clip()
    embeddings = clip.embed_texts(request.texts[: Config.max_batch]) if request.texts else []
    return TextResponse(model=clip.name, dim=clip.dim, embeddings=embeddings)
