# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN apk add --no-cache bash util-linux util-linux-login shadow python3 make g++
WORKDIR /opt/alga-appliance-support
COPY ee/appliance/support-agent/package.json ./package.json
RUN npm install --omit=dev
COPY ee/appliance/support-agent/supervisor.mjs ./supervisor.mjs
COPY ee/appliance/support-agent/protocol.mjs ./protocol.mjs
COPY ee/appliance/host-service/support-recordings.mjs /opt/host-service/support-recordings.mjs
ENV NODE_ENV=production
ENTRYPOINT ["node", "/opt/alga-appliance-support/supervisor.mjs"]
