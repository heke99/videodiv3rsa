# Base layer shared by every GPU model runtime.
#
# Each model family then builds its own image on top with its own pinned
# requirements, so upgrading one family cannot break another (spec section 54).
# The CUDA tag is a build argument rather than a literal so the image can be
# rebuilt for a different driver generation without editing this file.
ARG CUDA_IMAGE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
FROM ${CUDA_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3.11-venv python3-pip ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# The shared worker contract. Copied before the model dependencies so a change
# to a model's requirements does not invalidate this layer.
COPY workers/_sdk /opt/videoai/_sdk
RUN pip install --no-cache-dir /opt/videoai/_sdk

# Runtimes never write to the image; state lives on mounted volumes.
ENV MODEL_ROOT=/models
VOLUME ["/models"]

# Containers run unprivileged: a model runtime has no reason to be root.
RUN useradd --create-home --uid 10001 worker
USER worker

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status == 200 else 1)"
