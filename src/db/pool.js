const { Pool } = require("pg");
const dns = require("dns");

// Forzar IPv4 (Render plan gratis no soporta IPv6 bien)
dns.setDefaultResultOrder("ipv4first");

const url = process.env.DATABASE_URL || "";

// ¿La conexión necesita SSL?
// - Local (tu computador): NO
// - Render interna (dpg-... .render.com): NO (red privada interna)
// - Externa (Supabase u otra): SÍ
const esLocal = url.includes("localhost") || url.includes("127.0.0.1");
const esRenderInterna = url.includes("render.com") || url.startsWith("postgresql://") && url.includes("dpg-");

let configSSL;
if (esLocal || esRenderInterna) {
  configSSL = false;
} else {
  configSSL = { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: url,
  ssl: configSSL,
  connectionTimeoutMillis: 15000,
});

// Diagnóstico al arrancar: probamos la conexión y lo mostramos en los logs de Render
pool.query("SELECT 1")
  .then(() => console.log(">>> CONEXION A BASE DE DATOS: EXITOSA"))
  .catch((err) => {
    const host = (url.match(/@([^:/]+)/) || [])[1] || "desconocido";
    console.error(">>> CONEXION A BASE DE DATOS: FALLO");
    console.error(">>> Mensaje:", err.message);
    console.error(">>> Codigo:", err.code);
    console.error(">>> SSL:", JSON.stringify(configSSL));
    console.error(">>> Host destino:", host);
  });

module.exports = pool;
