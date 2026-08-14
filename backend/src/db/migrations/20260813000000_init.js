'use strict';

/**
 * Migración inicial de TodoPDF.
 * Crea las tablas de usuarios y el historial de conversiones.
 */
exports.up = async function (knex) {
  // Usuarios registrados (flujo autenticado)
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Historial de conversiones de usuarios autenticados
  await knex.schema.createTable('conversions', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    // Tipo de conversión: 'pdf-to-images' | 'images-to-pdf'
    t.string('type', 32).notNullable();
    t.string('input_filename', 255).notNullable();
    // Ruta absoluta en el volumen /data (archivo o directorio)
    t.string('output_path', 512).notNullable();
    // Tamaño total en bytes del resultado
    t.integer('size').unsigned().notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at']);
  });

  // La tabla 'sessions' la crea automáticamente express-mysql-session
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('conversions');
  await knex.schema.dropTableIfExists('users');
};
