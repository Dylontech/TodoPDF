# TodoPDF 📄

Aplicación web **autoalojada** estilo iLovePDF con un enfoque estricto en la **privacidad**.

- **Backend:** Node.js (API REST) + Knex (MariaDB/MySQL).
- **Frontend:** Astro (build estático servido por nginx).
- **Infraestructura:** Docker + Docker Compose (con Ghostscript, ImageMagick, Poppler, LibreOffice, ffmpeg, yt-dlp y herramientas Python: rembg y vtracer).

## Conversiones del MVP

| Herramienta        | Flujo invitado (RAM)                      | Flujo autenticado (disco + historial) |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| PDF → Imágenes     | Ghostscript por pipes, ZIP en memoria     | Guarda JPG/PNG… en volumen + historial |
| Imágenes → PDF     | sharp + pdf-lib en Buffers, PDF en memoria | Guarda PDF en volumen + historial      |
| PDF → Office (DOCX/DOC/ODT/PPTX/PPT) | LibreOffice + pptxgenjs en temp aislado (**OCR** si el PDF es un escaneo) | Guarda documento en volumen + historial |
| Office → PDF (DOC/DOCX/ODT/RTF/TXT/XLS/XLSX/ODS/CSV/PPT/PPTX/ODP) | LibreOffice en temp aislado | Guarda PDF en volumen + historial |
| Convertir documento (Office → Office) | — (exclusivo de usuarios registrados) | LibreOffice en temp aislado; guarda el documento en volumen + historial |

## Flujos de privacidad

1. **Usuarios invitados:** el procesamiento de PDF ↔ imágenes ocurre estrictamente en **memoria RAM**
   (Buffers; Ghostscript por STDIN/STDOUT, nada toca el disco). Las herramientas de **Office** requieren
   que LibreOffice escriba archivos de trabajo, por lo que usan un **directorio temporal aislado por
   conversión** que se elimina SIEMPRE al terminar (éxito o error). No persiste nada para invitados.
2. **Usuarios autenticados:** los archivos se procesan, se guardan en un **volumen del servidor**
   (`uploads`) y cada conversión se registra en el **historial** de la base de datos (Knex).

## OCR de PDFs escaneados (PDF → Word)

Convertir un PDF **escaneado** (o una foto exportada a PDF) con LibreOffice daba un documento con la
página como imagen pero **sin texto editable**: ese tipo de PDF no tiene capa de texto y el importador
de LibreOffice no hace OCR. Ahora se detecta automáticamente y se aplica **OCR con tesseract**:

1. Se comprueba la capa de texto con `pdftotext` y se combinan dos señales: la **densidad de texto por
   página** (`TODOPDF_OCR_MIN_CHARS_PER_PAGE`, 40 por defecto) y el tamaño de la **imagen de página**
   (`pdfimages`). Así los escaneos con un sello residual del escáner (o un PDF "imprimir a PDF" con la
   URL o la fecha) también se tratan como escaneo, mientras que un PDF digital corto sigue por la ruta
   rápida. Si la detección automática no acierta, el formulario permite **forzar o desactivar el OCR**
   (campo `ocr` = `auto` | `on` | `off`).
2. Si no hay texto útil, se rasteriza cada página a PNG con **Ghostscript** (`TODOPDF_OCR_DPI`, 300 dpi).
3. **tesseract** reconoce el texto y genera un PDF "buscable": conserva la imagen de la página **y**
   añade el texto como capa invisible.
4. El importador de PDF de LibreOffice extrae **ambas** cosas → el DOCX/DOC/ODT final tiene la página
   escaneada como imagen **y** el texto reconocido, ya editable.

- Idiomas: `TODOPDF_OCR_LANGS` (por defecto `spa+eng`; se filtran contra los instalados en la imagen).
- Guardarraíles: `TODOPDF_OCR_TIMEOUT_MS` por página y `TODOPDF_OCR_MAX_PAGES` (50 por defecto).
- Todo el trabajo intermedio ocurre en un **directorio temporal aislado** que se borra SIEMPRE.
- Los **PDFs protegidos con contraseña** devuelven un **400 con un mensaje claro** en lugar de un
  error interno (ni Ghostscript, ni LibreOffice, ni pdf-lib pueden abrirlos).
