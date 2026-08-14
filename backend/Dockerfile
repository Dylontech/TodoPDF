# ─────────────────────────────────────────────────────────────
# TodoPDF — Backend (Node.js 22 LTS + dependencias de sistema)
# Dependencias del SO necesarias para manipular PDFs, imágenes y Office:
#   ghostscript        → rasterizar PDF → imágenes (flujo en RAM por pipes)
#   imagemagick        → utilidad adicional de imágenes (fallback)
#   poppler-utils      → utilidades PDF (pdfinfo, pdftoppm, ...)
#   libreoffice-writer → conversión PDF ↔ Office (DOCX/DOC/XLSX/PPTX/ODT)
#   font-noto*         → tipografías para un PDF/Office legible (sin ellas
#                        LibreOffice usa una fuente genérica muy pobre)
#   tini               → init ligero: manejo correcto de señales/SIGTERM
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache ghostscript imagemagick poppler-utils tini \
    libreoffice-writer font-noto font-noto-cjk \
    && addgroup -S todopdf \
    && adduser -S todopdf -G todopdf

WORKDIR /app

# Solo los manifiestos primero para aprovechar la caché de capas
COPY package*.json ./
# Fuerza IPv4-first: evita resets de conexión (ECONNRESET) por IPv6 roto.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# LibreOffice necesita un HOME escribible para su perfil de usuario
# (el usuario todopdf no tiene permisos fuera de /data y /tmp).
ENV HOME=/tmp
# npm ci requiere package-lock.json; npm install es tolerante a su ausencia.
# --fetch-retry*: reintenta descargas ante errores de red transitorios (ECONNRESET).
RUN npm install --omit=dev --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Código fuente de la aplicación
COPY . .

# Directorios de datos (montados como volúmenes en docker-compose).
# Se crean y se entregan al usuario todopdf ANTES de cambiar de usuario,
# porque el usuario sin privilegios no puede crear directorios en la raíz.
RUN mkdir -p /data/storage /data/tmp && chown -R todopdf:todopdf /data

# Principio de mínimo privilegio: el proceso corre sin root
USER todopdf

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
