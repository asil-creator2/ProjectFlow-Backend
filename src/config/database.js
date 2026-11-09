import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const sslCaPath = process.env.DATABASE_SSL_CA;
const sslConfig = sslCaPath
  ? {
      rejectUnauthorized: true,
      ca: fs.readFileSync(sslCaPath),
    }
  : { rejectUnauthorized: true };

export const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslConfig,
      max: 10,
    })
  : null;

export async function checkDatabaseConnection() {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }

  await pool.query('SELECT 1');
}