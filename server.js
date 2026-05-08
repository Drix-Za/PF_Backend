require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { Sequelize, DataTypes, Op } = require("sequelize");

//const { generateInvoicePdf, invoiceStorageDir } = require("./services/invoiceService");
const { validateCouponForCheckout } = require("./services/couponService");
const { canManageTargetUser, getUserHierarchyLevel } = require("./middleware/hierarchy");

const JWT_SECRET = process.env.JWT_SECRET || "clave_secreta_para_pruebas";
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || "2h").trim() || "2h";
const PORT = Number(process.env.PORT) || 3000;
const ITBIS_RATE = 0.18;
const ORDER_STATUS_CONFIRMADO = 2;
const ORDER_STATUS_PAGADO = "Pagado";
const REVIEW_STATUS_PENDING = "Pendiente";
const REVIEW_STATUS_APPROVED = "Aprobada";
const REVIEW_STATUS_REJECTED = "Rechazada";
const REVIEW_STATUS_ALIASES = {
  pendiente: REVIEW_STATUS_PENDING,
  aprobada: REVIEW_STATUS_APPROVED,
  aprobado: REVIEW_STATUS_APPROVED,
  approve: REVIEW_STATUS_APPROVED,
  approved: REVIEW_STATUS_APPROVED,
  rechazada: REVIEW_STATUS_REJECTED,
  rechazado: REVIEW_STATUS_REJECTED,
  reject: REVIEW_STATUS_REJECTED,
  rejected: REVIEW_STATUS_REJECTED,
};
const STAFF_MIN_HIERARCHY = 2;
const PRODUCT_TYPE_VIDEOGAME = "videojuego";
const PRODUCT_TYPE_ACCESSORY = "accesorio";
const PRODUCT_TYPE_COLLECTIBLE = "coleccionable";
const ROLE_ATTRIBUTES = ["id_rol", "nombre", "nivel_jerarquia"];

const app = express();

const baseOptions = {
  dialect: "postgres",
  logging: false,
  define: {
    freezeTableName: true,
    timestamps: false,
  },
  dialectOptions: {
    ssl:
      process.env.DB_SSL === "true"
        ? { require: true, rejectUnauthorized: false }
        : false,
  },
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, baseOptions)
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        ...baseOptions,
      },
    );

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
}

const defineIdNameModel = (name, tableName, idField) =>
  sequelize.define(
    name,
    {
      [idField]: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nombre: DataTypes.STRING,
    },
    { tableName },
  );

const Rol = defineIdNameModel("Rol", "rol", "id_rol");
const TipoProducto = defineIdNameModel("TipoProducto", "tipoproducto", "id_tipo_producto");
const Fabricante = defineIdNameModel("Fabricante", "fabricante", "id_fabricante");
const Genero = defineIdNameModel("Genero", "genero", "id_genero");
const Plataforma = defineIdNameModel("Plataforma", "plataforma", "id_plataforma");
const Formato = defineIdNameModel("Formato", "formato", "id_formato");
const MetodoPago = defineIdNameModel("MetodoPago", "metodopago", "id_metodo_pago");
const EstadoPedido = defineIdNameModel("EstadoPedido", "estadopedido", "id_estado_pedido");
const EstadoEnvio = defineIdNameModel("EstadoEnvio", "estadoenvio", "id_estado_envio");
const Provincia = defineIdNameModel("Provincia", "provincia", "id_provincia");
const TipoAccesorio = defineIdNameModel("TipoAccesorio", "tipoaccesorio", "id_tipo_accesorio");
const TipoColeccionable = defineIdNameModel(
  "TipoColeccionable",
  "tipocoleccionable",
  "id_tipo_coleccionable",
);

const Patrocinador = sequelize.define(
  "Patrocinador",
  {
    id_patrocinador: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: DataTypes.STRING,
    imagen_url: DataTypes.STRING, // Para la URL de Cloudinary
  },
  { tableName: "patrocinador", timestamps: false }
);

const Descuento = sequelize.define(
  "Descuento",
  {
    id_descuento: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tipo_descuento: DataTypes.STRING, // e.g., 'porcentaje', 'fijo'
    valor: DataTypes.DECIMAL,
    fecha_inicio: DataTypes.DATE,
    fecha_fin: DataTypes.DATE,
  },
  { tableName: "descuento", timestamps: false },
);

const Cupon = sequelize.define(
  "Cupon",
  {
    id_descuento: { 
      type: DataTypes.INTEGER, 
      primaryKey: true,
      references: { model: 'descuento', key: 'id_descuento' }
    },
    id_patrocinador: { 
      type: DataTypes.INTEGER,
      references: { model: 'patrocinador', key: 'id_patrocinador' }
    },
    codigo_cupon: { type: DataTypes.STRING, unique: true },
    max_usos_cliente: DataTypes.INTEGER,
    monto_minimo_pedido: DataTypes.DECIMAL,
    fecha_vencimiento: DataTypes.DATEONLY, // Se mantiene por compatibilidad, pero Descuento ya tiene fecha_fin
  },
  { tableName: "cupon", timestamps: false },
);

const CuponUsuario = sequelize.define(
  "CuponUsuario",
  {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true },
    id_descuento: { type: DataTypes.INTEGER, primaryKey: true },
    usado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: "cupon_usuario", timestamps: false },
);

const Producto = sequelize.define(
  "Producto",
  {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_tipo_producto: DataTypes.INTEGER,
    id_fabricante: DataTypes.INTEGER,
    titulo: DataTypes.STRING,
    descripcion: DataTypes.TEXT,
    activo: DataTypes.BOOLEAN,
    fecha_creacion: DataTypes.DATE,
    imagen_url: DataTypes.STRING,
    precio: DataTypes.DECIMAL,
    stock: DataTypes.INTEGER,
  },
  { tableName: "producto" },
);

const DescuentoProducto = sequelize.define(
  "DescuentoProducto",
  {
    id_descuento: { type: DataTypes.INTEGER, primaryKey: true },
    id_producto: { type: DataTypes.INTEGER, primaryKey: true },
  },
  { tableName: "descuentoproducto", timestamps: false }
);

// --- BLOQUE DE RELACIONES CORREGIDO ---

// Relación Cupon -> Descuento (Alias: 'InfoDescuento')
Cupon.belongsTo(Descuento, { foreignKey: 'id_descuento', as: 'InfoDescuento' });

// Relación Cupon -> Patrocinador (Alias: 'Patrocinador')
Cupon.belongsTo(Patrocinador, { foreignKey: 'id_patrocinador', as: 'Patrocinador' });

// Relación DescuentoProducto -> Descuento (Alias: 'DescuentoAsociado')
DescuentoProducto.belongsTo(Descuento, { foreignKey: 'id_descuento', as: 'DescuentoAsociado' });

// Relación DescuentoProducto -> Producto (Alias: 'Producto')
DescuentoProducto.belongsTo(Producto, { foreignKey: 'id_producto', as: 'Producto' });

const Usuario = sequelize.define(
  "Usuario",
  {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_rol: DataTypes.INTEGER,
    email: DataTypes.STRING,
    contrasena_hash: DataTypes.STRING,
    nombre: DataTypes.STRING,
    apellido: DataTypes.STRING,
    telefono: DataTypes.STRING,
    fecha_registro: DataTypes.DATE,
    activo: DataTypes.BOOLEAN,
    avatar_url: DataTypes.STRING,
  },
  { tableName: "usuario" },
);

const VideoJuego = sequelize.define(
  "VideoJuego",
  {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true },
    id_genero: DataTypes.INTEGER,
    id_plataforma: DataTypes.INTEGER,
    fecha_lanzamiento: DataTypes.DATEONLY,
  },
  { tableName: "videojuego" },
);

const VideoJuegoFormato = sequelize.define(
  "VideoJuegoFormato",
  {
    id_vj_formato: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_videojuego: DataTypes.INTEGER,
    id_formato: DataTypes.INTEGER,
  },
  { tableName: "videojuegoformato" },
);

const Accesorio = sequelize.define(
  "Accesorio",
  {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true },
    id_tipo_accesorio: DataTypes.INTEGER,
  },
  { tableName: "accesorio" },
);

const Coleccionable = sequelize.define(
  "Coleccionable",
  {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true },
    id_tipo_coleccionable: DataTypes.INTEGER,
  },
  { tableName: "coleccionable" },
);

const ImagenProducto = sequelize.define(
  "ImagenProducto",
  {
    id_imagen: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_producto: DataTypes.INTEGER,
    url: DataTypes.STRING,
    es_principal: DataTypes.BOOLEAN,
  },
  { tableName: "imagenproducto" },
);

const Municipio = sequelize.define(
  "Municipio",
  {
    id_municipio: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_provincia: DataTypes.INTEGER,
    nombre: DataTypes.STRING,
  },
  { tableName: "municipio" },
);

const Direccion = sequelize.define(
  "Direccion",
  {
    id_direccion: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: DataTypes.INTEGER,
    id_municipio: DataTypes.INTEGER,
    calle: DataTypes.STRING,
    numero_casa: DataTypes.STRING,
    detalle: DataTypes.TEXT,
    es_principal: DataTypes.BOOLEAN,
    id_provincia: DataTypes.INTEGER,
    municipio_personalizado: DataTypes.STRING,
    latitud: DataTypes.DECIMAL,
    longitud: DataTypes.DECIMAL,
    sector: DataTypes.STRING,
    referencia: DataTypes.TEXT,
  },
  { tableName: "direccion" },
);

const CarritoCabecera = sequelize.define(
  "CarritoCabecera",
  {
    id_carrito: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: DataTypes.INTEGER,
    fecha_actualizacion: DataTypes.DATE,
  },
  { tableName: "carritocabecera" },
);

const CarritoDetalle = sequelize.define(
  "CarritoDetalle",
  {
    id_carrito_detalle: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_carrito: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    cantidad: DataTypes.INTEGER,
  },
  { tableName: "carritodetalle" },
);

const Pedido = sequelize.define(
  "Pedido",
  {
    id_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_cliente: DataTypes.INTEGER,
    id_estado_pedido: DataTypes.INTEGER,
    id_metodo_pago: DataTypes.INTEGER,
    fecha_pedido: DataTypes.DATE,
    subtotal: DataTypes.DECIMAL,
    costo_envio: DataTypes.DECIMAL,
    itbis: DataTypes.DECIMAL,
    total: DataTypes.DECIMAL,
    id_direccion: DataTypes.INTEGER,
  },
  { tableName: "pedido" },
);

