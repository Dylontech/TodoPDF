/**
 * Tipos y utilidades del creador de flashcards.
 * Compartidos por /flashcards (editor + estudio) y /flashcard (visor público).
 */

import { api } from './api';

// ── Modelos ──────────────────────────────────────────────────

export interface FlashcardInput {
  term: string;
  definition: string;
  image: string | null;
}

export interface DeckSummary {
  id: number;
  title: string;
  description: string;
  cardCount: number;
  shareToken: string | null;
  updatedAt: string;
}

export interface Deck {
  id: number;
  title: string;
  description: string;
  shareToken: string | null;
  updatedAt: string;
  cards: FlashcardInput[];
}

export interface PublicCard {
  term: string;
  definition: string;
  image: string | null;
  imageUrl: string | null;
}

export interface PublicDeck {
  title: string;
  description: string;
  cards: PublicCard[];
}

export interface LibraryItem {
  id: string;
  label: string;
  url: string;
}

export interface LibraryCategory {
  id: string;
  label: string;
  items: LibraryItem[];
}

export interface ExportResult {
  id: number;
  name: string;
  format: string;
  size: number;
}

// ── API ──────────────────────────────────────────────────────

/** Catálogo de la biblioteca de ilustraciones (público). */
export const fetchLibrary = async (): Promise<LibraryCategory[]> =>
  (await api<{ categories: LibraryCategory[] }>('/flashcards/library')).categories;

/** Mazos del usuario. */
export const fetchDecks = async (): Promise<DeckSummary[]> =>
  (await api<{ decks: DeckSummary[] }>('/flashcards')).decks;

/** Mazo propio completo. */
export const fetchDeck = async (id: number): Promise<Deck> =>
  (await api<{ deck: Deck }>(`/flashcards/${id}`)).deck;