- En local, para probarlo: `sudo pacman -S tesseract tesseract-data-spa tesseract-data-eng`
  (Debian/Ubuntu: `apt install tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng`).

## Descargador de vídeos (solo usuarios registrados)

Sección **exclusiva para cuentas con sesión iniciada** que descarga vídeos y audio de
**YouTube, TikTok, X (Twitter), Instagram, Facebook, Vimeo, Twitch, SoundCloud, Dailymotion y Reddit**
gracias a **yt-dlp**.

- Pega el enlace → obtén la metadata (título, miniatura, duración, plataforma) → elige
  **Vídeo (MP4/MKV)** o **Audio (MP3)** → descarga.
- Soporta **playlists y canales completos**: si el enlace es una playlist/canal se detecta
  automáticamente y se descarga entera empaquetada en un **ZIP** (vídeos o audio, en orden).
- Todos los endpoints exigen sesión; la URL se valida contra una **lista blanca de dominios** (anti-SSRF)
  y las descargas tienen **timeout y concurrencia limitada**.
- Los archivos se guardan en el volumen del usuario (`downloads/`) y quedan registrados en su historial.
- Frontend: `/descargar-videos` (el enlace solo aparece en la barra de navegación con sesión iniciada).

## Vectorizar imagen a SVG (solo usuarios registrados)

Sección **exclusiva para cuentas con sesión iniciada** que convierte imágenes
(PNG, JPG, WebP, GIF, BMP) en **SVG vectorial** gracias a **vtracer**.

- Sube una imagen → elige **Color** o **Blanco y negro** → obtén un SVG escalable.
- Los resultados se guardan en el volumen del usuario y quedan registrados en su historial
  (`/historial`), con descarga vía `/api/convert/:id/download`.
- Todos los endpoints exigen sesión; el procesamiento tiene **timeout y concurrencia limitada**.
- Backend: `POST /api/vectorize` (multipart `files` + `mode`). Motor: `vtracer` (Python, se instala
  en el venv `/opt/rembg` del backend; no necesita descargar modelos).
- Frontend: `/imagen-a-vectorial` (el enlace solo aparece en la barra de navegación con sesión iniciada).

## Quitar objetos de imagen (solo usuarios registrados)

Sección **exclusiva para cuentas con sesión iniciada** que **borra personas, rocas u otros objetos**
de una imagen y rellena la zona con el entorno (inpainting) gracias al modelo **LaMa big-lama** (ONNX, CPU).

- Sube una imagen (PNG, JPG, WebP) y **pinta con el pincel** sobre el objeto a quitar, o pulsa
  **✨ Auto** y **haz clic** sobre el objeto (máscara automática por flood-fill + detección de primer plano).
- Puedes ajustar el tamaño del pincel, usar el **borrador**, **deshacer** y **limpiar** antes de procesar.
- Los resultados se guardan en el volumen del usuario y quedan registrados en su historial
  (`/historial`), con descarga vía `/api/convert/:id/download`.
- Todos los endpoints exigen sesión; el procesamiento tiene **timeout y concurrencia limitada**.
- Backend: `POST /api/inpaint` (multipart `files` + `mask`) y `POST /api/inpaint/auto-mask`
  (multipart `files` + `x`/`y`). Motor: script Python `backend/scripts/inpaint.py` (modelo
  `big-lama.onnx` — export oficial de OpenCV `inpainting_lama`, ~92MB — descargado en el
  build de Docker a `/models/`).
- Frontend: `/quitar-objetos` (el enlace solo aparece en la barra de navegación con sesión iniciada).

## Convertir documento (Office ↔ Office, solo usuarios registrados)

