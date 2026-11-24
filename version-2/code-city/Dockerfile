# ============================================
# STAGE 1: Install dependencies + Build
# ============================================
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./

# Changed to npm install and removed --silent
RUN npm install

COPY . .

RUN npm run build


# ============================================
# STAGE 2: Production image
# ============================================
FROM node:20-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

# Changed to npm install and removed --silent
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -S nestgroup && adduser -S nestuser -G nestgroup
RUN chown -R nestuser:nestgroup /app
USER nestuser

RUN apk add --no-cache git

EXPOSE 3000

CMD ["node", "dist/main.js"]