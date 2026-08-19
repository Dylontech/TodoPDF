#!/bin/sh
# ─────────────────────────────────────────────────────────────
# TodoPDF — entrypoint del backend.
#
# El proceso arranca como ROOT para poder reparar los permisos del
# volumen /data (los volúmenes con nombre persisten el dueño de su
# primera creación; si el UID/GID de todopdf cambió entre builds,
# la app no podría escribir y TODAS las conversiones fallarían con
# EACCES → 500). Tras arreglar /data, baja a todopdf con setpriv
# (mínimo privilegio) y ejecuta el CMD (node src/server.js).
# ─────────────────────────────────────────────────────────────
set -eu

echo "[TodoPDF:entrypoint] Reparando permisos de /data..."
mkdir -p /data/storage /data/tmp
chown -R todopdf:todopdf /data

echo "[TodoPDF:entrypoint] Bajando a todopdf (uid=$(id -u todopdf)) y ejecutando: $*"
exec setpriv --reuid=todopdf --regid=todopdf --init-groups --inh-caps=-all "$@"
