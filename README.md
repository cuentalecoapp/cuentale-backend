# MVP — Backend de contabilidad simple para PYMES

API del primer módulo (ingresos/gastos) del MVP: usuarios, negocios, categorías y transacciones.

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Instalación

```bash
npm install
cp .env.example .env
# Edita .env con los datos reales de tu base de datos y una clave JWT segura

npm run db:init      # crea las tablas en la base de datos
npm run dev           # levanta el servidor con recarga automática
```

La API queda disponible en `http://localhost:3000`.

## Endpoints principales

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/registro` | Crear cuenta de usuario |
| POST | `/api/auth/login` | Iniciar sesión (devuelve token) |
| GET | `/api/negocios` | Listar los negocios del usuario |
| POST | `/api/negocios` | Crear un negocio (crea categorías por defecto) |
| GET | `/api/negocios/:id/transacciones` | Listar movimientos recientes |
| POST | `/api/negocios/:id/transacciones` | Registrar un ingreso o gasto |
| DELETE | `/api/negocios/:id/transacciones/:tid` | Eliminar un movimiento |
| GET | `/api/negocios/:id/resumen` | Saldo del mes + desglose por categoría (alimenta el dashboard) |

Todas las rutas de `/api/negocios/*` requieren el header `Authorization: Bearer <token>` que devuelve el login.

## Siguientes pasos sugeridos

- Módulo de facturación electrónica simple
- Exportar reportes (PDF/Excel)
- Invitar a un contador o socio como usuario adicional del mismo negocio
