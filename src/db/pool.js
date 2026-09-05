const { Pool } = require("pg");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

const url = process.env.DATABASE_URL || "";
const esLocal = url.includes("localhost") || url.includes("127.0.0.1");
const esInternaRender = url.includes("@dpg-") && !url.includes(".render.com");
const configSSL = (esLocal || esInternaRender) ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: url,
  ssl: configSSL,
  connectionTimeoutMillis: 15000,
});

pool.query("SELECT 1")
  .then(() => console.log(">>> CONEXION A BASE DE DATOS: EXITOSA"))
  .catch((err) => {
    const host = (url.match(/@([^:/]+)/) || [])[1] || "desconocido";
    console.error(">>> CONEXION FALLO. Mensaje:", err.message, "| Codigo:", err.code, "| Host:", host);
  });

module.exports = pool;
