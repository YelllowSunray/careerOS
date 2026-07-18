FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npx playwright install chromium

ENV PORT=8080
CMD ["npx", "tsx", "workers/browser-agent/index.ts"]
