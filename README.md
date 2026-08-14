# TodoPDF 📄

Aplicación web **autoalojada** estilo iLovePDF con un enfoque estricto en la **privacidad**.

- **Backend:** Node.js (API REST) + Knex (MariaDB/MySQL).
- **Frontend:** Astro (build estático servido por nginx).
- **Infraestructura:** Docker + Docker Compose (con Ghostscript, ImageMagick, Poppler, LibreOffice, ffmpeg y yt-dlp).

## Conversiones del MVP

| Herramienta        | Flujo invitado (RAM)                      | Flujo autenticado (disco + historial) |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| PDF → Imágenes     | Ghostscript por pipes, ZIP en memoria     | Guarda JPG/PNG… en volumen + historial |
| Imágenes → PDF     | sharp + pdf-lib en Buffers, PDF en memoria | Guarda PDF en volumen + historial      |
| PDF → Office (DOCX/DOC/ODT/PPTX/PPT) | LibreOffice + pptxgenjs en temp aislado | Guarda documento en volumen + historial |
| Office → PDF (DOCX/DOC/XLSX/PPTX/PPT/ODT) | LibreOffice en temp aislado | Guarda PDF en volumen + historial |

## Flujos de privacidad

1. **Usuarios invitados:** el procesamiento de PDF ↔ imágenes ocurre estrictamente en **memoria RAM**
   (Buffers; Ghostscript por STDIN/STDOUT, nada toca el disco). Las herramientas de **Office** requieren
   que LibreOffice escriba archivos de trabajo, por lo que usan un **directorio temporal aislado por
   conversión** que se elimina SIEMPRE al terminar (éxito o error). No persiste nada para invitados.
2. **Usuarios autenticados:** los archivos se procesan, se guardan en un **volumen del servidor**
   (`uploads`) y cada conversión se registra en el **historial** de la base de datos (Knex).

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

## Requisitos

- **Docker + Docker Compose (v2)** — recomendado.
- **yt-dlp** + **ffmpeg** — descargador de vídeos (yt-dlp requiere `python3`).
- **Ghostscript**, **Poppler**, **ImageMagick**, **LibreOffice** — conversiones PDF/imágenes/Office.

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
| `ffmpeg`         | Merge de flujos y conversión de audio del descargador        |
| `yt-dlp`         | Descargador de vídeos (requiere `python3`)                   |
| `tini`           | Init ligero para el manejo de señales en el contenedor       |

## Puesta en marcha

```bash
# 1. Configuración (opcional: los valores por defecto ya funcionan)
cp .env.example .env

# 2. Construir y levantar
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
| GET    | `/api/convert/:id/download`      | Descarga una conversión guardada (solo dueño)     |
| GET    | `/api/history`                   | Historial de conversiones del usuario (solo auth) |
| POST   | `/api/downloader/info`           | Metadata de un vídeo (solo auth, `{ url }`)        |
| POST   | `/api/downloader/download`       | Descarga vídeo/audio (solo auth, `{ url, kind }`)  |
| GET    | `/api/downloader/history`        | Historial de descargas del usuario (solo auth)     |
| GET    | `/api/downloader/:id/download`   | Descarga del archivo guardado (solo dueño)         |

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
