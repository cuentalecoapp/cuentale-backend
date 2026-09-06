require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const negociosRoutes = require("./routes/negocios");
const transaccionesRoutes = require("./routes/transacciones");
const facturasRoutes = require("./routes/facturas");
const clientesRoutes = require("./routes/clientes");
const productosRoutes = require("./routes/productos");
const cuentasPorPagarRoutes = require("./routes/cuentasPorPagar");
const recomendacionesRoutes = require("./routes/recomendaciones");
const whatsappRoutes = require("./routes/whatsapp");
const reporteContableRoutes = require("./routes/reporteContable");
const flujoCajaRoutes = require("./routes/flujoCaja");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false })); // Twilio manda los webhooks en este formato

app.get("/api/salud", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/negocios", negociosRoutes);
app.use("/api/negocios", transaccionesRoutes);
app.use("/api/negocios", facturasRoutes);
app.use("/api/negocios", clientesRoutes);
app.use("/api/negocios", productosRoutes);
app.use("/api/negocios", cuentasPorPagarRoutes);
app.use("/api/negocios", recomendacionesRoutes);
app.use("/api/negocios", reporteContableRoutes);
app.use("/api/negocios", flujoCajaRoutes);
app.use("/api", whatsappRoutes);

// Manejador de errores genérico, por si algo se escapa de un try/catch
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Ocurrió un error inesperado." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en el puerto ${PORT}`));