const DetallePedido = sequelize.define(
  "DetallePedido",
  {
    id_detalle_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_pedido: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    id_descuento: DataTypes.INTEGER,
    cantidad: DataTypes.INTEGER,
    precio_unitario_venta: DataTypes.DECIMAL,
    monto_descuento: DataTypes.DECIMAL,
  },
  { tableName: "detallepedido" },
);

const Envio = sequelize.define(
  "Envio",
  {
    id_envio: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_pedido: DataTypes.INTEGER,
    id_estado_envio: DataTypes.INTEGER,
    codigo_seguimiento: DataTypes.STRING,
    transportista: DataTypes.STRING,
    fecha_actualizacion: DataTypes.DATE,
  },
  { tableName: "envio" },
);

const Resena = sequelize.define(
  "Resena",
  {
    id_resena: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    puntuacion: DataTypes.INTEGER,
    comentario: DataTypes.TEXT,
    fecha_resena: DataTypes.DATE,
    estado: DataTypes.STRING,
    id_moderador: DataTypes.INTEGER,
    fecha_moderacion: DataTypes.DATE,
  },
  { tableName: "resena" },
);

const AjusteInventario = sequelize.define(
  "AjusteInventario",
  {
    id_ajuste: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_vj_formato: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    id_usuario_administrador: DataTypes.INTEGER,
    tipo_ajuste: DataTypes.STRING,
    cantidad_ajustada: DataTypes.INTEGER,
    fecha_ajuste: DataTypes.DATE,
  },
  { tableName: "ajusteinventario" },
);

Usuario.belongsTo(Rol, { foreignKey: "id_rol", as: "Rol" });
Descuento.hasOne(Cupon, { foreignKey: "id_descuento", as: "Cupon" });
Cupon.belongsTo(Descuento, { foreignKey: "id_descuento", as: "Descuento" });
CuponUsuario.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });
CuponUsuario.belongsTo(Descuento, { foreignKey: "id_descuento", as: "Descuento" });
Producto.belongsTo(TipoProducto, { foreignKey: "id_tipo_producto", as: "TipoProducto" });
Producto.belongsTo(Fabricante, { foreignKey: "id_fabricante", as: "Fabricante" });
Producto.hasMany(ImagenProducto, { foreignKey: "id_producto", as: "Imagenes" });
ImagenProducto.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });

Producto.hasOne(VideoJuego, { foreignKey: "id_producto", as: "VideoJuego" });
VideoJuego.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
VideoJuego.belongsTo(Genero, { foreignKey: "id_genero", as: "Genero" });
VideoJuego.belongsTo(Plataforma, { foreignKey: "id_plataforma", as: "Plataforma" });
VideoJuego.hasMany(VideoJuegoFormato, {
  foreignKey: "id_videojuego",
  sourceKey: "id_producto",
  as: "Formatos",
});
VideoJuegoFormato.belongsTo(VideoJuego, {
  foreignKey: "id_videojuego",
  targetKey: "id_producto",
  as: "VideoJuego",
});
VideoJuegoFormato.belongsTo(Formato, { foreignKey: "id_formato", as: "Formato" });

Producto.hasOne(Accesorio, { foreignKey: "id_producto", as: "Accesorio" });
Accesorio.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Accesorio.belongsTo(TipoAccesorio, { foreignKey: "id_tipo_accesorio", as: "TipoAccesorio" });

Producto.hasOne(Coleccionable, { foreignKey: "id_producto", as: "Coleccionable" });
Coleccionable.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Coleccionable.belongsTo(TipoColeccionable, {
  foreignKey: "id_tipo_coleccionable",
  as: "TipoColeccionable",
});

Municipio.belongsTo(Provincia, { foreignKey: "id_provincia", as: "Provincia" });
Direccion.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });
Direccion.belongsTo(Provincia, { foreignKey: "id_provincia", as: "Provincia" });
Direccion.belongsTo(Municipio, { foreignKey: "id_municipio", as: "Municipio" });
Usuario.hasMany(Direccion, { foreignKey: "id_usuario", as: "Direcciones" });

CarritoCabecera.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });
Usuario.hasOne(CarritoCabecera, { foreignKey: "id_usuario", as: "Carrito" });
CarritoCabecera.hasMany(CarritoDetalle, { foreignKey: "id_carrito", as: "Detalles" });
CarritoDetalle.belongsTo(CarritoCabecera, { foreignKey: "id_carrito", as: "Carrito" });
CarritoDetalle.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });

Pedido.belongsTo(Usuario, { foreignKey: "id_cliente", as: "Cliente" });
Pedido.belongsTo(EstadoPedido, { foreignKey: "id_estado_pedido", as: "Estado" });
Pedido.belongsTo(MetodoPago, { foreignKey: "id_metodo_pago", as: "MetodoPago" });
Pedido.belongsTo(Direccion, { foreignKey: "id_direccion", as: "ubicacion" });
Pedido.hasMany(DetallePedido, { foreignKey: "id_pedido", as: "Detalles" });
Pedido.hasOne(Envio, { foreignKey: "id_pedido", as: "Envio" });
DetallePedido.belongsTo(Pedido, { foreignKey: "id_pedido", as: "Pedido" });
DetallePedido.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
DetallePedido.belongsTo(Descuento, { foreignKey: "id_descuento", as: "Descuento" });
Envio.belongsTo(Pedido, { foreignKey: "id_pedido", as: "Pedido" });
Envio.belongsTo(EstadoEnvio, { foreignKey: "id_estado_envio", as: "EstadoEnvio" });

Producto.hasMany(Resena, { foreignKey: "id_producto", as: "Resenas" });
Resena.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Resena.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.NODE_ENV !== "production" ? "http://localhost:*" : "",
  process.env.NODE_ENV !== "production" ? "http://127.0.0.1:*" : "",
]
  .flatMap((value) => String(value || "").split(","))
  .map((value) => value.trim())
  .filter(Boolean);

const originMatches = (origin, pattern) => {
  if (!origin || !pattern) return false;
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(origin);
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.some((pattern) => originMatches(origin, pattern))) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Disposition"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(compression());
app.use(express.json());
//app.use("/facturas", express.static(invoiceStorageDir));

const uploadMemory = multer({ storage: multer.memoryStorage() });

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const roundMoney = (value) => Number(toNumber(value).toFixed(2));
const moneyToDb = (value) => roundMoney(value).toFixed(2);
const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeReviewStatus = (value) => REVIEW_STATUS_ALIASES[normalizeLower(value)] || null;
const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

const ensureTable = async (tableName, definitionSql) => {
  const [tables] = await sequelize.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = :tableName
    LIMIT 1
    `,
    { replacements: { tableName } },
  );

  if (!tables.length) {
    await sequelize.query(definitionSql);
  }
};

const ensureColumn = async (tableName, columnName, definitionSql) => {
  const [columns] = await sequelize.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = :tableName
      AND column_name = :columnName
    LIMIT 1
    `,
    { replacements: { tableName, columnName } },
  );

  if (!columns.length) {
    await sequelize.query(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definitionSql}`,
    );
  }
};

const ensureDatabaseCompatibility = async () => {
  await sequelize.authenticate();

  await ensureColumn("producto", "imagen_url", "character varying(255)");
  await ensureColumn("producto", "precio", "numeric(10,2) DEFAULT 0.00");
  await ensureColumn("producto", "stock", "integer DEFAULT 0");
  await ensureColumn("rol", "nivel_jerarquia", "integer DEFAULT 0");

  await ensureTable(
    "imagenproducto",
    `
    CREATE TABLE imagenproducto (
      id_imagen SERIAL PRIMARY KEY,
      id_producto integer NOT NULL REFERENCES producto(id_producto) ON DELETE CASCADE,
      url character varying(500) NOT NULL,
      es_principal boolean DEFAULT false NOT NULL
    )
    `,
  );

  await ensureColumn("usuario", "id_rol", "integer DEFAULT 1");
  await ensureColumn("usuario", "email", "character varying(100)");
  await ensureColumn("usuario", "contrasena_hash", "character varying(255)");
  await ensureColumn("usuario", "nombre", "character varying(50)");
  await ensureColumn("usuario", "apellido", "character varying(50)");
  await ensureColumn("usuario", "telefono", "character varying(15)");
  await ensureColumn("usuario", "fecha_registro", "timestamp with time zone DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn("usuario", "activo", "boolean DEFAULT true");
  await ensureColumn("usuario", "avatar_url", "character varying(255)");

  const [legacyUserColumns] = await sequelize.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name IN ('usuario', 'password')
    `,
  );
  const legacyUserColumnNames = new Set(legacyUserColumns.map((column) => column.column_name));

  if (legacyUserColumnNames.has("usuario") && legacyUserColumnNames.has("password")) {
    await sequelize.query("ALTER TABLE usuario ALTER COLUMN usuario DROP NOT NULL");
    await sequelize.query("ALTER TABLE usuario ALTER COLUMN password DROP NOT NULL");
    await sequelize.query(`
      UPDATE usuario
      SET email = COALESCE(email, usuario),
          contrasena_hash = COALESCE(contrasena_hash, password),
          nombre = COALESCE(nombre, usuario),
          apellido = COALESCE(apellido, ''),
          activo = COALESCE(activo, true)
      WHERE usuario IS NOT NULL
         OR password IS NOT NULL
    `);
  }

  await ensureColumn("direccion", "id_provincia", "integer");
  await ensureColumn("direccion", "municipio_personalizado", "character varying(100)");
  await ensureColumn("direccion", "latitud", "numeric(10,8)");
  await ensureColumn("direccion", "longitud", "numeric(11,8)");
  await ensureColumn("direccion", "sector", "character varying(100)");
  await ensureColumn("direccion", "referencia", "text");
  await ensureColumn("pedido", "id_direccion", "integer");

  await ensureColumn("resena", "estado", "character varying(30) DEFAULT 'Pendiente'");
  await ensureColumn("resena", "id_moderador", "integer");
  await ensureColumn("resena", "fecha_moderacion", "timestamp with time zone");
  await ensureColumn("resena", "fecha_resena", "timestamp with time zone DEFAULT CURRENT_TIMESTAMP");
  await sequelize.query(
    `
    UPDATE resena
    SET estado = :pendingStatus
    WHERE estado IS NULL
       OR TRIM(estado) = ''
    `,
    { replacements: { pendingStatus: REVIEW_STATUS_PENDING } },
  );

  await ensureColumn("descuento", "fecha_inicio", "timestamp with time zone DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn("descuento", "fecha_fin", "timestamp with time zone");
  await ensureColumn("cupon", "id_patrocinador", "integer");
  await ensureColumn("cupon", "fecha_inicio", "date");

  await ensureTable(
    "patrocinador",
    `
    CREATE TABLE patrocinador (
      id_patrocinador SERIAL PRIMARY KEY,
      nombre character varying(100) NOT NULL,
      imagen_url character varying(500)
    )
    `,
  );

  await ensureTable(
    "descuentoproducto",
    `
    CREATE TABLE descuentoproducto (
      id_descuento integer NOT NULL REFERENCES descuento(id_descuento) ON DELETE CASCADE,
      id_producto integer NOT NULL REFERENCES producto(id_producto) ON DELETE CASCADE,
      PRIMARY KEY (id_descuento, id_producto)
    )
    `,
  );
};

