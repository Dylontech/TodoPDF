'use strict';

/**
 * Migración del descargador de vídeos (solo usuarios autenticados).
 * Crea la tabla 'downloads' con el historial de descargas de vídeo/audio.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('downloads', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    // Plataforma normalizada: 'youtube' | 'tiktok' | 'twitter' | ...
    t.string('platform', 32).notNullable();
    // URL original pegada por el usuario
    t.string('url', 2048).notNullable();
    // Título del vídeo
    t.string('title', 512).notNullable();
    // Tipo de descarga: 'video' (MP4/MKV) | 'audio' (MP3)
    t.string('kind', 16).notNullable().defaultTo('video');
    // Extensión final del archivo (mp4, mkv, mp3, ...)
    t.string('ext', 16).notNullable();
    // Ruta absoluta en el volumen /data (archivo final)
    t.string('output_path', 512).notNullable();
    // Tamaño total en bytes del resultado
    t.integer('size').unsigned().notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('downloads');
};
