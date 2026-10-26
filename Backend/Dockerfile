# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# ---- runtime stage ----
FROM node:22-alpine
# git is REQUIRED for the shallow-clone fallback path in github.service.ts —
# it runs when the codeload tarball download/extract fails. node:22-alpine ships
# busybox tar (so extraction works) but NOT git, so without this the fallback
# would always fail inside the container. The build log records the installed
# version, and the app re-reports git/tar at boot (see logCloneToolchain).
RUN apk add --no-cache git && git --version
WORKDIR /app
ENV NODE_ENV=production
# Install prod deps as root so /app/node_modules is correctly owned, then the
# process itself drops to the unprivileged `node` user below.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Drop privileges for runtime. Temp work dirs are written to os.tmpdir()
# (/tmp), which is world-writable, so the `node` user can still clone/extract.
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:5000/health || exit 1
CMD ["node", "dist/server.js"]
