# Built via build-image.sh, which stages the compiled packages into .stage/
# first. Do not `docker build` directly against an unstaged tree.
FROM node:22-alpine

WORKDIR /algasim
COPY .stage/ ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# msgraph / qbo / webhook-sink / smtp-sink / stripe / xero vendor surfaces + control API
EXPOSE 4010 4020 4030 4040 4050 4060 9500

ENV ALGASIM_CONTROL_PORT=9500
CMD ["node", "node_modules/@alga-psa/emulator-suite/dist/cli.js"]
