#!/usr/bin/env python3
"""
TodoPDF — Vectorizar imagen a SVG (vtracer).

Lee la imagen por stdin, la vectoriza con vtracer y escribe el resultado
(SVG) en <out_path>.

Uso:
    python3 vectorize.py <out_path> <img_format> [mode]

  <out_path>    Ruta absoluta del archivo SVG de salida.
  <img_format>  Formato de la imagen de entrada: "png", "jpg", "webp",
                "gif" o "bmp".
  [mode]        "color" (por defecto) o "binary" (blanco y negro).
                También puede venir de TODOPDF_VECTORIZE_MODE.
"""
import os
import sys


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Uso: vectorize.py <out_path> <img_format> [mode]\n")
        return 2

    out_path = sys.argv[1]
    img_format = sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TODOPDF_VECTORIZE_MODE", "color")

    if mode not in ("color", "binary"):
        sys.stderr.write("Modo inválido: debe ser 'color' o 'binary'.\n")
        return 2

    # Import tardío: acelera el arranque y mantiene la dependencia opcional.
    import vtracer

    data = sys.stdin.buffer.read()
    if not data:
        sys.stderr.write("No se recibieron datos por stdin.\n")
        return 3

    # convert_raw_image_to_svg acepta los mismos parámetros que
    # convert_image_to_svg_py (colormode, hierarchical, mode, ...).
    svg = vtracer.convert_raw_image_to_svg(data, img_format=img_format, colormode=mode)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
