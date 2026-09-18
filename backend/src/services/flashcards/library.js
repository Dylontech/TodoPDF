'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../../config');
const { httpError } = require('../../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Biblioteca de ilustraciones propias para las flashcards.
 *
 * Los SVG viven en `backend/assets/flashcards/<categoria>/<slug>.svg` y son la
 * ÚNICA fuente de verdad: el catálogo que consume el editor, la validación de
 * las tarjetas y la exportación a PDF/PPTX leen de aquí.
 *
 * El id de una imagen es `<categoria>/<slug>` (p. ej. `animales/perro`) y se
 * valida SIEMPRE contra este manifest (whitelist → nunca se construyen rutas
 * con datos del usuario).
 * ─────────────────────────────────────────────────────────────
 */

const LIBRARY_DIR = config.flashcards.libraryDir;

/** Categorías y sus ilustraciones (slug → etiqueta legible). */
const CATEGORIES = [
  {
    id: 'animales',
    label: 'Animales',
    items: {
      perro: 'Perro',
      gato: 'Gato',
      oveja: 'Oveja',
      pajaro: 'Pájaro',
      pez: 'Pez',
      mariposa: 'Mariposa'
    }
  },
  {
    id: 'comida',
    label: 'Comida',
    items: {
      manzana: 'Manzana',
      platano: 'Plátano',
      pizza: 'Pizza',
      taza: 'Taza de café',
      tarta: 'Tarta',
      helado: 'Helado'
    }
  },
  {
    id: 'viaje',
    label: 'Viaje',
    items: {
      avion: 'Avión',
      coche: 'Coche',
      maleta: 'Maleta',
      mapa: 'Mapa',
      barco: 'Barco',
      tren: 'Tren'
    }
  },
  {
    id: 'ciencia',
    label: 'Ciencia',
    items: {
      atomo: 'Átomo',
      microscopio: 'Microscopio',
      planeta: 'Planeta',
      'tubo-ensayo': 'Tubo de ensayo',
      adn: 'ADN',
      bombilla: 'Bombilla'
    }
  },
  {
    id: 'colegio',
    label: 'Colegio',
    items: {
      libro: 'Libro',
      lapiz: 'Lápiz',
      mochila: 'Mochila',
      regla: 'Regla',
      calculadora: 'Calculadora',
      birrete: 'Birrete'
    }
  },
  {
    id: 'musica',
    label: 'Música',
    items: {
      guitarra: 'Guitarra',
      piano: 'Piano',
      nota: 'Nota musical',
      auriculares: 'Auriculares',
      microfono: 'Micrófono',
      tambor: 'Tambor'
    }
  }
];

/** Índice plano: id (`categoria/slug`) → { category, categoryLabel, slug, label }. */
const INDEX = new Map();
for (const category of CATEGORIES) {
  for (const [slug, label] of Object.entries(category.items)) {
    INDEX.set(`${category.id}/${slug}`, {
      id: `${category.id}/${slug}`,
      category: category.id,
      categoryLabel: category.label,
      slug,
      label
    });
  }
}

/** URL pública (relativa) de una ilustración. */
function imageUrl(id) {
  return `/api/flashcards/library/${id}.svg`;
}

/** ¿El id existe en la biblioteca? (whitelist) */
function isValidImageId(id) {
  return typeof id === 'string' && INDEX.has(id);
}

/** Ruta absoluta del SVG en disco (solo para ids válidos). */
function imageFile(id) {
  if (!isValidImageId(id)) {
    throw httpError(400, `La imagen "${id}" no existe en la biblioteca.`);
  }
  return path.join(LIBRARY_DIR, `${id}.svg`);
}

/** Contenido SVG de una ilustración de la biblioteca. */
async function readImage(id) {
  const file = imageFile(id);
  try {
    return await fs.readFile(file);
  } catch {
    throw httpError(404, `La imagen "${id}" no está disponible.`);
  }
}

/** Etiqueta legible de una ilustración (o null si no existe). */
function imageLabel(id) {
  const item = INDEX.get(id);
  return item ? item.label : null;
}

/** Catálogo completo para el editor de flashcards. */
function listCategories() {
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    items: Object.entries(category.items).map(([slug, label]) => {
      const id = `${category.id}/${slug}`;
      return { id, label, url: imageUrl(id) };
    })
  }));
}

module.exports = {
  LIBRARY_DIR,
  CATEGORIES,
  listCategories,
  isValidImageId,
  imageUrl,
  imageFile,
  imageLabel,
  readImage
};
