# ─────────────────────────────────────────────────────────────
# TodoPDF — Frontend (Astro estático + nginx)
# Build multi-stage: compila en Node 22 LTS y sirve con nginx:alpine.
# Nota: node 20 provoca EBADENGINE (undici@8 exige >=22.19.0).
# ─────────────────────────────────────────────────────────────

# Etapa 1: build de Astro
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
# Fuerza IPv4-first: evita resets de conexión (ECONNRESET) por IPv6 roto.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# --fetch-retry*: reintenta descargas ante errores de red transitorios (ECONNRESET).
RUN npm install --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .
RUN npm run build

# Etapa 2: servidor estático con proxy de API
FROM nginx:1.27-alpine
# Configuración: estáticos + proxy /api → backend
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Resultado del build de Astro
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
