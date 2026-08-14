# ─────────────────────────────────────────────────────────────
# TodoPDF — Backend (Node.js 22 LTS + dependencias de sistema)
# Dependencias del SO necesarias para manipular PDFs, imágenes y Office:
#   ghostscript        → rasterizar PDF → imágenes (flujo en RAM por pipes)
#   imagemagick        → utilidad adicional de imágenes (fallback)
#   poppler-utils      → utilidades PDF (pdfinfo, pdftoppm, ...)
#   libreoffice-writer → conversión PDF ↔ Office (DOCX/DOC/ODT; importa PDF)
#   libreoffice-calc   → conversión XLSX ↔ PDF (Office → PDF)
#   libreoffice-impress→ conversión PPTX/PPT ↔ PDF (Office → PDF)
#   font-noto*         → tipografías para un PDF/Office legible (sin ellas
#                        LibreOffice usa una fuente genérica muy pobre)
#   ffmpeg             → merge de flujos y conversión de audio del descargador
#   yt-dlp             → descargador de vídeos (YouTube, TikTok, X, ...)
#   tini               → init ligero: manejo correcto de señales/SIGTERM
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine

# Python + rembg (quitar fondo con IA): se invoca desde Node por pipes.
# libgomp es necesario para onnxruntime/opencv (OpenMP) en musl.
RUN apk add --no-cache ghostscript imagemagick poppler-utils tini \
    libreoffice-writer libreoffice-calc libreoffice-impress \
    font-noto font-noto-cjk ffmpeg yt-dlp \
    python3 py3-pip libgomp \
    && pip install --no-cache-dir --break-system-packages "rembg[cpu]" \
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

# rembg: ruta de modelos en caché y límite de hilos (CPU compartida).
ENV U2NET_HOME=/models
ENV OMP_NUM_THREADS=2

# Modelo u2net de rembg precargado en build (evita descargarlo en la 1ª petición).
# /models se deja escribible porque onnxruntime crea un bloqueo de sesión.
RUN mkdir -p /models && chmod 777 /models \
    && U2NET_HOME=/models python3 -c "from rembg import new_session; new_session('u2net')"

# Directorios de datos (montados como volúmenes en docker-compose).
# Se crean y se entregan al usuario todopdf ANTES de cambiar de usuario,
# porque el usuario sin privilegios no puede crear directorios en la raíz.
RUN mkdir -p /data/storage /data/tmp && chown -R todopdf:todopdf /data

# Principio de mínimo privilegio: el proceso corre sin root
USER todopdf

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
