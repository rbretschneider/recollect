"""CLIP image + text embeddings via open_clip.

Image and text vectors share one space, L2-normalised, so cosine similarity
between a text query and an image embedding drives natural-language search.
"""

import base64
import io

import open_clip
import torch
from PIL import Image

from .config import Config


class ClipEngine:
    """One open_clip model serving both image and text embedding requests."""

    def __init__(self) -> None:
        self.device = "cuda" if Config.use_cuda() else "cpu"
        self._model, _, self._preprocess = open_clip.create_model_and_transforms(
            Config.clip_model,
            pretrained=Config.clip_pretrained,
            device=self.device,
        )
        self._model.eval()
        self._tokenizer = open_clip.get_tokenizer(Config.clip_model)
        self.name = f"{Config.clip_model}/{Config.clip_pretrained}"
        self.dim = int(self._model.visual.output_dim)

    @torch.inference_mode()
    def embed_images(self, images_b64: list[str]) -> list[list[float]]:
        tensors = [self._preprocess(self._decode_rgb(data)) for data in images_b64]
        batch = torch.stack(tensors).to(self.device)
        features = self._model.encode_image(batch)
        return self._normalise(features)

    @torch.inference_mode()
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        tokens = self._tokenizer(texts).to(self.device)
        features = self._model.encode_text(tokens)
        return self._normalise(features)

    @staticmethod
    def _normalise(features: torch.Tensor) -> list[list[float]]:
        features = features / features.norm(dim=-1, keepdim=True)
        return features.cpu().tolist()

    @staticmethod
    def _decode_rgb(image_b64: str) -> Image.Image:
        raw = base64.b64decode(image_b64)
        return Image.open(io.BytesIO(raw)).convert("RGB")
