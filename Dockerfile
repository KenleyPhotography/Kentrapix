# KentraPix Express + Sharp backend.
# Build from the repository root: docker build -t kentrapix-backend .
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app/server

# Install only the backend's production dependencies. Debian/glibc is used
# intentionally for reliable prebuilt Sharp/libvips binaries.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The Express app also serves selected frontend files from /app.
WORKDIR /app
COPY . .

RUN mkdir -p /app/server/storage \
    && chown -R node:node /app

WORKDIR /app/server
USER node
EXPOSE 3000

# The app's health endpoint also checks PostgreSQL connectivity.
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
