# syntax=docker/dockerfile:1

FROM node:22-alpine AS ui-build
WORKDIR /workspace/ee/appliance/status-ui
COPY ee/appliance/status-ui/package.json ee/appliance/status-ui/package-lock.json ./
RUN npm ci
COPY ee/appliance/status-ui/app ./app
COPY ee/appliance/status-ui/next.config.mjs ee/appliance/status-ui/tsconfig.json ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /opt/alga-appliance
RUN apk add --no-cache bash curl kubectl \
  && curl -s https://fluxcd.io/install.sh | bash
ENV NODE_ENV=production
ENV ALGA_APPLIANCE_PORT=8080
ENV ALGA_APPLIANCE_STATUS_UI_DIR=/opt/alga-appliance/status-ui/dist
ENV ALGA_APPLIANCE_MODE=kubernetes-control-plane
ENV ALGA_APPLIANCE_BUNDLE_ORIGIN=baked-iso

COPY ee/appliance/host-service/*.mjs ./host-service/
COPY ee/appliance/scripts ./scripts
COPY ee/appliance/manifests ./manifests
COPY ee/appliance/flux ./flux
COPY ee/appliance/releases ./releases
COPY --from=ui-build /workspace/ee/appliance/status-ui/dist ./status-ui/dist

RUN addgroup -S alga && adduser -S -G alga -u 10001 alga \
  && mkdir -p /var/lib/alga-appliance \
  && chmod +x /opt/alga-appliance/scripts/control-plane-entrypoint.sh \
  && chown -R alga:alga /opt/alga-appliance /var/lib/alga-appliance

USER 10001:10001
EXPOSE 8080
CMD ["/opt/alga-appliance/scripts/control-plane-entrypoint.sh"]