/** Crea un mazo. */
export const createDeck = async (payload: {
  title: string;
  description: string;
  cards: FlashcardInput[];
}): Promise<Deck> =>
  (
    await api<{ deck: Deck }>('/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  ).deck;

/** Actualiza un mazo completo. */
export const updateDeck = async (
  id: number,
  payload: { title: string; description: string; cards: FlashcardInput[] }
): Promise<Deck> =>
  (
    await api<{ deck: Deck }>(`/flashcards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  ).deck;

/** Borra un mazo. */
export const deleteDeck = (id: number): Promise<{ ok: boolean }> =>
  api<{ ok: boolean }>(`/flashcards/${id}`, { method: 'DELETE' });

/** Activa o revoca el enlace público del mazo. */
export const setShare = (
  id: number,
  enabled: boolean
): Promise<{ shareToken: string | null; sharePath: string | null }> =>
  api<{ shareToken: string | null; sharePath: string | null }>(`/flashcards/${id}/share`, {
    method: enabled ? 'POST' : 'DELETE'
  });

/** Exporta el mazo (se guarda en el historial del usuario). */
export const exportDeck = (id: number, format: 'pdf' | 'pptx'): Promise<ExportResult> =>
  api<ExportResult>(`/flashcards/${id}/export/${format}`, { method: 'POST' });

/** Mazo compartido por token (público). */
export const fetchSharedDeck = async (token: string): Promise<PublicDeck> =>
  (await api<{ deck: PublicDeck }>(`/flashcards/share/${encodeURIComponent(token)}`)).deck;

/** URL de descarga de una exportación guardada. */
export const exportDownloadUrl = (id: number): string => `/api/convert/${id}/download`;

// ── Helpers de interfaz ──────────────────────────────────────

/** Acceso tipado a elementos del DOM (lanza si no existen). */
export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} no encontrado`);
  return el as T;
};

/** Mensaje de un error desconocido (catch). */
export const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : 'Error inesperado.';

/** Muestra un mensaje de estado (con marca de error opcional). */
export const setStatus = (
  el: HTMLElement | null,
  message: string,
  isError = false
): void => {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
};

/** Texto sin acentos y en minúsculas (búsquedas). */
export const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Fecha corta legible en español. */
export const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── Modo estudiar ────────────────────────────────────────────

export interface StudyCard {
  term: string;
  definition: string;
  /** URL de la imagen de la tarjeta (o null). */
  imageUrl: string | null;
}

export interface StudyHandle {
  destroy(): void;
}

/**
 * Monta una sesión de estudio dentro de `container`.
 *
 * - Girar: clic en la tarjeta o barra espaciadora.
 * - Navegar: ‹ › o flechas del teclado.
 * - Valoración: «Ya la sabía» / «Repasar» (solo en memoria del navegador).
 * - Al terminar todas las tarjetas se muestra un resumen con la opción de
 *   repasar únicamente las falladas.
 */
export function createStudy(container: HTMLElement, cards: StudyCard[]): StudyHandle {
  if (cards.length === 0) {
    container.innerHTML = '<p class="status">Este mazo no tiene tarjetas todavía.</p>';
    return { destroy: () => {} };
  }

  let order = cards.map((_, i) => i);
  let index = 0;
  let flipped = false;
  const results = new Map<number, 'known' | 'again'>();

  const pending = (): number[] => order.filter((i) => !results.has(i));
  const knownCount = (): number => [...results.values()].filter((v) => v === 'known').length;
  const againCount = (): number => [...results.values()].filter((v) => v === 'again').length;

  /** Avanza a la siguiente tarjeta sin valorar. */
  function move(delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= order.length) return;
    index = next;
    flipped = false;
    render();
  }

  /** Salta a la siguiente tarjeta pendiente (o a la primera) tras valorar. */
  function advance(): void {
    const rest = pending();
    if (rest.length === 0) {
      render();
      return;
    }
    const after = order.findIndex((card, position) => position > index && !results.has(card));
    index = after >= 0 ? after : order.indexOf(rest[0]);
    flipped = false;
    render();
  }

  function rate(value: 'known' | 'again'): void {
    results.set(order[index], value);
    advance();
  }

  function shuffle(): void {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    index = 0;
    flipped = false;
    render();
  }

  function restart(subset?: number[]): void {
    if (subset) {
      order = subset;
      results.clear();
    } else {
      results.clear();
    }
    index = 0;
    flipped = false;
    render();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      flipped = !flipped;
      render();
    } else if (event.key === 'ArrowRight') {
      move(1);
    } else if (event.key === 'ArrowLeft') {
      move(-1);
    }
  }

  // ── Render ─────────────────────────────────────────────────
  function render(): void {
    if (pending().length === 0 && results.size > 0) {
      renderSummary();
      return;
    }

    const cardIndex = order[index];
    const card = cards[cardIndex];
    const total = order.length;

    container.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'fc-study-top';
    const progress = document.createElement('span');
    progress.className = 'fc-progress';
    progress.textContent = `Tarjeta ${index + 1} de ${total}`;
    const score = document.createElement('span');
    score.className = 'fc-score';
    score.textContent = `Sabidas ${knownCount()} · Repasar ${againCount()}`;
    head.append(progress, score);

    const flip = document.createElement('div');
    flip.className = `fc-card${flipped ? ' flipped' : ''}`;
    flip.tabIndex = 0;
    flip.setAttribute('role', 'button');
    flip.setAttribute('aria-label', 'Girar la tarjeta');

    const inner = document.createElement('div');
    inner.className = 'fc-card-inner';

    const front = document.createElement('div');
    front.className = 'fc-card-face fc-card-front';
    front.append(...cardFace(card, 'term'));

    const back = document.createElement('div');
    back.className = 'fc-card-face fc-card-back';
    back.append(...cardFace(card, 'definition'));

    inner.append(front, back);
    flip.append(inner);
    flip.addEventListener('click', () => {
      flipped = !flipped;
      render();
    });

    const hint = document.createElement('p');
    hint.className = 'fc-hint';
    hint.textContent = flipped
      ? '¿Te la sabías? Márcala para seguir.'
      : 'Toca la tarjeta (o pulsa Espacio) para ver la definición.';

    const nav = document.createElement('div');
    nav.className = 'fc-study-actions';
    nav.append(
      actionButton('‹ Anterior', () => move(-1), index === 0),
      actionButton('Girar', () => {
        flipped = !flipped;
        render();
      }),
      actionButton('Siguiente ›', () => move(1), index === order.length - 1)
    );

    const rate1 = document.createElement('div');
    rate1.className = 'fc-study-actions';
    rate1.append(
      actionButton('🔁 Repasar', () => rate('again'), false, 'btn-outline'),
      actionButton('✅ Ya la sabía', () => rate('known'), false, 'btn-primary'),
      actionButton('🎲 Aleatorio', shuffle, false, 'btn-outline'),
      actionButton('↺ Reiniciar', () => restart(), false, 'btn-outline')
    );

    container.append(head, flip, hint, nav, rate1);
  }

  function renderSummary(): void {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fc-summary';

    const title = document.createElement('h3');
    title.textContent = '¡Sesión completada!';

    const stats = document.createElement('p');
    stats.className = 'fc-progress';
    stats.textContent = `✅ Sabidas: ${knownCount()} · 🔁 Para repasar: ${againCount()}`;

    const again = [...results.entries()]
      .filter(([, value]) => value === 'again')
      .map(([cardIndex]) => cardIndex);

    const actions = document.createElement('div');
    actions.className = 'fc-study-actions';
    if (again.length > 0) {
      actions.append(
        actionButton(`Repasar las ${again.length} falladas`, () => restart(again), false, 'btn-primary')
      );
    }
    actions.append(actionButton('Estudiar todo otra vez', () => restart(), false, 'btn-outline'));

    box.append(title, stats, actions);
    container.append(box);
  }

  /** Cara de la tarjeta: ilustración (si la hay) + texto. */
  function cardFace(card: StudyCard, kind: 'term' | 'definition'): Node[] {
    const nodes: Node[] = [];
    if (kind === 'term' && card.imageUrl) {
      const img = document.createElement('img');
      img.className = 'fc-card-img';
      img.src = card.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      nodes.push(img);
    }
    const text = document.createElement('p');
    text.className = kind === 'term' ? 'fc-card-term' : 'fc-card-definition';
    text.textContent = kind === 'term' ? card.term : card.definition;
    nodes.push(text);
    if (kind === 'term') {
      const label = document.createElement('span');
      label.className = 'fc-card-label';
      label.textContent = 'Término';
      nodes.push(label);
    }
    return nodes;
  }

  function actionButton(
    label: string,
    onClick: () => void,
    disabled = false,
    variant: 'btn-outline' | 'btn-primary' = 'btn-outline'
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = variant;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  document.addEventListener('keydown', onKey);
  render();

  return {
    destroy: () => document.removeEventListener('keydown', onKey)
  };
}
