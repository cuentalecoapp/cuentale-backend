const { Pool } = require("pg");

// Una sola conexión reutilizable para toda la app.
// DATABASE_URL viene del archivo .env (ver .env.example)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
