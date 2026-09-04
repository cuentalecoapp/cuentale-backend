const { Pool } = require("pg");

// Una sola conexión reutilizable para toda la app.
// DATABASE_URL viene del archivo .env (local) o de las variables de Render (en la nube).
//
// SSL: las bases de datos en la nube como Supabase exigen conexión segura (SSL).
// En local (tu computador con PostgreSQL) NO se usa SSL.
// Detectamos si la conexión es a la nube revisando si la URL apunta a localhost.
const esLocal =
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes("localhost") ||
  process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En la nube activamos SSL; en local lo dejamos apagado.
  ssl: esLocal ? false : { rejectUnauthorized: false },
});

module.exports = pool;
