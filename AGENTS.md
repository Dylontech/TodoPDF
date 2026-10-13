# AGENTS.md - Configuracion del proyecto

## Objetivo

Trabajar con cambios pequenos, verificables y eficientes en recursos. El README es la fuente para instalacion, despliegue y troubleshooting detallado; este archivo contiene solo politicas de trabajo del agente y excepciones locales.

## Hardware y rendimiento local

- Host: RTX 3050 con 4 GB de VRAM y 24 GB de RAM DDR5.
- Modelo local: Ollama con `qwen2.5-coder:14b`. No asumir que el modelo cabe completo en VRAM: cuantizacion, contexto y offload deben comprobarse en la maquina.
- La RAM se comparte entre Ollama, Docker, Node, MariaDB, LibreOffice, Ghostscript, Python y modelos ONNX.
- Mantener el contexto local corto, cargar solo archivos relevantes y ejecutar una sola operacion IA/Office costosa por vez salvo que la memoria disponible confirme lo contrario.
- No ejecutar simultaneamente un build Docker pesado, Ollama y conversiones ONNX/LibreOffice. Durante builds largos, detener o limitar Ollama.
- No subir limites de concurrencia sin revisar RAM, swap, `docker stats` y posibles OOM.

## Proveedores y presupuesto

Elegir un solo proveedor por tarea. No repetir la misma consulta en varios modelos.

| Tarea | Proveedor preferente |
| --- | --- |
| Buscar, leer, editar de forma rutinaria y validar | Herramientas locales + Ollama |
| Implementacion acotada y explicaciones | Ollama (`qwen2.5-coder:14b`) |
| Arquitectura o planificacion amplia | DeepSeek |
| Depuracion compleja, rendimiento o revision tecnica | NVIDIA NIM |
| Integracion interactiva y revision final de alto valor | Copilot |

Politica para los 200 creditos mensuales de Copilot:

- Buscar primero en el repositorio y enviar solo el contexto necesario.
- Preferir comandos deterministas y resultados resumidos frente a logs completos repetidos.
- Dividir el trabajo en hipotesis, edicion pequena, validacion y checkpoint.
- Reservar Copilot para decisiones o revisiones donde aporte valor adicional; usar DeepSeek/NIM cuando sean adecuados y esten disponibles.
- No enviar `.env`, claves, tokens, documentos de usuarios ni datos sensibles a proveedores remotos sin autorizacion explicita.
- No asumir nombres de variables, extensiones, endpoints, cuotas o latencias concretas para DeepSeek/NIM sin comprobar su integracion local.

## Flujo de trabajo

1. Identificar el archivo, simbolo, error o prueba que controla el comportamiento.
2. Formular una hipotesis local y una comprobacion barata que pueda refutarla.
3. Hacer el cambio minimo. Se permiten varios archivos coordinados cuando una API, migracion y cliente dependan entre si.
4. Ejecutar inmediatamente la validacion mas estrecha disponible.
5. Revisar el diff y resumir cambios, validaciones y riesgos restantes.

No hacer refactors no relacionados ni crear dependencias de lint/test por iniciativa propia. No documentar herramientas que no existan en el repositorio.

## Validaciones reales

- Backend JavaScript: `node --check` sobre los archivos modificados o todos los `backend/src/**/*.js` si el cambio es transversal.
- Frontend Astro: `npm --prefix frontend run build`.
- Compose: `docker compose config --quiet`.
- Migraciones: usar `npm --prefix backend run migrate` solo cuando cambie el esquema o se solicite.
- No ejecutar ni mencionar `tsc`, ESLint, Jest/Vitest, Playwright o `cargo check` hasta que se incorporen y configuren en el proyecto.

## Entorno local TodoPDF

- Backend de desarrollo: `:3200`.
- Frontend Astro: `:4321`.
- Docker: frontend publicado en `:8080`; el backend escucha en `:3000` dentro de la red Compose.
- Para comandos del backend usar `npm --prefix backend ...` desde la raiz o trabajar explicitamente dentro de `backend`.
- Consultar [README.md](README.md) para requisitos, despliegue, variables y diagnostico.