Sección **exclusiva para cuentas con sesión iniciada** que convierte un documento de Office a
cualquier otro formato de su misma familia gracias a **LibreOffice headless**.

- De formatos **antiguos a modernos**: **DOC → DOCX**, **ODT → DOCX**, **RTF → DOCX**, **TXT → DOCX**,
  **XLS → XLSX**, **ODS → XLSX**, **CSV → XLSX**, **PPT → PPTX**, **ODP → PPTX**.
- Y también al contrario (DOCX → ODT, XLSX → ODS, PPTX → ODP…) o a **PDF**.
- El tipo del archivo se detecta por su **contenido** (magic bytes), no por la extensión. Los
  `.doc`/`.xls`/`.ppt` comparten el mismo contenedor binario (CFB), así que se distinguen
  inspeccionando sus streams internos.
- Un documento solo se convierte dentro de su familia (un DOCX no puede convertirse a XLSX).
- Los resultados se guardan en el volumen del usuario y quedan registrados en su historial
  (`/historial`), con descarga vía `/api/convert/:id/download`.
- Todos los endpoints exigen sesión; LibreOffice trabaja en un **directorio temporal aislado**
  que se elimina siempre y con **concurrencia limitada** (1 conversión a la vez).
- Backend: `POST /api/convert/office-to-office` (multipart `files` + `format`).
- Frontend: `/convertir-documento` (el selector de formato de salida se ajusta al tipo del archivo
  subido; el enlace solo aparece en la barra de navegación con sesión iniciada).

## Creador de flashcards (solo usuarios registrados)

Sección **exclusiva para cuentas con sesión iniciada** para crear tarjetas de estudio
(**término + definición**, con una **ilustración opcional**).

- **Biblioteca de ilustraciones propia**: 36 dibujos SVG repartidos en 6 categorías
  (Animales, Comida, Viaje, Ciencia, Colegio y Música), con buscador y filtro por categoría.
  Es la única fuente de verdad: la usa el editor y también la exportación.
- **Estudiar** (en el navegador): tarjeta giratoria, navegación ‹ ›, orden aleatorio,
  valoración «ya la sabía» / «repasar» y resumen final con repaso de las falladas.
- **Compartir**: genera un **enlace público revocable** (`/flashcard?m=<token>`) con el que
  cualquiera puede ver, estudiar y exportar el mazo **sin cuenta**. El enlace no expone datos
  del dueño y se puede revocar cuando se quiera.
- **Exportar** a **PDF** y **PowerPoint (PPTX)**: una portada y **una tarjeta por página**
  (A6 vertical, 105 × 148 mm), listas para imprimir.
- Los mazos se guardan en la base de datos y las exportaciones en el **historial** del usuario
  (`/historial`, tipos `flashcards-to-pdf` y `flashcards-to-pptx`), con descarga vía
  `/api/convert/:id/download`. La exportación desde un enlace público se sirve en RAM y no se
  registra en ningún historial.
- Backend: `GET/POST /api/flashcards`, `GET/PUT/DELETE /api/flashcards/:id`,
  `POST/DELETE /api/flashcards/:id/share`, `POST /api/flashcards/:id/export/{pdf|pptx}`,
  `GET /api/flashcards/library` y `GET /api/flashcards/share/:token[/export/:format]`
  (las dos últimas son públicas).
- Motor del PDF: **pdf-lib** con una fuente TTF embebida (DejaVu; Noto como alternativa) para
  acentos, eñes y símbolos. Si el mazo usa caracteres que esa fuente no cubre (emoji, CJK…),
  el PDF se genera con **LibreOffice** a partir del PPTX (que trae tipografías Noto).
  El PPTX lo produce **pptxgenjs**, todo en memoria.
- Frontend: `/flashcards` (mis mazos, editor y modo estudiar) y `/flashcard?m=<token>`
  (visor público). El enlace de la herramienta solo aparece en la barra de navegación con
  sesión iniciada.
