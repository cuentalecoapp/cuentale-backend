const esLocal = url.includes("localhost") || url.includes("127.0.0.1");

const configSSL = esLocal ? false : { rejectUnauthorized: false };

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
    console.error(">>> Host destino:", host);
  });

module.exports = pool;
