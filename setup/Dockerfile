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
RUN mkdir -p /app/scripts \
    /app/shared/workflow/workflows \
    /app/server/migrations \
    /app/server/seeds \
    /app/ee/server/migrations

COPY scripts/ /app/scripts/
COPY shared/workflow/workflows/ /app/shared/workflow/workflows/
COPY server/migrations/ /app/server/migrations/
COPY server/seeds/ /app/server/seeds/
COPY ee/server/migrations/ /app/ee/server/migrations/
RUN chmod +x ./entrypoint.sh

USER node

ENTRYPOINT ["/opt/setup/entrypoint.sh"]
