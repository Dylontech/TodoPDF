'use strict';

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.string('role', 16).notNullable().defaultTo('user');
    table.index(['role']);
  });

  await knex.schema.alterTable('conversions', (table) => {
    table.index(['created_at']);
  });

  await knex.schema.alterTable('downloads', (table) => {
    table.index(['created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('downloads', (table) => {
    table.dropIndex(['created_at']);
  });
  await knex.schema.alterTable('conversions', (table) => {
    table.dropIndex(['created_at']);
  });
  await knex.schema.alterTable('users', (table) => {
    table.dropIndex(['role']);
    table.dropColumn('role');
  });
};