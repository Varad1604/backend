# syntax=docker/dockerfile:1.7
# KPMPL Gate-to-Bill frontend: build with Node, serve dist/ with unprivileged nginx.
# Build:  docker build -t kpmpl-frontend:0.6.0 .
# Run:    docker run -p 8080:8080 -e BACKEND_UPSTREAM=http://backend:3000 kpmpl-frontend:0.6.0
# Env is baked in at BUILD time (Vite). Defaults produce a production http build.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_MODE=http
ARG VITE_APP_MODE=production
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_API_TIMEOUT_MS=20000
ENV VITE_API_MODE=$VITE_API_MODE \
    VITE_APP_MODE=$VITE_APP_MODE \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_TIMEOUT_MS=$VITE_API_TIMEOUT_MS
# typecheck + vite build; vite.config.ts fails the build on an invalid env combination.
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Runs as the non-root "nginx" user (uid 101) and listens on 8080.
ENV BACKEND_UPSTREAM=http://backend:3000
COPY --chown=nginx:nginx nginx.conf /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx nginx-proxy.conf /etc/nginx/templates/snippets/kpmpl-proxy.conf.template
COPY --chown=nginx:nginx nginx-security-headers.conf /etc/nginx/snippets/kpmpl-security-headers.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/nginx-health || exit 1
