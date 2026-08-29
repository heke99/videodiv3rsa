# Node services: api, orchestrator, gpu-manager, director, render, media.
# None of these require a GPU (spec section 93).
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
CMD ["node", "dist/server.js"]
