'use strict';

/**
 * Migración del sistema de moderación.
 * Añade columnas de suspensión a 'users' y crea 'moderation_logs'
 * con el historial de acciones de los administradores.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    // Estado de la cuenta: 'active' | 'banned'
    table.string('status', 16).notNullable().defaultTo('active');
    table.index(['status'], 'users_status_index');
    // Datos de la suspensión vigente (null si la cuenta está activa)
    table.timestamp('banned_at').nullable();
    table.string('banned_reason', 1000).nullable();
    table.integer('banned_by').unsigned().nullable();
  });

  await knex.schema.createTable('moderation_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    // Administrador que ejecutó la acción (sin FK: puede dejar de existir)
    t.integer('admin_id').unsigned().nullable();
    // Acción realizada: 'ban' | 'unban'
    t.string('action', 16).notNullable();
    t.string('reason', 1000).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('moderation_logs');
  await knex.schema.alterTable('users', (table) => {
    table.dropIndex(['status'], 'users_status_index');
    table.dropColumn('status');
    table.dropColumn('banned_at');
    table.dropColumn('banned_reason');
    table.dropColumn('banned_by');
  });
};
