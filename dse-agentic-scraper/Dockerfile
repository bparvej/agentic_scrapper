FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium and its dependencies
RUN npx playwright install --with-deps chromium

# Copy source
COPY src/ ./src/
COPY .env.example ./.env.example

# Non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["node", "src/app.js"]
