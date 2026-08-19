# Vite output is architecture-independent; keep the expensive npm/Vite build
# on the native BuildKit worker instead of emulating it under arm64 QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
ARG VITE_GIT_SHA=
ENV VITE_GIT_SHA=$VITE_GIT_SHA
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