- En local, el PDF usa `/usr/share/fonts/TTF/DejaVuSans.ttf` y en Docker
  `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (`fonts-dejavu-core`, ya en la imagen);
  se puede forzar otra fuente con `TODOPDF_FLASHCARDS_FONT`.

## Requisitos

- **Docker + Docker Compose (v2)** — recomendado.
- **yt-dlp** + **ffmpeg** — descargador de vídeos (yt-dlp requiere `python3`).
- **Ghostscript**, **Poppler**, **ImageMagick**, **LibreOffice** — conversiones PDF/imágenes/Office.
- **Python 3 + venv con `rembg` y `vtracer`** — quitar fondo de imagen y vectorizar a SVG (ver
  [Dependencias Python](#dependencias-python-venv)).

### Opción A — Docker (recomendado)

La imagen del backend ya instala todas las herramientas de sistema: no necesitas instalar nada más.

### Opción B — Desarrollo local (sin Docker)

Además de **Node.js ≥ 20** y una **MariaDB/MySQL** local, instala las herramientas de sistema
anteriores. Según tu distribución:

- **Arch Linux:**
  ```bash
  sudo pacman -S ghostscript poppler imagemagick libreoffice-fresh ffmpeg python yt-dlp
  ```
- **Debian/Ubuntu:**
  ```bash
  sudo apt install ghostscript poppler-utils imagemagick libreoffice ffmpeg python3 yt-dlp
  ```
- **Alpine (la misma lista que usa el Dockerfile del backend):**
  ```bash
  apk add ghostscript imagemagick poppler-utils \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      font-noto font-noto-cjk ffmpeg yt-dlp tini
  ```

Para ejecutar en local: `cd backend && npm install && npm run dev` (API en :3000, aplica migraciones)
y `cd frontend && npm install && npm run dev` (web en :4321, proxya `/api` a :3000).

## Dependencias del proyecto

### Backend (Node.js) — `backend/package.json`

- `express` + `helmet` + `express-rate-limit` — API y seguridad.
- `express-session` + `express-mysql-session` — sesiones persistentes en MariaDB.
- `knex` + `mysql2` — base de datos y migraciones.
- `multer` — subida de archivos.
- `bcrypt` — hash de contraseñas.
- `sharp`, `pdf-lib`, `pptxgenjs` — conversión de imágenes/PDF/PPT.
- `archiver` — ZIP en memoria.
- `p-limit` — límite de concurrencia.
- `file-type` — validación de magic bytes.
- `dotenv` — variables de entorno.

### Frontend (Astro) — `frontend/package.json`

- `astro` (build estático servido por nginx).

### Herramientas de sistema (imagen del backend / host)

| Herramienta      | Uso                                                          |
| ---------------- | ------------------------------------------------------------ |
| `ghostscript`    | PDF → imágenes y compresión (RAM por pipes)                  |
| `poppler-utils`  | Utilidades PDF (`pdfinfo`, `pdftoppm`)                        |
| `imagemagick`    | Utilidades de imagen adicionales                             |
| `libreoffice-*`  | Conversión PDF ↔ Office (writer/calc/impress)                |
| `tesseract-ocr`  | OCR de PDFs escaneados en PDF → Word (`-spa`, `-eng`)         |
| `ffmpeg`         | Merge de flujos y conversión de audio del descargador        |
| `yt-dlp`         | Descargador de vídeos (requiere `python3`)                   |
| `tini`           | Init ligero para el manejo de señales en el contenedor       |

### Dependencias Python (venv)

Las herramientas **"Quitar fondo"** (rembg) y **"Vectorizar a SVG"** (vtracer) corren en un
**venv Python aislado** (`/opt/rembg` en Docker, `backend/.venv` en local). En local:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install "rembg[cpu]" yt-dlp vtracer
```

