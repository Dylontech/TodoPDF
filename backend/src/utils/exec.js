'use strict';

const { spawn } = require('node:child_process');
const config = require('../config');
const { httpError } = require('./errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Ejecución de comandos externos con entrada/salida por pipes.
 * Compartido por Ghostscript (PDF → imágenes) y LibreOffice
 * (PDF ↔ Office). Aplica un timeout anti-DoS.
 * ─────────────────────────────────────────────────────────────
 *
 * @param {string} cmd    Binario (gs, pdfinfo, soffice, ...).
 * @param {string[]} args Argumentos.
 * @param {Buffer} [input] Buffer que se escribe en stdin (opcional:
 *                        algunos binarios leen de un archivo, no de stdin).
 * @param {object} [opts] { timeoutMs }
 * @returns {Promise<{ stdout: Buffer, stderr: string }>}
 */
function runCommand(cmd, args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(httpError(500, `No se pudo iniciar "${cmd}".`));
    }

    const chunks = [];
    let stderr = '';
    let settled = false;
    let timer;

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (stderr += c.toString()));

    child.on('error', (err) => finish(reject, httpError(500, `Error al ejecutar "${cmd}": ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.slice(0, 400);
        return finish(reject, httpError(500, `"${cmd}" falló (código ${code}): ${detail}`));
      }
      finish(resolve, { stdout: Buffer.concat(chunks), stderr });
    });

    // Timeout anti-DoS: mata el proceso si se excede
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ya terminó */ }
      finish(reject, httpError(500, `"${cmd}" excedió el tiempo límite (${opts.timeoutMs || config.conversion.gsTimeoutMs} ms).`));
    }, opts.timeoutMs || config.conversion.gsTimeoutMs);

    // Envía el buffer por stdin (si existe) y cierra el stream
    child.stdin.on('error', () => { /* stdin cerrado por el comando */ });
    if (input) {
      child.stdin.write(input, (err) => {
        if (err) return finish(reject, httpError(500, `Error escribiendo a "${cmd}".`));
        child.stdin.end();
      });
    } else {
      child.stdin.end();
    }
  });
}

module.exports = { runCommand };
