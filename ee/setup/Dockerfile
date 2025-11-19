ARG SERVER_IMAGE_REPO=ghcr.io/nine-minds/alga-psa-ee
ARG ALGA_IMAGE_TAG=latest

FROM ${SERVER_IMAGE_REPO}:${ALGA_IMAGE_TAG}

USER root

RUN apk update && apk add --no-cache \
    postgresql16-client \
    sqlite \
    curl

WORKDIR /opt/setup

COPY setup/entrypoint.sh ./entrypoint.sh
COPY setup/config.ini ./config.ini
COPY ee/setup/entrypoint.sh ./ee-entrypoint.sh
COPY server/setup/create_database.js /app/server/setup/create_database.js
RUN chmod +x ./entrypoint.sh ./ee-entrypoint.sh

USER node

ENTRYPOINT ["/opt/setup/ee-entrypoint.sh"]
