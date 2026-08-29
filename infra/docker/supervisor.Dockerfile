# The supervisor needs the NVIDIA tooling but not a model environment, so it
# stays small and independent of any model family's dependencies.
ARG CUDA_IMAGE=nvidia/cuda:12.4.1-base-ubuntu22.04
FROM ${CUDA_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3.11 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY workers/gpu-supervisor /opt/videoai/supervisor
RUN pip install --no-cache-dir -r /opt/videoai/supervisor/requirements.txt

RUN useradd --create-home --uid 10002 supervisor
USER supervisor
WORKDIR /opt/videoai/supervisor
CMD ["python3", "-m", "supervisor.agent"]
