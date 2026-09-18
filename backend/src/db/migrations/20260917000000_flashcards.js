'use strict';

/**
 * Migración del creador de flashcards (solo usuarios autenticados).
 *   'flashcard_decks' → mazos del usuario (con token de compartición opcional)
 *   'flashcards'      → tarjetas de cada mazo (término, definición e imagen opcional)
 */
exports.up = async function (knex) {
  await knex.schema.createTable('flashcard_decks', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.string('description', 1000).nullable();
    // Token público (base64url) para compartir el mazo; NULL = no compartido.
    t.string('share_token', 32).nullable().unique();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at']);
  });

  await knex.schema.createTable('flashcards', (t) => {
    t.increments('id').primary();
    t.integer('deck_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('flashcard_decks')
      .onDelete('CASCADE');
    // Orden de la tarjeta dentro del mazo (0-based)
    t.integer('position').unsigned().notNullable().defaultTo(0);
    t.text('term').notNullable();
    t.text('definition').notNullable();
    // Id de la biblioteca de ilustraciones (p. ej. 'animales/perro'); NULL = sin imagen
    t.string('image', 64).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['deck_id', 'position']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('flashcards');
  await knex.schema.dropTableIfExists('flashcard_decks');
};
