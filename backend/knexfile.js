'use strict';

/**
 * Configuración de Knex para las migraciones de TodoPDF.
 * Lee las variables de entorno (ver .env.example).
 */
require('dotenv').config();

const isProduction = (process.env.TODOPDF_NODE_ENV || 'development') === 'production';
const dbPassword = process.env.TODOPDF_DB_PASSWORD;
if (isProduction && !dbPassword) {
  throw new Error('TODOPDF_DB_PASSWORD es obligatorio en producción.');
}

module.exports = {
  client: 'mysql2',
  connection: {
    host: process.env.TODOPDF_DB_HOST || 'localhost',
    port: Number(process.env.TODOPDF_DB_PORT || 3306),
    user: process.env.TODOPDF_DB_USER || 'todopdf',
    password: dbPassword || 'todopdf_secret_password',
    database: process.env.TODOPDF_DB_NAME || 'todopdf',
    charset: 'utf8mb4'
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './src/db/migrations',
    tableName: 'knex_migrations'
  }
};
