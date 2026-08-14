#!/usr/bin/env python3
"""
TodoPDF — Quitar fondo de imagen con IA (rembg/u2net).

Lee la imagen por stdin, elimina el fondo con rembg y escribe el resultado
(PNG con canal alfa / transparencia) en <out_path>.

Uso:
    python3 remove_bg.py <out_path> [model]

  <out_path>  Ruta absoluta del PNG de salida.
  [model]     Modelo ONNX de rembg: "u2net" (por defecto, mayor calidad)
              o "u2netp" (ligero/rápido). También puede venir de la variable
              de entorno TODOPDF_REMOVEBG_MODEL.
"""
import os
import sys


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Uso: remove_bg.py <out_path> [model]\n")
        return 2

    out_path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("TODOPDF_REMOVEBG_MODEL", "u2net")

    # Import tardío: acelera el arranque y mantiene las dependencias opcionales.
    from rembg import new_session, remove

    data = sys.stdin.buffer.read()
    if not data:
        sys.stderr.write("No se recibieron datos por stdin.\n")
        return 3

    session = new_session(model)
    result = remove(data, session=session)  # bytes (PNG RGBA con transparencia)

    with open(out_path, "wb") as f:
        f.write(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
