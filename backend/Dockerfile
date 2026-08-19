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
#   ffmpeg                               → descargador de vídeos (yt-dlp se instala por pip en el venv)
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
        ffmpeg \
        python3 python3-pip python3-venv \
        libgl1 libglib2.0-0 libgomp1 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    # UID/GID FIJO (1001): evita que useradd -r asigne un UID dinámico que
    # rompa la escritura de volúmenes creados en builds anteriores.
    && groupadd -g 1001 todopdf \
    && useradd -u 1001 -g 1001 -M -d /app -s /usr/sbin/nologin todopdf

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

# ── rembg (quitar fondo) + vtracer (vectorizar a SVG) en un venv ──
# También se instala yt-dlp (versión reciente) para que el PATH resuelva
# "yt-dlp" a una versión que mantenga el anti-403 de YouTube.
# vtracer no necesita descargar modelos (a diferencia de rembg).
ENV VIRTUAL_ENV=/opt/rembg
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
# Modelo u2net precargado en build (evita descargarlo en la 1ª petición).
# /models se deja escribible porque onnxruntime crea un bloqueo de sesión.
ENV U2NET_HOME=/models
ENV OMP_NUM_THREADS=2
# numba (usado por pymatting/rembg) intenta cachear funciones JIT en el
# __pycache__ del paquete (root, no escribible por todopdf) → falla con
# "no locator available". Se redirige su caché a un dir escribible y además
# se deja escribible el __pycache__ de los paquetes del venv (fix definitivo).
ENV NUMBA_CACHE_DIR=/tmp/numba-cache
RUN python3 -m venv "$VIRTUAL_ENV" \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir "rembg[cpu]" yt-dlp vtracer \
    && mkdir -p /models && chmod 777 /models \
    && python3 -c "from rembg import new_session; new_session('u2net')" \
    # El proceso final corre como todopdf: el modelo y su dir deben ser
    # legibles (u2net.onnx se descarga con permisos 600 de root → EACCES).
    && chown -R todopdf:todopdf /models \
    && mkdir -p "$NUMBA_CACHE_DIR" && chown todopdf:todopdf "$NUMBA_CACHE_DIR" \
    # rembg usa numba con cache=True y pymatting crea sus .nbc en el
    # __pycache__ del paquete; si no es escribible por todopdf, el import
    # falla con "cannot cache function ... no locator available".
    && chmod -R a+rwX "$VIRTUAL_ENV/lib/python3.11/site-packages/pymatting" \
                "$VIRTUAL_ENV/lib/python3.11/site-packages/rembg"

# Directorios de datos (montados como volúmenes en docker-compose).
# Se crean y se entregan al usuario todopdf ANTES de cambiar de usuario,
# porque el usuario sin privilegios no puede crear directorios en la raíz.
RUN mkdir -p /data/storage /data/tmp && chown -R todopdf:todopdf /data

# Entrypoint: repara permisos del volumen /data (un volumen con nombre
# persiste el dueño de su primera creación; si el UID de todopdf cambió
# entre builds, la app no podría escribir) y luego baja a todopdf.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

# El entrypoint arranca como root, arregla /data y baja privilegios con
# setpriv (util-linux) → el proceso final corre como todopdf (mínimo
# privilegio), igual que antes con USER todopdf.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/server.js"]
