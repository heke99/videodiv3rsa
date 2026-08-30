# The Node services that run as processes: api, orchestrator, gpu-manager and
# media. None requires a GPU (spec section 93).
#
# ENTRYPOINT_FILE is a build arg because the services do not share one: the API
# and media serve HTTP from server.js, the orchestrator is a Temporal worker,
# and the GPU manager is a maintenance loop. Assuming server.js meant four of
# the six containers in compose.dev.yml could not start at all.
FROM node:22-bookworm-slim AS build
ARG SERVICE
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./services/${SERVICE}" build

FROM node:22-bookworm-slim AS runtime
ARG SERVICE
ARG ENTRYPOINT_FILE=server.js
ENV NODE_ENV=production
# ffmpeg is only needed by the render and media services, but keeping one
# runtime image avoids a second base to maintain; it costs a few MB.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/${SERVICE}/dist ./dist
USER node
EXPOSE 8000
# Resolved at build time into the image's own command, so a container that
# cannot start fails when it is built rather than when it is deployed.
ENV ENTRYPOINT_FILE=${ENTRYPOINT_FILE}
CMD ["sh", "-c", "exec node dist/${ENTRYPOINT_FILE}"]
