const { Pool } = require("pg");
const dns = require("dns");

// Forzar IPv4: Render (plan gratis) NO soporta IPv6, y Supabase a veces
// resuelve a IPv6 primero, causando ECONNREFUSED / AggregateError.
// Con esto, Node.js prioriza IPv4 al resolver direcciones.
dns.setDefaultResultOrder("ipv4first");

// Detectamos si la conexión es local (tu computador) o en la nube.
const esLocal =
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes("localhost") ||
  process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En la nube activamos SSL; en local lo dejamos apagado.
  ssl: esLocal ? false : { rejectUnauthorized: false },
  // Tiempo máximo de espera para conectar (evita que cuelgue).
  connectionTimeoutMillis: 15000,
});

module.exports = pool;
