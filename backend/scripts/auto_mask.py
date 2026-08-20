#!/usr/bin/env python3
"""
TodoPDF — Máscara automática por clic para "Quitar objetos".

Lee la imagen por stdin y las coordenadas (x, y) del clic (escaladas al
tamaño real de la imagen) y genera una máscara (blanco sobre negro) de la
región que contiene el objeto pulsado; la escribe en <out_path>.

Estrategia:
  1. Flood fill (OpenCV) desde el punto del clic → captura objetos con color
     uniforme (rocas, muebles, ...). Si el área resultante es coherente (ni
     minúscula ni casi toda la imagen) se usa directamente.
  2. Fallback: rembg/u2net (ya instalado para quitar fondo) → el componente
     conexo de la máscara de primer plano que contiene el clic (ideal para
     personas u objetos con colores variados).

Uso:
    python3 auto_mask.py <out_path> <x> <y> [model]

  <out_path>  Ruta absoluta del PNG de máscara de salida.
  <x>, <y>    Coordenadas del clic en píxeles de la imagen original.
  [model]     Modelo de rembg para el fallback: "u2net" (por defecto) o
              "u2netp". También puede venir de TODOPDF_REMOVEBG_MODEL.

Códigos de salida: 0 OK, 2 mal uso/error de entrada, 3 sin datos por stdin.
"""
import os
import sys


def main():
    if len(sys.argv) < 4:
        sys.stderr.write("Uso: auto_mask.py <out_path> <x> <y> [model]\n")
        return 2

    out_path = sys.argv[1]
    x = int(sys.argv[2])
    y = int(sys.argv[3])
    model = sys.argv[4] if len(sys.argv) > 4 else os.environ.get("TODOPDF_REMOVEBG_MODEL", "u2net")

    import cv2
    import numpy as np

    data = sys.stdin.buffer.read()
    if not data:
        sys.stderr.write("No se recibieron datos por stdin.\n")
        return 3

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        sys.stderr.write("No se pudo decodificar la imagen.\n")
        return 2

    h, w = img.shape[:2]
    if not (0 <= x < w and 0 <= y < h):
        sys.stderr.write("Coordenadas fuera de la imagen (%d,%d en %dx%d).\n" % (x, y, w, h))
        return 2

    # 1) Flood fill desde el clic.
    mask = flood_fill_mask(img, x, y)
    area = cv2.countNonZero(mask)
    total = h * w

    # El flood fill es válido si cubre un objeto coherente (ni casi toda la
    # imagen ni una mota de polvo).
    if area < total * 0.9 and area > max(300, total * 0.0005):
        if write_mask(out_path, mask):
            return 0

    # 2) Fallback: rembg/u2net (primer plano) + componente conexo del clic.
    mask2 = u2net_click_mask(img, x, y, model)
    if mask2 is not None and cv2.countNonZero(mask2) > 0:
        if write_mask(out_path, mask2):
            return 0

    sys.stderr.write("No se pudo generar una máscara automática.\n")
    return 2


def flood_fill_mask(img, x, y):
    """Región conexa de color similar al píxel pulsado (flood fill)."""
    import cv2
    import numpy as np

    h, w = img.shape[:2]
    # Máscara de floodFill: borde de 1px añadido por OpenCV.
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 8 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)  # 8-vecinos, rellena con 255
    lo = (12, 12, 12)
    up = (12, 12, 12)
    cv2.floodFill(img, mask, (x, y), (0, 0, 0), lo, up, flags)
    return mask[1:-1, 1:-1]


def u2net_click_mask(img, x, y, model):
    """Máscara del objeto que contiene el clic usando rembg/u2net."""
    import cv2
    import numpy as np

    try:
        from rembg import new_session, remove
    except Exception as e:
        sys.stderr.write("rembg no disponible: %s\n" % e)
        return None

    ok, encoded = cv2.imencode(".png", img)
    if not ok:
        return None

    try:
        result = remove(encoded.tobytes(), session=new_session(model))
    except Exception as e:
        sys.stderr.write("rembg falló: %s\n" % e)
        return None

    rgba = cv2.imdecode(np.frombuffer(result, np.uint8), cv2.IMREAD_UNCHANGED)
    if rgba is None:
        return None

    if rgba.shape[2] == 4:
        alpha = rgba[:, :, 3]
    else:
        alpha = np.full(rgba.shape[:2], 255, np.uint8)
    _, fg = cv2.threshold(alpha, 127, 255, cv2.THRESH_BINARY)

    # Componente conexo del primer plano que contiene el punto del clic.
    n, labels, _, _ = cv2.connectedComponentsWithStats(fg)
    if n <= 1:
        return None
    label = labels[y, x]
    if label <= 0:
        return None
    return (labels == label).astype(np.uint8) * 255


def write_mask(out_path, mask):
    import cv2

    ok, encoded = cv2.imencode(".png", mask)
    if not ok:
        sys.stderr.write("No se pudo codificar la máscara.\n")
        return False
    with open(out_path, "wb") as f:
        f.write(encoded.tobytes())
    return True


if __name__ == "__main__":
    sys.exit(main())
