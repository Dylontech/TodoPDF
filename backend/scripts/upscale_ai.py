#!/usr/bin/env python3
"""
TodoPDF — Reescalar imagen con IA (Real-ESRGAN x4plus ONNX).

Lee la imagen por stdin, aplica UNA pasada de superresolución ×4 con el
modelo Real-ESRGAN (RRDBNet) procesando por tiles con solape (el modelo
trabaja con entradas pequeñas; así se soporta cualquier tamaño) y escribe
el resultado (PNG) en <out_path>.

La escala final (x8/x16) la completa sharp en Node con lanczos3 a partir
de este ×4: aquí solo se hace la pasada de IA.

Uso:
    python3 upscale_ai.py <out_path> [model_path]

  <out_path>    Ruta absoluta del PNG de salida.
  [model_path]  Ruta al modelo ONNX Real-ESRGAN x4plus. También puede venir
                de la variable de entorno TODOPDF_UPSCALE_MODEL.

Códigos de salida: 0 OK, 2 mal uso/error de entrada, 3 sin datos por stdin.
"""
import os
import sys


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Uso: upscale_ai.py <out_path> [model_path]\n")
        return 2

    out_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("TODOPDF_UPSCALE_MODEL", "")

    if not model_path or not os.path.isfile(model_path):
        sys.stderr.write("No se encontró el modelo Real-ESRGAN ONNX: %s\n" % model_path)
        return 2

    # Imports tardíos: aceleran el arranque y mantienen las dependencias opcionales.
    import cv2
    import numpy as np

    data = sys.stdin.buffer.read()
    if not data:
        sys.stderr.write("No se recibieron datos por stdin.\n")
        return 3

    # IMREAD_UNCHANGED conserva el canal alfa si existe (PNG/WebP/TIFF RGBA).
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        sys.stderr.write("No se pudo decodificar la imagen.\n")
        return 2

    result = upscale_x4(img, model_path)

    ok, encoded = cv2.imencode(".png", result)
    if not ok:
        sys.stderr.write("No se pudo codificar el PNG de salida.\n")
        return 2
    with open(out_path, "wb") as f:
        f.write(encoded.tobytes())
    return 0


def upscale_x4(img, model_path):
    """Aplica UNA pasada ×4 del modelo Real-ESRGAN (RRDBNet) por tiles.

    Convenciones del modelo (iguales que la demo oficial de Real-ESRGAN):
      - entrada: BGR float32 [0,1], shape [1,3,H,W];
      - salida: BGR float32 [0,1], 4× el tamaño de entrada.
    El tamaño de tile se deduce del shape de entrada del ONNX: si el export
    es de tamaño fijo (p. ej. 128×128) se usa ese; si es dinámico, 256.
    Los tiles se solapan OVERLAP px y el solape se descarta al coser para
    que las costuras entre tiles no produzcan artefactos visibles.
    """
    import cv2
    import numpy as np
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.log_severity_level = 3  # silencia warnings de initializers sin usar
    sess = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    # Tile según el shape declarado por el modelo (int → fijo; str/dim → dinámico).
    shape = sess.get_inputs()[0].shape  # p. ej. [1,3,128,128] o [1,3,'H','W']
    tile = 256
    try:
        fixed = [d for d in shape[2:] if isinstance(d, int) and d > 0]
        if len(fixed) == 2:
            tile = min(fixed)
    except Exception:
        pass
    overlap = 16

    # Canal alfa: el modelo trabaja en RGB/BGR de 3 canales. Si hay alfa, se
    # separa, se escala el RGB con la IA y el alfa con cv2 (práctica estándar
    # de Real-ESRGAN), y se vuelve a fusionar al final.
    has_alpha = img.ndim == 3 and img.shape[2] == 4
    if has_alpha:
        alpha = img[:, :, 3]
        bgr = img[:, :, :3]
    else:
        bgr = img

    h, w = bgr.shape[:2]
    scale = 4
    out = np.zeros((h * scale, w * scale, 3), dtype=np.float32)

    # Padding reflect para que los bordes también entren en un tile completo.
    # El padding inferior/derecho se agranda si la imagen es menor que el tile
    # (el modelo es de shape FIJA: todo tile debe medir exactamente tile×tile).
    pad = overlap // 2
    pad_b = max(pad, tile - h - pad)
    pad_r = max(pad, tile - w - pad)
    padded = cv2.copyMakeBorder(bgr, pad, pad_b, pad, pad_r, cv2.BORDER_REFLECT_101)
    ph, pw = padded.shape[:2]

    step = tile - overlap
    ys = list(range(0, max(ph - tile, 0) + 1, step)) or [0]
    xs = list(range(0, max(pw - tile, 0) + 1, step)) or [0]
    if ys[-1] + tile < ph:
        ys.append(ph - tile)
    if xs[-1] + tile < pw:
        xs.append(pw - tile)

    total = len(ys) * len(xs)
    done = 0
    for y in ys:
        for x in xs:
            tile_img = padded[y : y + tile, x : x + tile]
            inp = (tile_img.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
            o = sess.run(None, {input_name: inp})[0]
            o = np.squeeze(o)
            if o.ndim == 3 and o.shape[0] in (1, 3):
                o = o.transpose(1, 2, 0)  # [C,H,W] → [H,W,C]
            o = np.clip(o, 0.0, 1.0)

            # Zona válida del tile (sin solape) y su posición en la salida.
            # La fila global r de la salida corresponde a la fila (r - ty) del
            # tile escalado: ty es la esquina del tile en coords de salida.
            ty = (y - pad) * scale
            tx = (x - pad) * scale
            vy = overlap // 2 * scale
            vx = overlap // 2 * scale
            vh = (tile_img.shape[0] - overlap) * scale
            vw = (tile_img.shape[1] - overlap) * scale

            # Recorte a los límites reales de la imagen de salida.
            sy0 = max(0, ty + vy)
            sy1 = min(out.shape[0], ty + vy + vh)
            sx0 = max(0, tx + vx)
            sx1 = min(out.shape[1], tx + vx + vw)
            if sy1 <= sy0 or sx1 <= sx0:
                continue
            oy0 = sy0 - ty
            ox0 = sx0 - tx
            out[sy0:sy1, sx0:sx1] = o[oy0 : oy0 + (sy1 - sy0), ox0 : ox0 + (sx1 - sx0)]

            done += 1
            sys.stderr.write("Tile %d/%d\n" % (done, total))
            sys.stderr.flush()

    result = (out * 255.0).round().astype(np.uint8)

    if has_alpha:
        big_alpha = cv2.resize(alpha, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
        result = cv2.merge([result, big_alpha])

    return result


if __name__ == "__main__":
    sys.exit(main())
