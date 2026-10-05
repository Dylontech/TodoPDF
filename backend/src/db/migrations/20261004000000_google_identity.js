'use strict';

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.string('google_sub', 255).nullable().unique();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropUnique(['google_sub']);
    table.dropColumn('google_sub');
  });
};