const parseId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no"].includes(String(value).toLowerCase());
};
const parseDecimal = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const getRoleHierarchy = getUserHierarchyLevel;
const toJsonList = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const serializeUser = (user) => {
  if (!user) return null;
  const plain = typeof user.get === "function" ? user.get({ plain: true }) : { ...user };
  delete plain.contrasena_hash;
  return plain;
};

const findLegacyUserId = async (identifier) => {
  const normalizedIdentifier = normalizeLower(identifier);
  if (!normalizedIdentifier) return null;

  const [legacyColumns] = await sequelize.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuario'
      AND column_name = 'usuario'
    LIMIT 1
    `,
  );

  if (!legacyColumns.length) return null;

  const [rows] = await sequelize.query(
    `
    SELECT id_usuario
    FROM usuario
    WHERE LOWER(TRIM(usuario)) = :identifier
    LIMIT 1
    `,
    { replacements: { identifier: normalizedIdentifier } },
  );

  return rows[0]?.id_usuario || null;
};

const ensureCloudinaryConfigured = () => {
  if (!process.env.CLOUDINARY_URL) {
    const error = new Error("CLOUDINARY_URL no esta configurada");
    error.status = 500;
    throw error;
  }
};

const uploadBufferToCloudinary = async (file, folder) => {
  if (!file) return null;
  ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    stream.end(file.buffer);
  });
};

const publicProductInclude = [
  { model: TipoProducto, as: "TipoProducto", attributes: ["id_tipo_producto", "nombre"] },
  { model: Fabricante, as: "Fabricante", attributes: ["id_fabricante", "nombre"], required: false },
  {
    model: ImagenProducto,
    as: "Imagenes",
    required: false,
    attributes: ["id_imagen", "url", "es_principal"],
  },
  {
    model: VideoJuego,
    as: "VideoJuego",
    required: false,
    include: [
      { model: Genero, as: "Genero", attributes: ["id_genero", "nombre"] },
      { model: Plataforma, as: "Plataforma", attributes: ["id_plataforma", "nombre"] },
      {
        model: VideoJuegoFormato,
        as: "Formatos",
        required: false,
        include: [{ model: Formato, as: "Formato", attributes: ["id_formato", "nombre"] }],
      },
    ],
  },
  {
    model: Accesorio,
    as: "Accesorio",
    required: false,
    include: [{ model: TipoAccesorio, as: "TipoAccesorio", attributes: ["id_tipo_accesorio", "nombre"] }],
  },
  {
    model: Coleccionable,
    as: "Coleccionable",
    required: false,
    include: [
      {
        model: TipoColeccionable,
        as: "TipoColeccionable",
        attributes: ["id_tipo_coleccionable", "nombre"],
      },
    ],
  },
];

const buildProductImage = (product) => {
  const principal = (product.Imagenes || []).find((image) => image.es_principal) || product.Imagenes?.[0];
  return principal?.url || product.imagen_url || null;
};

const mapProduct = (productInstance) => {
  const product = productInstance?.get ? productInstance.get({ plain: true }) : productInstance;
  if (!product) return null;

  const formatos = (product.VideoJuego?.Formatos || []).map((item) => ({
    id_vj_formato: item.id_vj_formato,
    id_formato: item.id_formato,
    nombre: item.Formato?.nombre || null,
  }));
  const reviewList = product.Resenas || [];
  const reviewCount = reviewList.length;
  const rating =
    reviewCount > 0
      ? roundMoney(
          reviewList.reduce((sum, review) => sum + Number(review.puntuacion || 0), 0) / reviewCount,
        )
      : null;

  return {
    ...product,
    imagen_url: buildProductImage(product),
    imagenes: (product.Imagenes || []).map((image) => ({
      id_imagen: image.id_imagen,
      url: image.url,
      es_principal: image.es_principal,
    })),
    precio: roundMoney(product.precio),
    precio_base: roundMoney(product.precio),
    stock: Number(product.stock || 0),
    stock_disponible: Number(product.stock || 0),
    stock_total: Number(product.stock || 0),
    tipo_producto_nombre: product.TipoProducto?.nombre || null,
    genero_nombre: product.VideoJuego?.Genero?.nombre || null,
    plataforma_nombre: product.VideoJuego?.Plataforma?.nombre || null,
    formatos_disponibles: formatos,
    formato_nombre:
      formatos.length === 1
        ? formatos[0].nombre
        : formatos.map((item) => item.nombre).filter(Boolean).join(", ") || null,
    tipo_accesorio_nombre: product.Accesorio?.TipoAccesorio?.nombre || null,
    tipo_coleccionable_nombre: product.Coleccionable?.TipoColeccionable?.nombre || null,
    rating_promedio: rating,
    cantidad_resenas: reviewCount,
  };
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }

  try {
    const payload = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    const user = await Usuario.findByPk(payload.id_usuario, {
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    if (!user || user.activo === false) {
      return res.status(401).json({ error: "Usuario no autorizado" });
    }

    user.nivel_jerarquia = Number(user.Rol?.nivel_jerarquia ?? user.nivel_jerarquia ?? 0);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      error: error?.name === "TokenExpiredError" ? "Token expirado" : "Token invalido",
    });
  }
};
// Fix roles 1
const requireRoles = (...roles) => (req, res, next) => {
  // 1. Función para buscar el nivel en cualquier parte del objeto (Recursiva simple)
  const buscarNivel = (obj) => {
      if (!obj) return 0;

      // 1. Intentamos obtener el objeto de datos (limpio o de dataValues)
      const user = obj.dataValues || obj;
      const rol = user.Rol?.dataValues || user.Rol || user.rol?.dataValues || user.rol;

      // 2. Extraemos el valor y lo forzamos a número
      // Si 'rol' existe, buscamos el nivel; si no, buscamos en el usuario directamente
      const nivelRaw = rol ? rol.nivel_jerarquia : user.nivel_jerarquia;

      // Log de emergencia para ver el valor exacto antes de convertirlo
      if (nivelRaw !== undefined) {
        console.log(`[DEBUG NEO-GAMING] Valor crudo encontrado: "${nivelRaw}" (Tipo: ${typeof nivelRaw})`);
      }

      return nivelRaw ? Number(nivelRaw) : 0;
    };

  const userLevel = buscarNivel(req.user);
  const minimumLevel = Math.min(...roles.map((role) => Number(role)));

  // DEBUG PARA NEO-GAMING
  if (userLevel < minimumLevel) {
    console.log("--- FALLO DE AUTORIZACIÓN ---");
    console.log("ID Usuario:", req.user?.id_usuario || req.user?.dataValues?.id_usuario);
    console.log("Nivel detectado:", userLevel);
    console.log("¿Existe objeto Rol?:", !!(req.user?.Rol || req.user?.dataValues?.Rol));
    // Esto imprimirá solo las claves del objeto Rol para no saturar la consola
    if (req.user?.Rol || req.user?.dataValues?.Rol) {
      console.log("Campos en Rol:", Object.keys(req.user?.Rol?.dataValues || req.user?.Rol || {}));
    }
  }

  if (!req.user || userLevel < minimumLevel) {
    return res.status(403).json({ 
      error: "Acceso denegado", 
      debug: { nivel: userLevel, requerido: minimumLevel } 
    });
  }
  next();
};

const getTypeSlug = (tipo) => normalizeLower(tipo?.nombre).replace(/\s+/g, "");

const assertNotEmpty = (value, message) => {
  if (!normalizeText(value)) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
};

const getOrCreateCart = async (idUsuario, transaction) => {
  let cart = await CarritoCabecera.findOne({
    where: { id_usuario: idUsuario },
    transaction,
    lock: transaction ? true : undefined,
  });

  if (!cart) {
    cart = await CarritoCabecera.create(
      { id_usuario: idUsuario, fecha_actualizacion: new Date() },
      { transaction },
    );
  }

  return cart;
};

const touchCart = (cart, transaction) =>
  cart.update({ fecha_actualizacion: new Date() }, { transaction });

const loadProductRecord = async (idProducto, transaction, lock = false, includeReviews = false) => {
  // PostgreSQL no permite FOR UPDATE cuando hay LEFT OUTER JOINs (nullable side).
  // Solución: primero bloqueamos la fila de Producto sin joins, luego cargamos
  // los datos completos con todos los includes en una query separada.
  if (transaction && lock) {
    await Producto.findByPk(idProducto, {
      transaction,
      lock: { level: transaction.LOCK.UPDATE, of: Producto },
    });
  }

  const include = [...publicProductInclude];
  if (includeReviews) {
    include.push({
      model: Resena,
      as: "Resenas",
      required: false,
      where: { estado: REVIEW_STATUS_APPROVED },
      include: [
        {
          model: Usuario,
          as: "Usuario",
          attributes: ["id_usuario", "nombre", "apellido", "avatar_url"],
        },
      ],
    });
  }

  return Producto.findByPk(idProducto, {
    include,
    transaction,
    order: includeReviews ? [[{ model: Resena, as: "Resenas" }, "fecha_resena", "DESC"]] : undefined,
  });
};

const resolveLinePricing = async (idProducto, transaction, lock = false) => {
  const productInstance = await loadProductRecord(idProducto, transaction, lock, false);

  if (!productInstance || productInstance.activo === false) {
    const error = new Error("Producto no disponible");
    error.status = 404;
    throw error;
  }

  const product = mapProduct(productInstance);
  return {
    product,
    price: roundMoney(product.precio),
    stockAvailable: Number(product.stock || 0),
  };
};

const buildCartPayload = async (idUsuario, transaction) => {
  const cart = await CarritoCabecera.findOne({
    where: { id_usuario: idUsuario },
    include: [
      {
        model: CarritoDetalle,
        as: "Detalles",
        include: [{ model: Producto, as: "Producto", include: publicProductInclude }],
      },
    ],
    transaction,
  });

  if (!cart) {
    return { id_carrito: null, items: [], subtotal: 0, itbis: 0, total: 0, cantidadItems: 0 };
  }

  const items = cart.Detalles.map((detail) => {
    const product = mapProduct(detail.Producto);
    const unitPrice = roundMoney(product.precio);
    return {
      id_carrito_detalle: detail.id_carrito_detalle,
      id_producto: detail.id_producto,
      cantidad: Number(detail.cantidad || 0),
      titulo: product.titulo,
      descripcion: product.descripcion,
      imagen_url: product.imagen_url,
      precio_unitario: unitPrice,
      total_linea: roundMoney(unitPrice * Number(detail.cantidad || 0)),
      formato: product.formato_nombre || product.tipo_producto_nombre || "General",
      genero: product.genero_nombre,
      plataforma: product.plataforma_nombre,
      stock_disponible: product.stock_disponible,
      tipo_producto_nombre: product.tipo_producto_nombre,
    };
  });

  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total_linea, 0));
  const itbis = roundMoney(subtotal * ITBIS_RATE);
  return {
    id_carrito: cart.id_carrito,
    items,
    subtotal,
    itbis,
    total: roundMoney(subtotal + itbis),
    cantidadItems: items.reduce((sum, item) => sum + item.cantidad, 0),
  };
};

const mapDireccion = (addressInstance) => {
  const address = addressInstance?.get ? addressInstance.get({ plain: true }) : addressInstance;
  if (!address) return null;

  return {
    ...address,
    provincia_nombre: address.Provincia?.nombre || null,
    municipio_nombre: address.municipio_personalizado || address.Municipio?.nombre || null,
    latitud: address.latitud !== undefined && address.latitud !== null ? Number(address.latitud) : null,
    longitud: address.longitud !== undefined && address.longitud !== null ? Number(address.longitud) : null,
    sector: address.sector || null,
    referencia: address.referencia || null,
  };
};

const resolveDireccionPayload = async (payload, userId, transaction) => {
  const idDireccion = parseId(payload.id_direccion);

  if (idDireccion) {
    // 1. BLOQUEO LIMPIO: Bloqueamos solo el registro de la tabla Direccion.
    // Al no tener 'include', PostgreSQL no genera el error de Outer Join.
    const addressLock = await Direccion.findOne({
      where: { id_direccion: idDireccion, id_usuario: userId },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });

    if (!addressLock) {
      const error = new Error("La direccion seleccionada no existe");
      error.status = 404;
      throw error;
    }

    // 2. CARGA DE DATOS: Ahora que la fila está bloqueada, traemos las relaciones.
    // Ya no necesitamos 'lock: true' aquí porque la fila ya está protegida.
    const savedAddress = await Direccion.findOne({
      where: { id_direccion: idDireccion },
      include: [
        { model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] },
        { model: Municipio, as: "Municipio", attributes: ["id_municipio", "nombre", "id_provincia"] },
      ],
      transaction
    });

    return {
      record: savedAddress,
      ubicacion: mapDireccion(savedAddress),
    };
  }

  // --- El resto de la lógica de creación se mantiene igual ---
  const calle = normalizeText(payload.calle);
  const numeroCasa = normalizeText(payload.numero_casa);
  const detalle = normalizeText(payload.detalle) || null;
  const idProvincia = parseId(payload.id_provincia);
  const idMunicipio = parseId(payload.id_municipio);
  const municipioPersonalizado = normalizeText(payload.municipio_personalizado);
  const guardarDireccion = parseBoolean(payload.guardar_direccion, false);
  const latitud = parseDecimal(payload.latitud);
  const longitud = parseDecimal(payload.longitud);
  const sector = normalizeText(payload.sector) || null;
  const referencia = normalizeText(payload.referencia) || normalizeText(payload.detalle) || null;

  assertNotEmpty(calle, "La direccion requiere calle");
  assertNotEmpty(numeroCasa, "La direccion requiere numero de casa o referencia");

  if (!idProvincia) {
    const error = new Error("Debes seleccionar una provincia");
    error.status = 400;
    throw error;
  }

  const province = await Provincia.findByPk(idProvincia, { transaction });
  if (!province) {
    const error = new Error("Provincia invalida");
    error.status = 400;
    throw error;
  }

  let municipio = null;
  let municipioDisplay = null;
  let municipalityForSave = idMunicipio;

  if (municipioPersonalizado) {
    municipioDisplay = municipioPersonalizado;
    municipio = await Municipio.findOne({
      where: { id_provincia: idProvincia },
      order: [["nombre", "ASC"]],
      transaction,
    });

    if (!municipio) {
      const error = new Error("No hay municipios registrados para esa provincia");
      error.status = 400;
      throw error;
    }

    municipalityForSave = municipio.id_municipio;
  } else {
    if (!idMunicipio) {
      const error = new Error("Debes seleccionar un municipio");
      error.status = 400;
      throw error;
    }

    municipio = await Municipio.findOne({
      where: { id_municipio: idMunicipio, id_provincia: idProvincia },
      transaction,
    });

    if (!municipio) {
      const error = new Error("Municipio invalido para la provincia seleccionada");
      error.status = 400;
      throw error;
    }

    municipioDisplay = municipio.nombre;
  }

  const currentPrincipal = await Direccion.findOne({
    where: { id_usuario: userId, es_principal: true },
    transaction,
  });

  const savedRecord = await Direccion.create(
    {
      id_usuario: userId,
      id_municipio: municipalityForSave,
      calle,
      numero_casa: numeroCasa,
      detalle,
      es_principal: guardarDireccion ? !currentPrincipal : false,
      id_provincia: idProvincia,
      municipio_personalizado: municipioPersonalizado || null,
      latitud,
      longitud,
      sector,
      referencia,
    },
    { transaction },
  );

  return {
    record: savedRecord,
    ubicacion: mapDireccion(savedRecord),
  };
};

const loadPedidoPayload = async (pedidoId) => {
  const pedido = await Pedido.findByPk(pedidoId, {
    include: [
      { model: Usuario, as: "Cliente", attributes: ["id_usuario", "nombre", "apellido", "email"] },
      { model: EstadoPedido, as: "Estado", attributes: ["id_estado_pedido", "nombre"] },
      { model: MetodoPago, as: "MetodoPago", attributes: ["id_metodo_pago", "nombre"] },
      { model: Envio, as: "Envio", required: false, include: [{ model: EstadoEnvio, as: "EstadoEnvio", attributes: ["id_estado_envio", "nombre"] }] },
      {
        model: Direccion,
        as: "ubicacion",
        required: false,
        include: [
          { model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] },
          { model: Municipio, as: "Municipio", attributes: ["id_municipio", "nombre"] },
        ],
      },
      {
        model: DetallePedido,
        as: "Detalles",
        include: [
          { model: Producto, as: "Producto", include: publicProductInclude },
          { model: Descuento, as: "Descuento", required: false },
        ],
      },
    ],
  });

  if (!pedido) return null;
  const plain = pedido.get({ plain: true });

  return {
    ...plain,
    subtotal: roundMoney(plain.subtotal),
    costo_envio: roundMoney(plain.costo_envio),
    itbis: roundMoney(plain.itbis),
    total: roundMoney(plain.total),
    ubicacion: mapDireccion(plain.ubicacion),
    Direccion: mapDireccion(plain.ubicacion),
    Envio: plain.Envio
      ? {
        ...plain.Envio,
        EstadoEnvio: plain.Envio.EstadoEnvio || null,
        }
      : null,
    Detalles: (plain.Detalles || []).map((detail) => ({
      ...detail,
      precio_unitario_venta: roundMoney(detail.precio_unitario_venta),
      monto_descuento: roundMoney(detail.monto_descuento),
      Producto: mapProduct(detail.Producto),
      Descuento: detail.Descuento || null,
    })),
  };
};

const allocateDiscountAcrossLines = (lines, discountAmount) => {
  const totalGross = lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
  const discountTotal = roundMoney(discountAmount);

  if (discountTotal <= 0 || totalGross <= 0) {
    return lines.map((line) => ({ ...line, discountLine: 0 }));
  }

  let allocated = 0;
  return lines.map((line, index) => {
    if (index === lines.length - 1) {
      const discountLine = roundMoney(discountTotal - allocated);
      return { ...line, discountLine };
    }

    const discountLine = roundMoney((discountTotal * Number(line.lineTotal || 0)) / totalGross);
    allocated = roundMoney(allocated + discountLine);
    return { ...line, discountLine };
  });
};

const getReportDateRange = (filter) => {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);

  if (filter === "7d") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end, key: "7d" };
  }

  if (filter === "year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return { start, end, key: "year" };
  }

  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return { start, end, key: "month" };
};

const clearProductSubtypeRows = async (productId, transaction) => {
  await Promise.all([
    VideoJuegoFormato.destroy({ where: { id_videojuego: productId }, transaction }),
    VideoJuego.destroy({ where: { id_producto: productId }, transaction }),
    Accesorio.destroy({ where: { id_producto: productId }, transaction }),
    Coleccionable.destroy({ where: { id_producto: productId }, transaction }),
  ]);
};

const saveProductSubtype = async (productId, reqBody, typeSlug, transaction) => {
  if (typeSlug === PRODUCT_TYPE_VIDEOGAME) {
    const idGenero = parseId(reqBody.id_genero);
    const idPlataforma = parseId(reqBody.id_plataforma);
    const formatos = toJsonList(reqBody.formatos).map(parseId).filter(Boolean);

    if (!idGenero || !idPlataforma || !formatos.length) {
      const error = new Error("Los videojuegos requieren genero, plataforma y al menos un formato");
      error.status = 400;
      throw error;
    }

    await VideoJuego.create(
      {
        id_producto: productId,
        id_genero: idGenero,
        id_plataforma: idPlataforma,
        fecha_lanzamiento: normalizeText(reqBody.fecha_lanzamiento) || null,
      },
      { transaction },
    );

    await Promise.all(
      [...new Set(formatos)].map((id_formato) =>
        VideoJuegoFormato.create({ id_videojuego: productId, id_formato }, { transaction }),
      ),
    );
    return;
  }

  if (typeSlug === PRODUCT_TYPE_ACCESSORY) {
    const idTipoAccesorio = parseId(reqBody.id_tipo_accesorio);
    if (!idTipoAccesorio) {
      const error = new Error("Los accesorios requieren un tipo de accesorio");
      error.status = 400;
      throw error;
    }
    await Accesorio.create({ id_producto: productId, id_tipo_accesorio: idTipoAccesorio }, { transaction });
    return;
  }

  if (typeSlug === PRODUCT_TYPE_COLLECTIBLE) {
    const idTipoColeccionable = parseId(reqBody.id_tipo_coleccionable);
    if (!idTipoColeccionable) {
      const error = new Error("Los coleccionables requieren un tipo de coleccionable");
      error.status = 400;
      throw error;
    }
    await Coleccionable.create(
      { id_producto: productId, id_tipo_coleccionable: idTipoColeccionable },
      { transaction },
    );
  }
};

const persistProductImage = async (productId, product, file, transaction) => {
  if (!file) return product.imagen_url;

  const uploaded = await uploadBufferToCloudinary(file, "neogaming/productos");
  const imageUrl = uploaded?.secure_url || uploaded?.url;

  if (!imageUrl) {
    const error = new Error("No se pudo subir la imagen del producto");
    error.status = 500;
    throw error;
  }

  await product.update({ imagen_url: imageUrl }, { transaction });

  const previousMain = await ImagenProducto.findOne({
    where: { id_producto: productId, es_principal: true },
    transaction,
  });

  if (previousMain) {
    await previousMain.update({ es_principal: false }, { transaction });
  }

  await ImagenProducto.create(
    {
      id_producto: productId,
      url: imageUrl,
      es_principal: true,
    },
    { transaction },
  );

  return imageUrl;
};

const catalogDefinitions = {
  tiposProducto: { model: TipoProducto, idField: "id_tipo_producto", extra: [] },
  fabricantes: { model: Fabricante, idField: "id_fabricante", extra: [] },
  generos: { model: Genero, idField: "id_genero", extra: [] },
  plataformas: { model: Plataforma, idField: "id_plataforma", extra: [] },
  formatos: { model: Formato, idField: "id_formato", extra: [] },
  metodosPago: { model: MetodoPago, idField: "id_metodo_pago", extra: [] },
  estadosPedido: { model: EstadoPedido, idField: "id_estado_pedido", extra: [] },
  estadosEnvio: { model: EstadoEnvio, idField: "id_estado_envio", extra: [] },
  provincias: { model: Provincia, idField: "id_provincia", extra: [] },
  tiposAccesorio: { model: TipoAccesorio, idField: "id_tipo_accesorio", extra: [] },
  tiposColeccionable: { model: TipoColeccionable, idField: "id_tipo_coleccionable", extra: [] },
  municipios: { model: Municipio, idField: "id_municipio", extra: ["id_provincia"] },
};

const loadCatalogsPayload = async () => {
  const [
    tiposProducto,
    fabricantes,
    generos,
    plataformas,
    formatos,
    metodosPago,
    estadosPedido,
    estadosEnvio,
    provincias,
    municipios,
    tiposAccesorio,
    tiposColeccionable,
  ] = await Promise.all([
    TipoProducto.findAll({ order: [["nombre", "ASC"]] }),
    Fabricante.findAll({ order: [["nombre", "ASC"]] }),
    Genero.findAll({ order: [["nombre", "ASC"]] }),
    Plataforma.findAll({ order: [["nombre", "ASC"]] }),
    Formato.findAll({ order: [["nombre", "ASC"]] }),
    MetodoPago.findAll({ order: [["nombre", "ASC"]] }),
    EstadoPedido.findAll({ order: [["id_estado_pedido", "ASC"]] }),
    EstadoEnvio.findAll({ order: [["id_estado_envio", "ASC"]] }),
    Provincia.findAll({ order: [["nombre", "ASC"]] }),
    Municipio.findAll({ order: [["nombre", "ASC"]] }),
    TipoAccesorio.findAll({ order: [["nombre", "ASC"]] }),
    TipoColeccionable.findAll({ order: [["nombre", "ASC"]] }),
  ]);

  return {
    tiposProducto,
    fabricantes,
    generos,
    plataformas,
    formatos,
    metodosPago,
    estadosPedido,
    estadosEnvio,
    provincias,
    municipios,
    tiposAccesorio,
    tiposColeccionable,
  };
};

app.post("/api/login", async (req, res) => {
  const email = normalizeLower(req.body?.email);
  const plainPassword = String(req.body?.contrasena || "");

  if (!email || !plainPassword) {
    return res.status(400).json({ error: "Email y contrasena son obligatorios" });
  }

  try {
    let user = await Usuario.findOne({
      where: { email },
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    if (!user) {
      const legacyUserId = await findLegacyUserId(email);
      if (legacyUserId) {
        user = await Usuario.findByPk(legacyUserId, {
          include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
        });
      }
    }

    if (!user) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    const storedPassword = String(user.contrasena_hash || "");
    let passwordValid = false;

    if (storedPassword.startsWith("$2")) {
      passwordValid = await bcrypt.compare(plainPassword, storedPassword);
    } else if (plainPassword && plainPassword === storedPassword) {
      passwordValid = true;
      user.contrasena_hash = await bcrypt.hash(plainPassword, 10);
      await user.save();
    }

    if (!passwordValid) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    if (user.activo === false) {
      return res.status(403).json({ error: "La cuenta esta desactivada" });
    }

    const token = jwt.sign({ id_usuario: user.id_usuario }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: serializeUser(user), expires_in: JWT_EXPIRES_IN });
  } catch (error) {
      console.error("Error en login:", error);
      res.status(500).json({ error: "Error en login", detail: error.message });
    }
});

app.post("/api/usuarios", async (req, res) => {
  const { nombre, apellido, email, telefono, contrasena } = req.body;

  if (!normalizeText(nombre) || !normalizeText(apellido) || !normalizeText(email) || !normalizeText(contrasena)) {
    return res.status(400).json({ error: "Nombre, apellido, email y contrasena son obligatorios" });
  }

  try {
    const normalizedEmail = normalizeLower(email);
    const existingUser = await Usuario.findOne({ where: { email: normalizedEmail } });

    if (existingUser) {
      return res.status(409).json({ error: "El email ya esta registrado" });
    }

    const contrasena_hash = await bcrypt.hash(String(contrasena), 10);
    const nuevoUsuario = await Usuario.create({
      id_rol: 1,
      nombre: normalizeText(nombre),
      apellido: normalizeText(apellido),
      email: normalizedEmail,
      telefono: normalizeText(telefono) || null,
      contrasena_hash,
      activo: true,
    });

    res.status(201).json({ message: "Usuario registrado correctamente", user: serializeUser(nuevoUsuario) });
  } catch {
    res.status(500).json({ error: "Error registrando usuario" });
  }
});

app.get("/api/catalogos", async (_req, res) => {
  try {
    res.json(await loadCatalogsPayload());
  } catch {
    res.status(500).json({ error: "Error obteniendo catalogos" });
  }
});

app.get("/api/perfil", authMiddleware, async (req, res) => {
  res.json(serializeUser(req.user));
});

app.put("/api/perfil", authMiddleware, uploadMemory.single("avatar"), async (req, res) => {
  try {
    const updates = {};

    for (const field of ["nombre", "apellido", "telefono"]) {
      if (req.body[field] !== undefined) {
        const normalized = normalizeText(req.body[field]);
        updates[field] = normalized || null;
      }
    }

    if (req.file) {
      const uploaded = await uploadBufferToCloudinary(req.file, "neogaming/perfiles");
      updates.avatar_url = uploaded?.secure_url || uploaded?.url;
    }

    if (Object.keys(updates).length) {
      await req.user.update(updates);
    }

    const refreshedUser = await Usuario.findByPk(req.user.id_usuario, {
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    res.json(serializeUser(refreshedUser));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error actualizando perfil" });
  }
});

app.get("/api/direcciones", authMiddleware, async (req, res) => {
  try {
    const rows = await Direccion.findAll({
      where: { id_usuario: req.user.id_usuario },
      include: [
        { model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] },
        { model: Municipio, as: "Municipio", attributes: ["id_municipio", "nombre", "id_provincia"] },
      ],
      order: [["es_principal", "DESC"], ["id_direccion", "DESC"]],
    });

    res.json(rows.map(mapDireccion));
  } catch {
    res.status(500).json({ error: "Error obteniendo direcciones" });
  }
});

app.post("/api/direcciones", authMiddleware, async (req, res) => {
  try {
    let created = null;
    await sequelize.transaction(async (transaction) => {
      const resolved = await resolveDireccionPayload({ ...req.body, guardar_direccion: true }, req.user.id_usuario, transaction);
      created = resolved.record;
    });

    const payload = await Direccion.findByPk(created.id_direccion, {
      include: [
        { model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] },
        { model: Municipio, as: "Municipio", attributes: ["id_municipio", "nombre", "id_provincia"] },
      ],
    });

    res.status(201).json(mapDireccion(payload));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error creando direccion" });
  }
});

app.put("/api/direcciones/:idDireccion", authMiddleware, async (req, res) => {
  try {
    const idDireccion = parseId(req.params.idDireccion);
    const address = await Direccion.findOne({
      where: { id_direccion: idDireccion, id_usuario: req.user.id_usuario },
    });

    if (!address) {
      return res.status(404).json({ error: "Direccion no encontrada" });
    }

    await sequelize.transaction(async (transaction) => {
      const idProvincia = parseId(req.body.id_provincia);
      const idMunicipio = parseId(req.body.id_municipio);
      const municipioPersonalizado = normalizeText(req.body.municipio_personalizado);
      const latitud = parseDecimal(req.body.latitud);
      const longitud = parseDecimal(req.body.longitud);
      const sector = normalizeText(req.body.sector) || null;
      const referencia = normalizeText(req.body.referencia) || normalizeText(req.body.detalle) || null;

      assertNotEmpty(req.body.calle, "La direccion requiere calle");
      assertNotEmpty(req.body.numero_casa, "La direccion requiere numero de casa o referencia");

      const province = await Provincia.findByPk(idProvincia, { transaction });
      if (!province) {
        const error = new Error("Provincia invalida");
        error.status = 400;
        throw error;
      }

      let municipalityToSave = idMunicipio;
      if (municipioPersonalizado) {
        const placeholderMunicipality = await Municipio.findOne({
          where: { id_provincia: idProvincia },
          order: [["nombre", "ASC"]],
          transaction,
        });

        if (!placeholderMunicipality) {
          const error = new Error("No hay municipios registrados para esa provincia");
          error.status = 400;
          throw error;
        }
        municipalityToSave = placeholderMunicipality.id_municipio;
      } else {
        const municipality = await Municipio.findOne({
          where: { id_municipio: idMunicipio, id_provincia: idProvincia },
          transaction,
        });
        if (!municipality) {
          const error = new Error("Municipio invalido para la provincia seleccionada");
          error.status = 400;
          throw error;
        }
      }

      const nextPrincipal = parseBoolean(req.body.es_principal, address.es_principal);
      await address.update(
        {
          calle: normalizeText(req.body.calle),
          numero_casa: normalizeText(req.body.numero_casa),
          detalle: normalizeText(req.body.detalle) || null,
          id_provincia: idProvincia,
          id_municipio: municipalityToSave,
          municipio_personalizado: municipioPersonalizado || null,
          es_principal: nextPrincipal,
          latitud,
          longitud,
          sector,
          referencia,
        },
        { transaction },
      );

      if (nextPrincipal) {
        await Direccion.update(
          { es_principal: false },
          {
            where: {
              id_usuario: req.user.id_usuario,
              id_direccion: { [Op.ne]: address.id_direccion },
            },
            transaction,
          },
        );
      }
    });

    const payload = await Direccion.findByPk(address.id_direccion, {
      include: [
        { model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] },
        { model: Municipio, as: "Municipio", attributes: ["id_municipio", "nombre", "id_provincia"] },
      ],
    });

    res.json(mapDireccion(payload));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error actualizando direccion" });
  }
});

app.get("/api/productos", async (_req, res) => {
  try {
    const products = await Producto.findAll({
      where: { activo: { [Op.ne]: false } },
      include: publicProductInclude,
      order: [["id_producto", "DESC"]],
    });
    res.json(products.map(mapProduct));
  } catch {
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

app.get("/api/productos/:id", async (req, res) => {
  try {
    const product = await loadProductRecord(req.params.id, null, false, true);
    if (!product || product.activo === false) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json(mapProduct(product));
  } catch {
    res.status(500).json({ error: "Error obteniendo producto" });
  }
});

app.post("/api/productos", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), uploadMemory.single("imagen"), async (req, res) => {
  try {
    const productId = await sequelize.transaction(async (transaction) => {
      const idTipoProducto = parseId(req.body.id_tipo_producto);
      const tipoProducto = await TipoProducto.findByPk(idTipoProducto, { transaction });

      if (!tipoProducto) {
        const error = new Error("Tipo de producto invalido");
        error.status = 400;
        throw error;
      }

      assertNotEmpty(req.body.titulo, "El titulo es obligatorio");

      const product = await Producto.create(
        {
          id_tipo_producto: idTipoProducto,
          id_fabricante: parseId(req.body.id_fabricante),
          titulo: normalizeText(req.body.titulo),
          descripcion: normalizeText(req.body.descripcion) || null,
          precio: moneyToDb(req.body.precio),
          stock: Number(req.body.stock ?? 0),
          activo: parseBoolean(req.body.activo, true),
        },
        { transaction },
      );

      await saveProductSubtype(product.id_producto, req.body, getTypeSlug(tipoProducto), transaction);
      await persistProductImage(product.id_producto, product, req.file, transaction);
      return product.id_producto;
    });

    res.status(201).json(mapProduct(await loadProductRecord(productId)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error creando producto" });
  }
});

app.put("/api/productos/:id", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), uploadMemory.single("imagen"), async (req, res) => {
  try {
    const productId = parseId(req.params.id);

    await sequelize.transaction(async (transaction) => {
      const product = await Producto.findByPk(productId, {
        transaction,
        lock: { level: transaction.LOCK.UPDATE, of: Producto },
      });

      if (!product) {
        const error = new Error("Producto no encontrado");
        error.status = 404;
        throw error;
      }

      const nextTypeId = parseId(req.body.id_tipo_producto) || product.id_tipo_producto;
      const tipoProducto = await TipoProducto.findByPk(nextTypeId, { transaction });

      if (!tipoProducto) {
        const error = new Error("Tipo de producto invalido");
        error.status = 400;
        throw error;
      }

      await product.update(
        {
          id_tipo_producto: nextTypeId,
          id_fabricante: parseId(req.body.id_fabricante),
          titulo: normalizeText(req.body.titulo) || product.titulo,
          descripcion:
            req.body.descripcion !== undefined
              ? normalizeText(req.body.descripcion) || null
              : product.descripcion,
          precio:
            req.body.precio !== undefined && req.body.precio !== ""
              ? moneyToDb(req.body.precio)
              : product.precio,
          stock:
            req.body.stock !== undefined && req.body.stock !== ""
              ? Number(req.body.stock)
              : product.stock,
          activo:
            req.body.activo !== undefined ? parseBoolean(req.body.activo, product.activo) : product.activo,
        },
        { transaction },
      );

      await clearProductSubtypeRows(productId, transaction);
      await saveProductSubtype(productId, req.body, getTypeSlug(tipoProducto), transaction);
      await persistProductImage(productId, product, req.file, transaction);
    });

    res.json(mapProduct(await loadProductRecord(productId)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error actualizando producto" });
  }
});

app.delete("/api/productos/:id", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const product = await Producto.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    await product.update({ activo: false });
    res.json({ message: "Producto desactivado correctamente" });
  } catch {
    res.status(500).json({ error: "Error eliminando producto" });
  }
});

app.post("/api/resenas", authMiddleware, async (req, res) => {
  const { id_producto, puntuacion, comentario } = req.body;
  if (!id_producto || !normalizeText(comentario) || !puntuacion) {
    return res.status(400).json({ error: "Producto, puntuacion y comentario son obligatorios" });
  }

  try {
    const product = await Producto.findByPk(id_producto);
    if (!product || product.activo === false) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const review = await Resena.create({
      id_usuario: req.user.id_usuario,
      id_producto,
      puntuacion: Number(puntuacion),
      comentario: normalizeText(comentario),
      estado: REVIEW_STATUS_PENDING,
      fecha_resena: new Date(),
    });

    res.status(201).json({ message: "Resena enviada para moderacion", review });
  } catch {
    res.status(500).json({ error: "Error publicando resena" });
  }
});

app.get("/api/carrito", authMiddleware, async (req, res) => {
  try {
    res.json(await buildCartPayload(req.user.id_usuario));
  } catch {
    res.status(500).json({ error: "Error obteniendo carrito" });
  }
});

app.post("/api/carrito", authMiddleware, async (req, res) => {
  const quantityToAdd = Number(req.body.cantidad || 1);
  const productId = parseId(req.body.id_producto);

  if (!productId || quantityToAdd < 1) {
    return res.status(400).json({ error: "Producto y cantidad validos son requeridos" });
  }

  try {
    await sequelize.transaction(async (transaction) => {
      const cart = await getOrCreateCart(req.user.id_usuario, transaction);
      const pricing = await resolveLinePricing(productId, transaction, true);
      const existing = await CarritoDetalle.findOne({
        where: { id_carrito: cart.id_carrito, id_producto: productId },
        transaction,
        lock: { level: transaction.LOCK.UPDATE, of: CarritoDetalle },
      });

      const nextQuantity = Number(existing?.cantidad || 0) + quantityToAdd;

      if (nextQuantity > pricing.stockAvailable) {
        const error = new Error("No hay stock suficiente para esa cantidad");
        error.status = 409;
        throw error;
      }

      if (existing) {
        await existing.update({ cantidad: nextQuantity }, { transaction });
      } else {
        await CarritoDetalle.create(
          { id_carrito: cart.id_carrito, id_producto: productId, cantidad: quantityToAdd },
          { transaction },
        );
      }

      await touchCart(cart, transaction);
    });

    res.status(201).json(await buildCartPayload(req.user.id_usuario));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error agregando al carrito" });
  }
});

app.put("/api/carrito/:idDetalle", authMiddleware, async (req, res) => {
  const cantidad = Number(req.body.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return res.status(400).json({ error: "La cantidad debe ser mayor o igual a 1" });
  }

  try {
    await sequelize.transaction(async (transaction) => {
      const cart = await getOrCreateCart(req.user.id_usuario, transaction);
      const detail = await CarritoDetalle.findOne({
        where: { id_carrito_detalle: req.params.idDetalle, id_carrito: cart.id_carrito },
        transaction,
        lock: true,
      });

      if (!detail) {
        const error = new Error("Item del carrito no encontrado");
        error.status = 404;
        throw error;
      }

      const pricing = await resolveLinePricing(detail.id_producto, transaction, true);
      if (cantidad > pricing.stockAvailable) {
        const error = new Error("Stock insuficiente para la cantidad seleccionada");
        error.status = 409;
        throw error;
      }

      await detail.update({ cantidad }, { transaction });
      await touchCart(cart, transaction);
    });

    res.json(await buildCartPayload(req.user.id_usuario));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error actualizando carrito" });
  }
});

app.delete("/api/carrito/:idDetalle", authMiddleware, async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const cart = await getOrCreateCart(req.user.id_usuario, transaction);
      const deleted = await CarritoDetalle.destroy({
        where: { id_carrito_detalle: req.params.idDetalle, id_carrito: cart.id_carrito },
        transaction,
      });

      if (!deleted) {
        const error = new Error("Item del carrito no encontrado");
        error.status = 404;
        throw error;
      }

      await touchCart(cart, transaction);
    });

    res.json(await buildCartPayload(req.user.id_usuario));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error eliminando item" });
  }
});

app.post("/api/cupones/validar", authMiddleware, async (req, res) => {
  try {
    const codigoCupon = normalizeText(req.body.codigo_cupon || req.body.codigoCupon);
    assertNotEmpty(codigoCupon, "Debes indicar un código de cupón");

    // Dentro del try de app.post
    const cart = await buildCartPayload(req.user.id_usuario);

    const validation = await validateCouponForCheckout({
      models: { Cupon, CuponUsuario, Descuento, DescuentoProducto, Patrocinador }, // Añade los nuevos modelos
      userId: req.user.id_usuario,
      codigoCupon,
      cartItems: cart.items || [], // <--- IMPORTANTE: Pasa los items aquí
      subtotal: cart.subtotal,
      finalize: false,
    });

    const subtotalConDescuento = roundMoney(cart.subtotal - (validation?.discountAmount || 0));
    const itbis = roundMoney(subtotalConDescuento * ITBIS_RATE);

    res.json({
      aplicado: true,
      cupon: validation?.coupon || null,
      subtotal: cart.subtotal,
      descuento: roundMoney(validation?.discountAmount || 0),
      subtotal_con_descuento: subtotalConDescuento,
      itbis,
      total: roundMoney(subtotalConDescuento + itbis),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "No se pudo validar el cupón" });
  }
});

app.post("/api/checkout", authMiddleware, async (req, res) => {
  let createdOrderId = null;
  let appliedCoupon = null;

  try {
    await sequelize.transaction(async (transaction) => {
      const cart = await getOrCreateCart(req.user.id_usuario, transaction);
      const details = await CarritoDetalle.findAll({
        where: { id_carrito: cart.id_carrito },
        transaction,
        lock: true,
      });

      if (!details.length) {
        const error = new Error("El carrito esta vacio");
        error.status = 400;
        throw error;
      }

      const resolvedAddress = await resolveDireccionPayload(req.body, req.user.id_usuario, transaction);
      const saleLines = [];
      let subtotal = 0;

      for (const detail of details) {
        const pricing = await resolveLinePricing(detail.id_producto, transaction, true);
        const quantity = Number(detail.cantidad || 0);

        if (quantity > pricing.stockAvailable) {
          const error = new Error(`Stock insuficiente para ${pricing.product.titulo}`);
          error.status = 409;
          throw error;
        }

        subtotal += pricing.price * quantity;
        saleLines.push({
          id_producto: detail.id_producto,
          cantidad: quantity,
          precio_unitario_venta: moneyToDb(pricing.price),
          stock_after: pricing.stockAvailable - quantity,
          lineTotal: roundMoney(pricing.price * quantity),
        });
      }

      subtotal = roundMoney(subtotal);
      const couponResult = await validateCouponForCheckout({
        models: { Cupon, CuponUsuario, Descuento },
        userId: req.user.id_usuario,
        codigoCupon: req.body.codigo_cupon,
        subtotal,
        transaction,
        finalize: true,
      });
      appliedCoupon = couponResult?.coupon || null;
      const allocatedLines = allocateDiscountAcrossLines(saleLines, couponResult?.discountAmount || 0);
      const discountedSubtotal = roundMoney(subtotal - (couponResult?.discountAmount || 0));
      const itbis = roundMoney(discountedSubtotal * ITBIS_RATE);
      const total = roundMoney(discountedSubtotal + itbis);

      const pedido = await Pedido.create(
        {
          id_cliente: req.user.id_usuario,
          id_estado_pedido: ORDER_STATUS_CONFIRMADO,
          id_metodo_pago: parseId(req.body.id_metodo_pago) || 1,
          subtotal: moneyToDb(discountedSubtotal),
          costo_envio: moneyToDb(0),
          itbis: moneyToDb(itbis),
          total: moneyToDb(total),
          id_direccion: resolvedAddress.record?.id_direccion || null,
        },
        { transaction },
      );

      for (const line of allocatedLines) {
        await DetallePedido.create(
          {
            id_pedido: pedido.id_pedido,
            id_producto: line.id_producto,
            cantidad: line.cantidad,
            precio_unitario_venta: line.precio_unitario_venta,
            id_descuento: couponResult?.coupon?.id_descuento || null,
            monto_descuento: moneyToDb(line.discountLine || 0),
          },
          { transaction },
        );

        await Producto.update(
          { stock: line.stock_after },
          { where: { id_producto: line.id_producto }, transaction },
        );

        await AjusteInventario.create(
          {
            id_producto: line.id_producto,
            id_usuario_administrador: req.user.id_usuario,
            tipo_ajuste: "Venta",
            cantidad_ajustada: -line.cantidad,
          },
          { transaction },
        );
      }

      await CarritoDetalle.destroy({ where: { id_carrito: cart.id_carrito }, transaction });
      await touchCart(cart, transaction);

      createdOrderId = pedido.id_pedido;
    });

    res.status(201).json({
      message: "Pedido confirmado correctamente",
      pedido: await loadPedidoPayload(createdOrderId),
      carrito: await buildCartPayload(req.user.id_usuario),
      cupon: appliedCoupon,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error procesando checkout" });
  }
});

app.get("/api/pedidos", authMiddleware, async (req, res) => {
  try {
    const where = getUserHierarchyLevel(req.user) >= 2 ? {} : { id_cliente: req.user.id_usuario };
    const orders = await Pedido.findAll({
      where,
      order: [["fecha_pedido", "DESC"]],
    });

    const payload = await Promise.all(orders.map((order) => loadPedidoPayload(order.id_pedido)));
    res.json(payload);
  } catch {
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

app.get("/api/admin/dashboard", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (_req, res) => {
  try {
    const [users, products, orders, pendingReviews, lowStockProducts, pendingCustomMunicipios] = await Promise.all([
      Usuario.count(),
      Producto.count({ where: { activo: { [Op.ne]: false } } }),
      Pedido.findAll({ attributes: ["total"] }),
      Resena.count({ where: { estado: REVIEW_STATUS_PENDING } }),
      Producto.count({ where: { activo: { [Op.ne]: false }, stock: { [Op.lt]: 5 } } }),
      Direccion.count({ where: { municipio_personalizado: { [Op.ne]: null } } }),
    ]);

    res.json({
      usuarios: users,
      productos: products,
      pedidos: orders.length,
      totalVentas: roundMoney(orders.reduce((sum, order) => sum + Number(order.total || 0), 0)),
      resenasPendientes: pendingReviews,
      itemsBajoStock: lowStockProducts,
      municipiosPendientes: pendingCustomMunicipios,
    });
  } catch {
    res.status(500).json({ error: "Error obteniendo resumen administrativo" });
  }
});

app.get("/api/admin/reports", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const { start, end, key } = getReportDateRange(String(req.query.period || "month"));
    const endExclusive = new Date(end.getTime() + 1);

    const [dailyRows] = await sequelize.query(
      `
      SELECT DATE(p.fecha_pedido) AS fecha, COALESCE(SUM(p.total), 0) AS total
      FROM pedido p
      WHERE p.fecha_pedido >= :startDate
        AND p.fecha_pedido < :endDate
      GROUP BY DATE(p.fecha_pedido)
      ORDER BY DATE(p.fecha_pedido) ASC
      `,
      {
        replacements: { startDate: start, endDate: endExclusive },
      },
    );

    const [categoryRows] = await sequelize.query(
      `
      SELECT COALESCE(tp.nombre, 'Sin categoria') AS categoria,
             COALESCE(SUM(d.cantidad * d.precio_unitario_venta), 0) AS total
      FROM detallepedido d
      INNER JOIN pedido p ON p.id_pedido = d.id_pedido
      INNER JOIN producto pr ON pr.id_producto = d.id_producto
      LEFT JOIN tipoproducto tp ON tp.id_tipo_producto = pr.id_tipo_producto
      WHERE p.fecha_pedido >= :startDate
        AND p.fecha_pedido < :endDate
      GROUP BY COALESCE(tp.nombre, 'Sin categoria')
      ORDER BY total DESC
      `,
      {
        replacements: { startDate: start, endDate: endExclusive },
      },
    );

    res.json({
      period: key,
      range: { from: start.toISOString(), to: end.toISOString() },
      dailySales: dailyRows.map((row) => ({ fecha: row.fecha, total: roundMoney(row.total) })),
      categorySales: categoryRows.map((row) => ({ categoria: row.categoria, total: roundMoney(row.total) })),
    });
  } catch {
    res.status(500).json({ error: "Error obteniendo reportes de ventas" });
  }
});

app.get("/api/admin/inventario", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (_req, res) => {
  try {
    const products = await Producto.findAll({
      include: publicProductInclude,
      where: { activo: { [Op.ne]: false } },
      order: [["stock", "ASC"], ["titulo", "ASC"]],
    });

    res.json(
      products.map((product) => {
        const mapped = mapProduct(product);
        return {
          id_producto: mapped.id_producto,
          titulo: mapped.titulo,
          imagen_url: mapped.imagen_url,
          stock: mapped.stock,
          precio: mapped.precio,
          lowStock: mapped.stock < 5,
          activo: mapped.activo !== false,
          tipo_producto_nombre: mapped.tipo_producto_nombre,
          formato: mapped.formato_nombre || "General",
          plataforma: mapped.plataforma_nombre || null,
          genero: mapped.genero_nombre || null,
        };
      }),
    );
  } catch {
    res.status(500).json({ error: "Error obteniendo inventario" });
  }
});

app.put("/api/admin/inventario/:idProducto", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  const stock = Number(req.body.stock);
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "El stock debe ser un entero mayor o igual a 0" });
  }

  try {
    const product = await Producto.findByPk(req.params.idProducto);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const previous = Number(product.stock || 0);
    await sequelize.transaction(async (transaction) => {
      await product.update({ stock }, { transaction });
      await AjusteInventario.create(
        {
          id_producto: product.id_producto,
          id_usuario_administrador: req.user.id_usuario,
          tipo_ajuste: "Ajuste manual",
          cantidad_ajustada: stock - previous,
        },
        { transaction },
      );
    });

    res.json({
      message: "Inventario actualizado",
      id_producto: product.id_producto,
      stock,
    });
  } catch {
    res.status(500).json({ error: "Error actualizando inventario" });
  }
});

app.patch("/api/admin/pedidos/:idPedido/estado", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  const nextStatus = parseId(req.body.id_estado_pedido);
  if (!nextStatus) {
    return res.status(400).json({ error: "Debe indicar el id_estado_pedido" });
  }

  try {
    const order = await Pedido.findByPk(req.params.idPedido);
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const status = await EstadoPedido.findByPk(nextStatus);
    if (!status) {
      return res.status(400).json({ error: "Estado de pedido invalido" });
    }

    const currentStatus = await EstadoPedido.findByPk(order.id_estado_pedido);
    const isTransitionToPaid =
      normalizeLower(status.nombre) === normalizeLower(ORDER_STATUS_PAGADO) &&
      normalizeLower(currentStatus?.nombre) !== normalizeLower(ORDER_STATUS_PAGADO);

    await order.update({ id_estado_pedido: nextStatus });

    const updatedPedido = await loadPedidoPayload(order.id_pedido);
    //const invoice = isTransitionToPaid ? await generateInvoicePdf({ order: updatedPedido }) : null;

    res.json({
      message: "Estado del pedido actualizado",
      pedido: updatedPedido,
      //factura_pdf_url: invoice?.publicUrl || null,
    });
  } catch {
    res.status(500).json({ error: "Error actualizando pedido" });
  }
});

app.get("/api/admin/resenas", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const requestedStatus = normalizeReviewStatus(req.query.estado);
    const where = requestedStatus ? { estado: requestedStatus } : {};
    const reviews = await Resena.findAll({
      where,
      include: [
        { model: Usuario, as: "Usuario", attributes: ["id_usuario", "nombre", "apellido", "email"] },
        { model: Producto, as: "Producto", include: publicProductInclude },
      ],
      order: [["estado", "ASC"], ["fecha_resena", "DESC"]],
    });

    res.json(reviews.map((review) => ({ ...review.get({ plain: true }), Producto: mapProduct(review.Producto) })));
  } catch {
    res.status(500).json({ error: "Error obteniendo resenas" });
  }
});

app.patch("/api/admin/resenas/:idResena", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  const nextStatus = normalizeReviewStatus(req.body.estado);
  if (![REVIEW_STATUS_APPROVED, REVIEW_STATUS_REJECTED].includes(nextStatus)) {
    return res.status(400).json({ error: "Estado de resena invalido" });
  }

  try {
    const review = await Resena.findByPk(req.params.idResena);
    if (!review) {
      return res.status(404).json({ error: "Resena no encontrada" });
    }

    await review.update({
      estado: nextStatus,
      id_moderador: req.user.id_usuario,
      fecha_moderacion: new Date(),
    });

    res.json({ message: `Resena marcada como ${nextStatus}`, review });
  } catch {
    res.status(500).json({ error: "Error moderando resena" });
  }
});

app.get("/api/admin/usuarios", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const actorHierarchy = getRoleHierarchy(req.user);
    const users = await Usuario.findAll({
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
      order: [["id_usuario", "ASC"]],
    });

    res.json(
      users
        .filter((user) => Number(user.id_usuario) !== Number(req.user.id_usuario))
        .filter((user) => getRoleHierarchy(user) <= actorHierarchy)
        .map(serializeUser),
    );
  } catch {
    res.status(500).json({ error: "Error obteniendo usuarios administrativos" });
  }
});

app.patch("/api/admin/usuarios/:idUsuario", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const idUsuario = parseId(req.params.idUsuario);
    const target = await Usuario.findByPk(idUsuario, {
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ error: "No tienes permisos para gestionar este usuario" });
    }

    const updates = {};
    for (const field of ["nombre", "apellido", "telefono"]) {
      if (req.body[field] !== undefined) {
        updates[field] = normalizeText(req.body[field]) || null;
      }
    }

    if (req.body.email !== undefined) {
      const normalizedEmail = normalizeLower(req.body.email);
      if (!normalizedEmail) {
        return res.status(400).json({ error: "El email no puede estar vacio" });
      }
      const emailOwner = await Usuario.findOne({ where: { email: normalizedEmail } });
      if (emailOwner && Number(emailOwner.id_usuario) !== Number(target.id_usuario)) {
        return res.status(409).json({ error: "El email ya esta en uso por otro usuario" });
      }
      updates.email = normalizedEmail;
    }

    if (req.body.id_rol !== undefined) {
      const nextRole = parseId(req.body.id_rol);
      if (!nextRole) {
        return res.status(400).json({ error: "Rol invalido" });
      }
      const nextRoleRecord = await Rol.findByPk(nextRole);
      if (!nextRoleRecord) {
        return res.status(400).json({ error: "Rol invalido" });
      }
      if (Number(nextRoleRecord.nivel_jerarquia ?? 0) >= getRoleHierarchy(req.user)) {
        return res.status(403).json({
          error: "No puedes asignar un rol que no esté por debajo de tu jerarquía",
        });
      }
      updates.id_rol = nextRole;
    }

    if (req.body.activo !== undefined) {
      const nextActive = parseBoolean(req.body.activo, true);
      if (Number(target.id_usuario) === Number(req.user.id_usuario) && !nextActive) {
        return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
      }
      updates.activo = nextActive;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No se enviaron cambios validos" });
    }

    await target.update(updates);
    const refreshed = await Usuario.findByPk(idUsuario, {
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    res.json({ message: "Usuario actualizado", user: serializeUser(refreshed) });
  } catch {
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

app.delete("/api/admin/usuarios/:idUsuario", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const idUsuario = parseId(req.params.idUsuario);
    const target = await Usuario.findByPk(idUsuario, {
      include: [{ model: Rol, as: "Rol", attributes: ROLE_ATTRIBUTES }],
    });

    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (!canManageTargetUser(req.user, target)) {
      return res.status(403).json({ error: "No tienes permisos para borrar este usuario" });
    }

    await target.update({ activo: false });
    res.json({ message: "Usuario desactivado correctamente" });
  } catch {
    res.status(500).json({ error: "Error desactivando usuario" });
  }
});

app.get("/api/admin/municipios-pendientes", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (_req, res) => {
  try {
    const rows = await Direccion.findAll({
      where: { municipio_personalizado: { [Op.ne]: null } },
      include: [{ model: Provincia, as: "Provincia", attributes: ["id_provincia", "nombre"] }],
      order: [["id_direccion", "DESC"]],
    });

    res.json(
      rows.map((row) => ({
        id_direccion: row.id_direccion,
        id_provincia: row.id_provincia,
        provincia_nombre: row.Provincia?.nombre || null,
        municipio_personalizado: row.municipio_personalizado,
        calle: row.calle,
        numero_casa: row.numero_casa,
      })),
    );
  } catch {
    res.status(500).json({ error: "Error obteniendo municipios pendientes" });
  }
});

app.post("/api/admin/municipios-pendientes/validar", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const idProvincia = parseId(req.body.id_provincia);
    const nombre = normalizeText(req.body.nombre);
    assertNotEmpty(nombre, "El municipio requiere un nombre");

    const province = await Provincia.findByPk(idProvincia);
    if (!province) {
      return res.status(400).json({ error: "Provincia invalida" });
    }

    let createdMunicipio = null;
    await sequelize.transaction(async (transaction) => {
      const [municipio] = await Municipio.findOrCreate({
        where: { id_provincia: idProvincia, nombre },
        defaults: { id_provincia: idProvincia, nombre },
        transaction,
      });

      createdMunicipio = municipio;

      await Direccion.update(
        {
          id_municipio: municipio.id_municipio,
          municipio_personalizado: null,
        },
        {
          where: {
            id_provincia: idProvincia,
            municipio_personalizado: nombre,
          },
          transaction,
        },
      );
    });

    res.status(201).json({
      message: "Municipio oficial registrado y direcciones actualizadas",
      municipio: createdMunicipio,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error validando municipio" });
  }
});

app.get("/api/admin/catalogos", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (_req, res) => {
  try {
    res.json(await loadCatalogsPayload());
  } catch {
    res.status(500).json({ error: "Error obteniendo catalogos administrativos" });
  }
});

app.post("/api/admin/catalogos/:catalogKey", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const config = catalogDefinitions[req.params.catalogKey];
    if (!config) {
      return res.status(404).json({ error: "Catalogo no soportado" });
    }

    const nombre = normalizeText(req.body.nombre);
    assertNotEmpty(nombre, "El nombre no puede estar vacio");

    const payload = { nombre };
    for (const field of config.extra) {
      payload[field] = parseId(req.body[field]);
    }

    const created = await config.model.create(payload);
    res.status(201).json(created);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error creando catalogo" });
  }
});

app.put("/api/admin/catalogos/:catalogKey/:id", authMiddleware, requireRoles(STAFF_MIN_HIERARCHY), async (req, res) => {
  try {
    const config = catalogDefinitions[req.params.catalogKey];
    if (!config) {
      return res.status(404).json({ error: "Catalogo no soportado" });
    }

    const record = await config.model.findByPk(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "Registro no encontrado" });
    }

    const payload = {};
    if (req.body.nombre !== undefined) {
      const nombre = normalizeText(req.body.nombre);
      assertNotEmpty(nombre, "El nombre no puede estar vacio");
      payload.nombre = nombre;
    }

    for (const field of config.extra) {
      if (req.body[field] !== undefined) {
        payload[field] = parseId(req.body[field]);
      }
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: "No se enviaron cambios validos" });
    }

    await record.update(payload);
    res.json(record);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error actualizando catalogo" });
  }
});

if (require.main === module) {
  ensureDatabaseCompatibility()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Backend activo en http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("No se pudo preparar la base de datos:", error);
      process.exit(1);
    });
}

module.exports = { app, sequelize, ensureDatabaseCompatibility };
