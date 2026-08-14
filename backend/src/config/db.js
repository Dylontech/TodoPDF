'use strict';

const path = require('node:path');
const knex = require('knex');
const config = require('./index');

/**
 * Instancia única de Knex conectada a MariaDB/MySQL.
 * Usada por servicios, controladores y migraciones en tiempo de ejecución.
 *
 * Se define el directorio de migraciones con ruta absoluta para que
 * db.migrate.latest() funcione desde cualquier directorio de trabajo
 * (local o Docker), evitando el default relativo a CWD.
 */
const db = knex({
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4'
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: path.join(__dirname, '../db/migrations'),
    tableName: 'knex_migrations'
  }
});

module.exports = db;
