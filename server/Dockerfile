FROM node:22-bookworm-slim

WORKDIR /app/server

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data

EXPOSE 4000

CMD ["npm", "start"]
