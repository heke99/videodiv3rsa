# Wan2.2 runtime: T2V, I2V, S2V and Animate share one environment.
ARG BASE_IMAGE=videoai/runtime-base:latest
FROM ${BASE_IMAGE}

USER root
COPY workers/wan-runtime/requirements.txt /opt/videoai/wan/requirements.txt
RUN pip install --no-cache-dir -r /opt/videoai/wan/requirements.txt
COPY workers/wan-runtime /opt/videoai/wan
RUN chown -R worker:worker /opt/videoai/wan
USER worker

WORKDIR /opt/videoai/wan
ENV WORKER_BACKEND=cuda
CMD ["python3", "main.py"]
