"""Face detection + ArcFace embeddings via InsightFace / ONNX Runtime."""

import base64

import cv2
import numpy as np
from insightface.app import FaceAnalysis

from .config import Config


class FaceEngine:
    """Wraps one InsightFace model pack; returns boxes + normalised embeddings."""

    def __init__(self) -> None:
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if Config.use_cuda()
            else ["CPUExecutionProvider"]
        )
        self.model_name = Config.face_model
        self._app = FaceAnalysis(name=Config.face_model, providers=providers)
        # ctx_id 0 selects the (single, container-visible) GPU; -1 is CPU.
        self._app.prepare(
            ctx_id=0 if Config.use_cuda() else -1,
            det_size=(Config.face_det_size, Config.face_det_size),
        )

    def detect(self, image_b64: str) -> list[dict]:
        """Detect faces in one base64 image; empty list when none are found."""
        bgr = self._decode_bgr(image_b64)
        faces = self._app.get(bgr)
        results: list[dict] = []
        for face in faces:
            if float(face.det_score) < Config.face_min_score:
                continue
            results.append(
                {
                    "bbox": [float(v) for v in face.bbox.tolist()],
                    "score": float(face.det_score),
                    "embedding": [float(v) for v in face.normed_embedding.tolist()],
                }
            )
        return results

    @staticmethod
    def _decode_bgr(image_b64: str) -> np.ndarray:
        raw = base64.b64decode(image_b64)
        bgr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("Could not decode image bytes.")
        return bgr