> ⚠️ **Arch Linux:** el Python 3.14 del sistema no tiene wheels para `onnxruntime`/`rembg` →
> crear el venv con **Python 3.12** y usar `uv`:
>
> ```bash
> uv venv .venv --python 3.12
> uv pip install --python .venv/bin/python "rembg[cpu]" yt-dlp vtracer
> ```
>
> En Debian/Ubuntu/Alpine el `python3` del sistema (3.11/3.12) vale directo.

Y apunta el `.env` del backend a ese venv (solo en local):

```bash
TODOPDF_REMOVEBG_PYTHON=/ruta/a/backend/.venv/bin/python
TODOPDF_VECTORIZE_PYTHON=/ruta/a/backend/.venv/bin/python
```

La herramienta **"Quitar objetos"** (LaMa big-lama) además necesita el modelo ONNX
`big-lama.onnx` (~92MB, export oficial de OpenCV `inpainting_lama`). En Docker se descarga
en el build a `/models/big-lama.onnx`; en local hay que descargarlo a `backend/.models/`
(ignorado por git):

```bash
mkdir -p backend/.models
curl -L -o backend/.models/big-lama.onnx \
  "https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx"
```

Y en `backend/.env` (solo local):

```bash
TODOPDF_INPAINT_PYTHON=/ruta/a/backend/.venv/bin/python
TODOPDF_INPAINT_MODEL=/ruta/a/backend/.models/big-lama.onnx
```

En Docker esto ya lo hace el `Dockerfile` (instala `rembg[cpu]` y `vtracer` en el venv `/opt/rembg`,
y descarga `big-lama.onnx` a `/models/`), así que en producción no hay que tocar nada.

## Puesta en marcha

```bash
# 1. Configuración (opcional: los valores por defecto ya funcionan)
cp .env.example .env

# 2. Construir y levantar (reconstruye la imagen del backend con el fix de
#    permisos del volumen /data y el UID/GID fijo de todopdf)
docker compose up --build -d

# 3. Abrir la aplicación
#    http://localhost:8080
```

Los tres servicios:

- `frontend` → **http://localhost:8080** (nginx: estáticos + proxy `/api`).
- `backend` → API REST interna en `backend:3000`.
- `db` → MariaDB 11.

Para detener (conserva los datos en volúmenes):

```bash
docker compose down          # conserva volúmenes
docker compose down -v       # ELIMINA volúmenes (datos)
```

### Permisos del volumen `/data` (importante para upgrades)

El backend corre como el usuario **sin privilegios** `todopdf` (UID/GID **1001**,
fijos en el Dockerfile). Los directorios `/data/storage` y `/data/tmp` viven en
el volumen `uploads` de docker compose. Si el volumen se creó en un deploy
anterior con otro UID (por ejemplo `100:101`), el proceso no puede escribir y
TODAS las conversiones fallan con `500 Error interno del servidor`.

Para evitarlo, el **entrypoint** (`backend/entrypoint.sh`) arranca como root,
ejecuta `chown -R todopdf:todopdf /data` y luego baja a `todopdf` con
`setpriv`. Al hacer `docker compose up --build -d` con la imagen nueva, el
volumen se repara automáticamente en el primer arranque. Si el problema
persistiera, puedes forzarlo a mano:

```bash
# Reparar permisos del volumen sin reconstruir (una vez)
docker compose exec -u root backend chown -R todopdf:todopdf /data
docker compose restart backend
```

### Diagnóstico sin terminal

Si alguna herramienta falla y no tienes acceso a los logs del servidor, abre
en el navegador:

- `GET /api/health` → `{ "ok": true }` si el backend y la BD responden.
- `GET /api/diagnostics` → JSON con el estado de **binarios** (gs, pdfinfo,
  soffice, yt-dlp, python3, ffmpeg), **escritura** real en `/data/storage` y
  `/data/tmp`, **módulos** (file-type, sharp, pdf-lib, pptxgenjs, archiver) y
  **BD** (`SELECT 1`).

Para ver el error exacto de un 500 en producción sin logs, activa el flag de
depuración (solo temporal):

```bash
TODOPDF_DEBUG_ERRORS=true docker compose up -d backend
```

