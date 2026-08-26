"""Request/response contracts for the sidecar.

Images arrive base64-encoded so the core app (which already holds the file
bytes) can post a bounded batch without the sidecar needing any filesystem
knowledge. Every embedding response carries its model id (FRD contract).
"""

from pydantic import BaseModel, Field


class ImageInput(BaseModel):
    """One image in a batch, keyed by the caller's own id (echoed back)."""

    id: str
    image_b64: str


class DetectRequest(BaseModel):
    images: list[ImageInput] = Field(default_factory=list)


class ClipImageRequest(BaseModel):
    images: list[ImageInput] = Field(default_factory=list)


class TextRequest(BaseModel):
    texts: list[str] = Field(default_factory=list)


class DetectedFace(BaseModel):
    """A face box in pixel coordinates plus its L2-normalised ArcFace vector."""

    bbox: list[float]  # [x1, y1, x2, y2]
    score: float
    embedding: list[float]  # 512-d, unit length


class FaceResult(BaseModel):
    id: str
    faces: list[DetectedFace]
    error: str | None = None


class DetectResponse(BaseModel):
    model: str
    results: list[FaceResult]


class EmbeddingResult(BaseModel):
    id: str
    embedding: list[float] | None = None
    error: str | None = None


class ClipImageResponse(BaseModel):
    model: str
    dim: int
    results: list[EmbeddingResult]


class TextResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


class HealthResponse(BaseModel):
    status: str
    device: str
    face_model: str
    clip_model: str
    clip_dim: int
