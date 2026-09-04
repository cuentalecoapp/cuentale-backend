-- Esquema inicial del MVP: contabilidad simple para PYMES/emprendedores
-- Motor: PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Usuarios que pueden entrar al sistema (dueño, y luego contador/socio con acceso)
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un usuario puede tener uno o más negocios (multi-negocio desde el día uno)
CREATE TABLE negocios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  color_marca VARCHAR(7) DEFAULT '#7F77DD',    -- para personalizar el dashboard por cliente
  iniciales VARCHAR(3) DEFAULT '',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categorías de ingreso/gasto, con categorías por defecto + personalizadas por negocio
CREATE TABLE categorias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(80) NOT NULL,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('ingreso', 'gasto')),
  icono VARCHAR(40) DEFAULT 'ti-tag',
  UNIQUE (negocio_id, nombre, tipo)
);

-- El corazón del sistema: cada movimiento de dinero
CREATE TABLE transacciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('ingreso', 'gasto')),
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  descripcion VARCHAR(200) NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transacciones_negocio_fecha ON transacciones (negocio_id, fecha DESC);
CREATE INDEX idx_negocios_usuario ON negocios (usuario_id);

-- Facturas simples (recibo/cotización) — no es facturación electrónica DIAN.
CREATE TABLE facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  cliente_nombre VARCHAR(160) NOT NULL,
  cliente_contacto VARCHAR(160),
  estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'anulada')),
  notas VARCHAR(300),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  transaccion_id UUID REFERENCES transacciones(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, numero)
);

-- Cada línea de productos/servicios dentro de una factura
CREATE TABLE factura_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion VARCHAR(200) NOT NULL,
  cantidad NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario NUMERIC(14, 2) NOT NULL CHECK (precio_unitario >= 0),
  orden SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_facturas_negocio_fecha ON facturas (negocio_id, fecha DESC);
CREATE INDEX idx_factura_items_factura ON factura_items (factura_id);

-- Varios usuarios pueden pertenecer al mismo negocio (dueño, socio, contador...)
CREATE TABLE negocio_usuarios (
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol VARCHAR(20) NOT NULL DEFAULT 'miembro' CHECK (rol IN ('dueño', 'miembro')),
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (negocio_id, usuario_id)
);

-- Clientes frecuentes, para no escribir el nombre cada vez al facturar
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  contacto VARCHAR(160),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, nombre)
);

CREATE INDEX idx_negocio_usuarios_usuario ON negocio_usuarios (usuario_id);
CREATE INDEX idx_clientes_negocio ON clientes (negocio_id);

-- Clientes frecuentes, por negocio
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  contacto VARCHAR(160),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, nombre)
);

-- Quiénes tienen acceso a cada negocio (el dueño + quien invite)
CREATE TABLE negocio_miembros (
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol VARCHAR(20) NOT NULL DEFAULT 'colaborador' CHECK (rol IN ('dueño', 'colaborador')),
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (negocio_id, usuario_id)
);

ALTER TABLE negocios ADD COLUMN codigo_invitacion VARCHAR(12) UNIQUE;

CREATE INDEX idx_clientes_negocio ON clientes (negocio_id, nombre);
CREATE INDEX idx_negocio_miembros_usuario ON negocio_miembros (usuario_id);

-- Inventario básico de productos/servicios
CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  sku VARCHAR(60),
  precio_venta NUMERIC(14, 2) NOT NULL DEFAULT 0,
  stock_actual NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(10, 2) NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, nombre)
);

-- Vincula cada línea de factura a un producto del inventario (opcional)
ALTER TABLE factura_items ADD COLUMN producto_id UUID REFERENCES productos(id) ON DELETE SET NULL;

-- Fecha límite de pago, para poder avisar de facturas vencidas
ALTER TABLE facturas ADD COLUMN fecha_vencimiento DATE;

-- Lo que el negocio le debe a proveedores u otros (cuentas por pagar)
CREATE TABLE cuentas_por_pagar (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  proveedor_nombre VARCHAR(160) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_vencimiento DATE,
  transaccion_id UUID REFERENCES transacciones(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_productos_negocio ON productos (negocio_id);
CREATE INDEX idx_cuentas_por_pagar_negocio ON cuentas_por_pagar (negocio_id);

-- Números de WhatsApp vinculados a un negocio, para registrar movimientos por mensaje
CREATE TABLE whatsapp_numeros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero VARCHAR(20) NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_numeros_numero ON whatsapp_numeros (numero);
