#!/usr/bin/env python3
"""
TodoPDF — Quitar objetos de una imagen con IA (LaMa / big-lama ONNX).

Lee la imagen por stdin y la máscara (blanco = zona a rellenar) desde un
archivo, aplica el inpainting con el modelo big-lama y escribe el resultado
(PNG) en <out_path>.

Uso:
    python3 inpaint.py <out_path> <mask_path> [model_path]

  <out_path>    Ruta absoluta del PNG de salida.
  <mask_path>   Ruta absoluta del PNG de máscara (blanco sobre negro).
  [model_path]  Ruta al modelo ONNX big-lama. También puede venir de la
                variable de entorno TODOPDF_INPAINT_MODEL.

Códigos de salida: 0 OK, 2 mal uso/error de entrada, 3 sin datos por stdin.
"""
import os
import sys


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Uso: inpaint.py <out_path> <mask_path> [model_path]\n")
        return 2

    out_path = sys.argv[1]
    mask_path = sys.argv[2]
    model_path = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("TODOPDF_INPAINT_MODEL", "")

    if not model_path or not os.path.isfile(model_path):
        sys.stderr.write("No se encontró el modelo big-lama ONNX: %s\n" % model_path)
        return 2

    # Imports tardíos: aceleran el arranque y mantienen las dependencias opcionales.
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

    mask = cv2.imdecode(np.fromfile(mask_path, np.uint8), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        sys.stderr.write("No se pudo decodificar la máscara.\n")
        return 2

    h, w = img.shape[:2]
    mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
    _, mask = cv2.threshold(mask, 20, 255, cv2.THRESH_BINARY)

    if cv2.countNonZero(mask) == 0:
        sys.stderr.write("La máscara está vacía (no hay nada que borrar).\n")
        return 2

    result = inpaint_lama(img, mask, model_path)

    ok, encoded = cv2.imencode(".png", result)
    if not ok:
        sys.stderr.write("No se pudo codificar el PNG de salida.\n")
        return 2
    with open(out_path, "wb") as f:
        f.write(encoded.tobytes())
    return 0


def inpaint_lama(img, mask, model_path):
    """Aplica el inpainting con el modelo LaMa de OpenCV (inpainting_lama_2025jan).

    El modelo ONNX tiene entrada FIJA 512x512. Para imágenes mayores se
    redimensiona a 512 manteniendo el aspecto (con padding), se infiere y el
    resultado se devuelve al tamaño original. Convenciones del modelo (iguales
    que la demo oficial de OpenCV `inpainting_lama/demo.py`):
      - imagen: BGR, [0,255] → [0,1] (sin swap de canales).
      - máscara: 1 = zona a RELLENAR (la pintada), 0 = conservar.
      - salida: BGR [0,255] (no requiere desnormalizar).
    """
    import cv2
    import numpy as np
    import onnxruntime as ort

    orig_h, orig_w = img.shape[:2]
    TARGET = 512

    # Escala para que el lado mayor sea 512 (mantiene el aspecto, sin estirar).
    scale = min(TARGET / float(orig_w), TARGET / float(orig_h))
    nw = max(1, int(round(orig_w * scale)))
    nh = max(1, int(round(orig_h * scale)))
    img_s = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    mask_s = cv2.resize(mask, (nw, nh), interpolation=cv2.INTER_NEAREST)

    # Padding a 512x512: imagen con reflect (contexto), máscara con 0.
    pad_b, pad_r = TARGET - nh, TARGET - nw
    img_p = cv2.copyMakeBorder(img_s, 0, pad_b, 0, pad_r, cv2.BORDER_REFLECT_101)
    mask_p = cv2.copyMakeBorder(mask_s, 0, pad_b, 0, pad_r, cv2.BORDER_CONSTANT, value=0)

    # Dilatar la máscara un poco ayuda a que LaMa rellene los bordes con limpieza.
    kernel = np.ones((7, 7), np.uint8)
    mask_p = cv2.dilate(mask_p, kernel, iterations=1)

    # Preproceso del modelo de OpenCV: imagen BGR → [0,1], máscara 1 = rellenar.
    image = (img_p.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]  # [1,3,512,512]
    mask_in = (mask_p.astype(np.float32) / 255.0)[None, None]            # [1,1,512,512]

    opts = ort.SessionOptions()
    # Silencia los warnings de initializers sin usar (el modelo trae cientos).
    opts.log_severity_level = 3
    sess = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
    feeds = {}
    for name in [i.name for i in sess.get_inputs()]:
        if "mask" in name.lower():
            feeds[name] = mask_in
        else:
            feeds[name] = image
    out = sess.run(None, feeds)[0][0].transpose(1, 2, 0)  # [512,512,3] BGR [0,255]

    # Postproceso: salida ya en [0,255] BGR.
    res = out.clip(0, 255).astype(np.uint8)

    # Quitar el padding y devolver al tamaño original.
    res = res[:nh, :nw]
    if (nw, nh) != (orig_w, orig_h):
        res = cv2.resize(res, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
    return res


if __name__ == "__main__":
    sys.exit(main())
