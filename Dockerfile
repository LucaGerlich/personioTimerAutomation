# Personio Auto-Timer
# Uses official Playwright image with all browser dependencies pre-installed.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

# Production dependencies only: Node runs the .ts sources directly (type stripping, Node >= 22.18)
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# Create storage directories
RUN mkdir -p /app/storage/personio-browser-profile /app/storage/screenshots

# Default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) throw new Error(); process.exit(0); }).catch(() => process.exit(1))"

# Start the server directly with node: one process instead of npm -> sh -> tsx -> node -> esbuild
CMD ["node", "src/server.ts"]