Con ese flag, la respuesta 500 incluye `code` y `message` reales (p. ej.
`EACCES`, `ENOENT`), que apuntan directamente a la causa.

## Endpoints de la API

| Método | Ruta                             | Descripción                                      |
| ------ | -------------------------------- | ------------------------------------------------ |
| POST   | `/api/auth/register`             | Crea cuenta (`{ email, password }`)               |
| POST   | `/api/auth/login`                | Inicia sesión (cookie httpOnly)                   |
| POST   | `/api/auth/logout`               | Cierra sesión                                     |
| GET    | `/api/auth/me`                   | Devuelve el usuario actual (o 401)                |
| POST   | `/api/convert/pdf-to-images`     | `multipart` campo `files` (1) + `format` + `quality` |
| POST   | `/api/convert/images-to-pdf`     | `multipart` campo `files` (hasta 10)              |
| POST   | `/api/convert/pdf-to-office`     | `multipart` campo `files` (1) + `format` (`docx`\|`doc`\|`odt`\|`pptx`\|`ppt`) |
| POST   | `/api/convert/office-to-pdf`     | `multipart` campo `files` (1): DOCX/DOC/XLSX/PPTX/PPT/ODT |
| POST   | `/api/convert/office-to-office`  | `multipart` campo `files` (1) + `format` (`docx`\|`odt`\|`doc`\|`rtf`\|`txt`\|`xlsx`\|`ods`\|`xls`\|`csv`\|`pptx`\|`odp`\|`ppt`\|`pdf`) — solo usuarios con sesión |
| GET    | `/api/convert/:id/download`      | Descarga una conversión guardada (solo dueño)     |
| GET    | `/api/history`                   | Historial de conversiones del usuario (solo auth) |
| POST   | `/api/downloader/info`           | Metadata de un vídeo (solo auth, `{ url }`)        |
| POST   | `/api/downloader/download`       | Descarga vídeo/audio (solo auth, `{ url, kind }`)  |
| GET    | `/api/downloader/history`        | Historial de descargas del usuario (solo auth)     |
| GET    | `/api/downloader/:id/download`   | Descarga del archivo guardado (solo dueño)         |
| POST   | `/api/vectorize`                 | Vectoriza una imagen a SVG (solo auth, `files` + `mode`) |
| POST   | `/api/inpaint/auto-mask`         | Máscara automática por clic (solo auth, `files` + `x`/`y`) |
| POST   | `/api/inpaint`                   | Quita objetos de una imagen (solo auth, `files` + `mask`) |

> Invitado: los endpoints de conversión devuelven el archivo (ZIP/JPG/PDF/Office) directamente.
> Autenticado: devuelven `{ id, ... }`; descarga vía `/api/convert/:id/download`.

## Migraciones

Las migraciones (usuarios, conversiones, descargas) se ejecutan automáticamente al arrancar el
backend. Para ejecutarlas manualmente:

```bash
cd backend && npm install && npm run migrate
```

## Seguridad incluida (MVP)

- Ghostscript siempre con `-dSAFER` (sandbox), timeout y límites de páginas/tamaño (anti-DoS).
- LibreOffice en modo headless con **timeout** y perfil de usuario aislado por conversión (anti-DoS).
- Validación de **magic bytes** (`file-type`): no se confía en la extensión.
- Límites de subida diferenciados (invitado vs autenticado) + `express-rate-limit`.
- `helmet`, cookies `httpOnly`/`sameSite=lax`, contraseñas con `bcrypt`.
- Límite de concurrencia de conversiones para proteger la RAM.
- Descargador de vídeos: lista blanca de dominios (anti-SSRF), timeout y concurrencia limitada.
- Usuario sin privilegios en el contenedor del backend.

## Fuera de alcance (próximos pasos)

Verificación de email, OAuth, cuotas por usuario, marca de agua,
HTTPS (recomendado detrás de Caddy/Traefik) y jobs asíncronos para PDFs muy grandes.
