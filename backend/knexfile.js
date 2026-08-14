'use strict';

/**
 * Configuración de Knex para las migraciones de TodoPDF.
 * Lee las variables de entorno (ver .env.example).
 */
require('dotenv').config();

module.exports = {
  client: 'mysql2',
  connection: {
    host: process.env.TODOPDF_DB_HOST || 'localhost',
    port: Number(process.env.TODOPDF_DB_PORT || 3306),
    user: process.env.TODOPDF_DB_USER || 'todopdf',
    password: process.env.TODOPDF_DB_PASSWORD || '0605',
    database: process.env.TODOPDF_DB_NAME || 'todopdfdb',
    charset: 'utf8mb4'
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './src/db/migrations',
    tableName: 'knex_migrations'
  }
};
