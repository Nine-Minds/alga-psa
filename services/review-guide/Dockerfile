FROM node:22-alpine
WORKDIR /app/services/review-guide
COPY services/review-guide/package.json ./
COPY services/review-guide/src ./src
COPY services/review-guide/public ./public
RUN npm run build
CMD ["node", "."]
