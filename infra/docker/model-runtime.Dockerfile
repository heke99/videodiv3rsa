# Template for the remaining model runtimes. RUNTIME_DIR selects which one, so
# image, TTS, MMAudio, MuseTalk and the vision/QC runtime each get their own
# image and their own dependency set from one definition.
ARG BASE_IMAGE=videoai/runtime-base:latest
FROM ${BASE_IMAGE}
ARG RUNTIME_DIR

USER root
COPY workers/${RUNTIME_DIR}/requirements.txt /opt/videoai/runtime/requirements.txt
RUN pip install --no-cache-dir -r /opt/videoai/runtime/requirements.txt
COPY workers/${RUNTIME_DIR} /opt/videoai/runtime
RUN chown -R worker:worker /opt/videoai/runtime
USER worker

WORKDIR /opt/videoai/runtime
ENV WORKER_BACKEND=cuda
CMD ["python3", "main.py"]
