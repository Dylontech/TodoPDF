# ─────────────────────────────────────────────────────────────
# TodoPDF — Backend (Node.js 22 LTS + dependencias de sistema)
# Base Debian (glibc): rembg/onnxruntime/opencv necesitan wheels manylinux.
# En Alpine (musl) NO hay wheels de onnxruntime para el Python 3.14 que
# trae node:22-alpine, por eso usamos Debian bookworm-slim.
#
# Dependencias del SO:
#   ghostscript/poppler-utils/imagemagick → PDF ↔ imágenes (pipes en RAM)
#   libreoffice-writer/calc/impress        → PDF ↔ Office (DOCX/XLSX/PPTX)
#   fonts-noto*                            → tipografías para un PDF legible
#   ffmpeg, yt-dlp                         → descargador de vídeos
#   python3 + venv                         → rembg (quitar fondo con IA)
#   libgl1/libglib2.0-0/libgomp1           → runtime de opencv-python-headless
#   tini                                   → init ligero (señales/SIGTERM)
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# La suite bookworm-updates publica a veces Release con fecha futura respecto
# al reloj local ("not valid yet") → se desactiva la validación de fecha apt.
RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update \
    && apt-get install -y --no-install-recommends \
        ghostscript poppler-utils imagemagick \
        libreoffice-writer libreoffice-calc libreoffice-impress \
        fonts-noto fonts-noto-cjk \
        ffmpeg yt-dlp \
        python3 python3-pip python3-venv \
        libgl1 libglib2.0-0 libgomp1 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r todopdf \
    && useradd -r -g todopdf -d /app -s /usr/sbin/nologin todopdf

WORKDIR /app

# Solo los manifiestos primero para aprovechar la caché de capas
COPY package*.json ./
# Fuerza IPv4-first: evita resets de conexión (ECONNRESET) por IPv6 roto.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# LibreOffice necesita un HOME escribible para su perfil de usuario.
ENV HOME=/tmp
# npm ci requiere package-lock.json; npm install es tolerante a su ausencia.
# --fetch-retry*: reintenta descargas ante errores de red transitorios.
RUN npm install --omit=dev --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Código fuente de la aplicación
COPY . .

# ── rembg (quitar fondo de imagen) en un venv aislado ─────────
# También se instala yt-dlp (versión reciente) para que el PATH resuelva
# "yt-dlp" a una versión que mantenga el anti-403 de YouTube.
ENV VIRTUAL_ENV=/opt/rembg
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
# Modelo u2net precargado en build (evita descargarlo en la 1ª petición).
# /models se deja escribible porque onnxruntime crea un bloqueo de sesión.
ENV U2NET_HOME=/models
ENV OMP_NUM_THREADS=2
RUN python3 -m venv "$VIRTUAL_ENV" \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir "rembg[cpu]" yt-dlp \
    && mkdir -p /models && chmod 777 /models \
    && python3 -c "from rembg import new_session; new_session('u2net')"

# Directorios de datos (montados como volúmenes en docker-compose).
# Se crean y se entregan al usuario todopdf ANTES de cambiar de usuario,
# porque el usuario sin privilegios no puede crear directorios en la raíz.
RUN mkdir -p /data/storage /data/tmp && chown -R todopdf:todopdf /data

# Principio de mínimo privilegio: el proceso corre sin root
USER todopdf

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
