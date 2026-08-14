# TodoPDF 📄

Aplicación web **autoalojada** estilo iLovePDF con un enfoque estricto en la **privacidad**.

- **Backend:** Node.js (API REST) + Knex (MariaDB/MySQL).
- **Frontend:** Astro (build estático servido por nginx).
- **Infraestructura:** Docker + Docker Compose (con Ghostscript e ImageMagick).

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

## Requisitos

- Docker + Docker Compose (v2).

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

> Invitado: los endpoints de conversión devuelven el archivo (ZIP/JPG/PDF/Office) directamente.
> Autenticado: devuelven `{ id, ... }`; descarga vía `/api/convert/:id/download`.

## Migraciones

La migración inicial se ejecuta automáticamente al arrancar el backend. Para ejecutarla manualmente:

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
- Usuario sin privilegios en el contenedor del backend.

## Fuera de alcance (próximos pasos)

Verificación de email, OAuth, cuotas por usuario, merge/split de PDFs, marca de agua,
HTTPS (recomendado detrás de Caddy/Traefik) y jobs asíncronos para PDFs muy grandes.
