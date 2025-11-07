ARG SERVER_IMAGE_REPO=ghcr.io/nine-minds/alga-psa-ce
ARG ALGA_IMAGE_TAG=latest

FROM ${SERVER_IMAGE_REPO}:${ALGA_IMAGE_TAG}

USER root

RUN apk add --no-cache \
    postgresql-client \
    sqlite \
    curl

WORKDIR /opt/setup

COPY setup/entrypoint.sh ./entrypoint.sh
COPY setup/config.ini ./config.ini
COPY server/setup/create_database.js /app/server/setup/create_database.js
RUN chmod +x ./entrypoint.sh

USER node

ENTRYPOINT ["/opt/setup/entrypoint.sh"]
