FROM node:22-bookworm-slim

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src ./src
COPY server/data ./data

EXPOSE 4000

CMD ["npm", "start"]
