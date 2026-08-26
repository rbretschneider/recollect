# CUDA 12.2 + cuDNN 8 runtime to match Hawaii's driver 535. onnxruntime-gpu
# (faces) needs the system cuDNN this base provides; torch cu121 brings its own.
FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

# HOME points model caches (InsightFace packs, CLIP weights) at a mounted volume
# so they download once and survive restarts instead of on every boot.
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    HOME=/models \
    RECOLLECT_ML_DEVICE=cuda

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-dev build-essential \
      libgl1 libglib2.0-0 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# insightface depends on the CPU "onnxruntime"; installing both packages leaves
# whichever landed last, so force the GPU build to win deterministically.
RUN pip3 install --upgrade pip \
    && pip3 install -r requirements.txt \
    && pip3 uninstall -y onnxruntime || true \
    && pip3 install --force-reinstall --no-deps onnxruntime-gpu==1.17.1

COPY app ./app

EXPOSE 8000
# Long start period: the first-ever boot downloads model weights (~2 GB) into
# the cache volume; the container is not "unhealthy", just warming up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD curl -sf http://localhost:8000/health || exit 1

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
