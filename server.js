require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Sequelize, DataTypes, Op } = require("sequelize");

const JWT_SECRET = process.env.JWT_SECRET || "clave_secreta_para_pruebas";
const PORT = Number(process.env.PORT) || 3000;
const ITBIS_RATE = 0.18;
const ORDER_STATUS_CONFIRMADO = 2;
const REVIEW_STATUS_PENDING = "Pendiente";
const REVIEW_STATUS_APPROVED = "Aprobada";
const REVIEW_STATUS_REJECTED = "Rechazada";
const STAFF_ROLE_IDS = [2, 3];

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

const Rol = sequelize.define(
  "Rol",
  {
    id_rol: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING,
  },
  { tableName: "rol" },
);

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
    avatar_url: DataTypes.STRING,
    activo: DataTypes.BOOLEAN,
  },
  { tableName: "usuario" },
);

const Producto = sequelize.define(
  "Producto",
  {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_tipo_producto: DataTypes.INTEGER,
    id_fabricante: DataTypes.INTEGER,
    titulo: DataTypes.STRING,
    descripcion: DataTypes.TEXT,
    precio: DataTypes.DECIMAL,
    imagen_url: DataTypes.STRING,
    activo: DataTypes.BOOLEAN,
  },
  { tableName: "producto" },
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

const Formato = sequelize.define(
  "Formato",
  {
    id_formato: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING,
  },
  { tableName: "formato" },
);

const Genero = sequelize.define(
  "Genero",
  {
    id_genero: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING,
  },
  { tableName: "genero" },
);

const Plataforma = sequelize.define(
  "Plataforma",
  {
    id_plataforma: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING,
  },
  { tableName: "plataforma" },
);

const VideoJuegoFormato = sequelize.define(
  "VideoJuegoFormato",
  {
    id_vj_formato: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_videojuego: DataTypes.INTEGER,
    id_formato: DataTypes.INTEGER,
    stock: DataTypes.INTEGER,
    precio: DataTypes.DECIMAL,
  },
  { tableName: "videojuegoformato" },
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

const EstadoPedido = sequelize.define(
  "EstadoPedido",
  {
    id_estado_pedido: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING,
  },
  { tableName: "estadopedido" },
);

const Pedido = sequelize.define(
  "Pedido",
  {
    id_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_cliente: DataTypes.INTEGER,
    id_estado_pedido: DataTypes.INTEGER,
    id_metodo_pago: DataTypes.INTEGER,
    subtotal: DataTypes.DECIMAL,
    itbis: DataTypes.DECIMAL,
    total: DataTypes.DECIMAL,
    calle_envio: DataTypes.STRING,
    numero_casa_envio: DataTypes.STRING,
    municipio_envio: DataTypes.STRING,
    provincia_envio: DataTypes.STRING,
    fecha_pedido: DataTypes.DATE,
  },
  { tableName: "pedido" },
);

const DetallePedido = sequelize.define(
  "DetallePedido",
  {
    id_detalle_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_pedido: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    cantidad: DataTypes.INTEGER,
    precio_unitario_venta: DataTypes.DECIMAL,
  },
  { tableName: "detallepedido" },
);

const Resena = sequelize.define(
  "Resena",
  {
    id_resena: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: DataTypes.INTEGER,
    id_producto: DataTypes.INTEGER,
    puntuacion: DataTypes.INTEGER,
    comentario: DataTypes.TEXT,
    estado: DataTypes.STRING,
    id_moderador: DataTypes.INTEGER,
    fecha_resena: DataTypes.DATE,
    fecha_moderacion: DataTypes.DATE,
  },
  { tableName: "resena" },
);

Usuario.belongsTo(Rol, { foreignKey: "id_rol", as: "Rol" });
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
CarritoCabecera.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });
Usuario.hasOne(CarritoCabecera, { foreignKey: "id_usuario", as: "Carrito" });
CarritoCabecera.hasMany(CarritoDetalle, {
  foreignKey: "id_carrito",
  as: "Detalles",
});
CarritoDetalle.belongsTo(CarritoCabecera, { foreignKey: "id_carrito", as: "Carrito" });
CarritoDetalle.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Producto.hasMany(CarritoDetalle, { foreignKey: "id_producto", as: "ItemsCarrito" });
Pedido.belongsTo(Usuario, { foreignKey: "id_cliente", as: "Cliente" });
Pedido.belongsTo(EstadoPedido, { foreignKey: "id_estado_pedido", as: "Estado" });
Pedido.hasMany(DetallePedido, { foreignKey: "id_pedido", as: "Detalles" });
DetallePedido.belongsTo(Pedido, { foreignKey: "id_pedido", as: "Pedido" });
DetallePedido.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Producto.hasMany(DetallePedido, { foreignKey: "id_producto", as: "Ventas" });
Producto.hasMany(Resena, { foreignKey: "id_producto", as: "Resenas" });
Resena.belongsTo(Producto, { foreignKey: "id_producto", as: "Producto" });
Resena.belongsTo(Usuario, { foreignKey: "id_usuario", as: "Usuario" });

app.use(cors());
app.use(compression());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const avatarDir = path.join(__dirname, "uploads", "perfiles");
const productDir = path.join(__dirname, "uploads", "productos");

for (const directory of [avatarDir, productDir]) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, avatarDir),
  filename: (_, file, cb) => cb(null, `user_${Date.now()}${path.extname(file.originalname)}`),
});

const productStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, productDir),
  filename: (_, file, cb) => cb(null, `prod_${Date.now()}${path.extname(file.originalname)}`),
});

const uploadAvatar = multer({ storage: avatarStorage });
const uploadProduct = multer({ storage: productStorage });

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const roundMoney = (value) => Number(toNumber(value).toFixed(2));
const moneyToDb = (value) => roundMoney(value).toFixed(2);

const serializeUser = (user) => {
  if (!user) return null;
  const plain = typeof user.get === "function" ? user.get({ plain: true }) : { ...user };
  delete plain.contrasena_hash;
  return plain;
};

const publicProductInclude = [
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
];

const selectPreferredFormat = (formatos = []) =>
  [...formatos].sort((left, right) => {
    const leftHasStock = (left.stock ?? 0) > 0 ? 1 : 0;
    const rightHasStock = (right.stock ?? 0) > 0 ? 1 : 0;

    if (rightHasStock !== leftHasStock) {
      return rightHasStock - leftHasStock;
    }

    const leftPrice = toNumber(left.precio);
    const rightPrice = toNumber(right.precio);

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return (left.id_formato ?? 0) - (right.id_formato ?? 0);
  })[0] || null;

const mapProduct = (productInstance) => {
  const product = productInstance?.get
    ? productInstance.get({ plain: true })
    : productInstance;

  if (!product) return null;

  const formatos = product.VideoJuego?.Formatos || [];
  const preferredFormat = selectPreferredFormat(formatos);
  const stockTotal = formatos.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const reviewList = product.Resenas || [];
  const reviewCount = reviewList.length;
  const rating =
    reviewCount > 0
      ? roundMoney(
          reviewList.reduce((sum, review) => sum + Number(review.puntuacion || 0), 0) /
            reviewCount,
        )
      : null;

  return {
    ...product,
    precio:
      preferredFormat?.precio != null
        ? roundMoney(preferredFormat.precio)
        : roundMoney(product.precio),
    precio_base: roundMoney(product.precio),
    formato_nombre: preferredFormat?.Formato?.nombre || null,
    stock_disponible:
      preferredFormat?.stock != null
        ? Number(preferredFormat.stock)
        : stockTotal || null,
    stock_total: stockTotal || null,
    genero_nombre: product.VideoJuego?.Genero?.nombre || null,
    plataforma_nombre: product.VideoJuego?.Plataforma?.nombre || null,
    formatos_disponibles: formatos.map((item) => ({
      id_vj_formato: item.id_vj_formato,
      id_formato: item.id_formato,
      nombre: item.Formato?.nombre || null,
      precio: roundMoney(item.precio),
      stock: Number(item.stock || 0),
    })),
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
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    if (!user || user.activo === false) {
      return res.status(401).json({ error: "Usuario no autorizado" });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: "Token invalido" });
  }
};

const requireRoles =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(Number(req.user.id_rol))) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    next();
  };

const getOrCreateCart = async (idUsuario, transaction) => {
  let cart = await CarritoCabecera.findOne({
    where: { id_usuario: idUsuario },
    transaction,
    lock: transaction ? true : undefined,
  });

  if (!cart) {
    cart = await CarritoCabecera.create(
      {
        id_usuario: idUsuario,
        fecha_actualizacion: new Date(),
      },
      { transaction },
    );
  }

  return cart;
};

const touchCart = (cart, transaction) =>
  cart.update({ fecha_actualizacion: new Date() }, { transaction });

const loadProductForSale = async (idProducto, transaction, lock = false) =>
  Producto.findByPk(idProducto, {
    include: publicProductInclude,
    transaction,
    lock: transaction && lock ? true : undefined,
  });

const resolveLinePricing = async (idProducto, transaction, lock = false) => {
  const productInstance = await loadProductForSale(idProducto, transaction, lock);

  if (!productInstance || productInstance.activo === false) {
    const error = new Error("Producto no disponible");
    error.status = 404;
    throw error;
  }

  const product = mapProduct(productInstance);
  const availableFormats = productInstance.VideoJuego?.Formatos || [];
  const preferredFormatSnapshot = selectPreferredFormat(
    availableFormats.map((item) => item.get({ plain: true })),
  );
  const preferredFormat = preferredFormatSnapshot
    ? await VideoJuegoFormato.findByPk(preferredFormatSnapshot.id_vj_formato, {
        include: [{ model: Formato, as: "Formato", attributes: ["id_formato", "nombre"] }],
        transaction,
        lock: transaction && lock ? true : undefined,
      })
    : null;

  return {
    product,
    price:
      preferredFormat?.precio != null
        ? roundMoney(preferredFormat.precio)
        : roundMoney(product.precio),
    formatName: preferredFormat?.Formato?.nombre || product.formato_nombre || "General",
    stockControlled: Boolean(preferredFormat),
    stockAvailable:
      preferredFormat?.stock != null ? Number(preferredFormat.stock) : Number.MAX_SAFE_INTEGER,
    inventoryRow: preferredFormat,
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
    return {
      id_carrito: null,
      items: [],
      subtotal: 0,
      itbis: 0,
      total: 0,
      cantidadItems: 0,
    };
  }

  const items = cart.Detalles.map((item) => {
    const mappedProduct = mapProduct(item.Producto);
    const unitPrice = roundMoney(mappedProduct.precio);
    const lineTotal = roundMoney(unitPrice * Number(item.cantidad || 0));

    return {
      id_carrito_detalle: item.id_carrito_detalle,
      id_producto: item.id_producto,
      cantidad: Number(item.cantidad || 0),
      titulo: mappedProduct.titulo,
      descripcion: mappedProduct.descripcion,
      imagen_url: mappedProduct.imagen_url,
      precio_unitario: unitPrice,
      total_linea: lineTotal,
      formato: mappedProduct.formato_nombre || "General",
      genero: mappedProduct.genero_nombre,
      plataforma: mappedProduct.plataforma_nombre,
      stock_disponible: mappedProduct.stock_disponible,
    };
  });

  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + item.precio_unitario * item.cantidad, 0),
  );
  const itbis = roundMoney(subtotal * ITBIS_RATE);
  const total = roundMoney(subtotal + itbis);

  return {
    id_carrito: cart.id_carrito,
    items,
    subtotal,
    itbis,
    total,
    cantidadItems: items.reduce((sum, item) => sum + item.cantidad, 0),
  };
};

const loadPedidoPayload = async (pedidoId) => {
  const pedido = await Pedido.findByPk(pedidoId, {
    include: [
      {
        model: Usuario,
        as: "Cliente",
        attributes: ["id_usuario", "nombre", "apellido", "email"],
      },
      {
        model: EstadoPedido,
        as: "Estado",
        attributes: ["id_estado_pedido", "nombre"],
      },
      {
        model: DetallePedido,
        as: "Detalles",
        include: [{ model: Producto, as: "Producto", attributes: ["id_producto", "titulo", "imagen_url"] }],
      },
    ],
  });

  if (!pedido) return null;

  const plain = pedido.get({ plain: true });
  return {
    ...plain,
    subtotal: roundMoney(plain.subtotal),
    itbis: roundMoney(plain.itbis),
    total: roundMoney(plain.total),
    fecha_pedido: plain.fecha_pedido,
    Detalles: (plain.Detalles || []).map((detail) => ({
      ...detail,
      precio_unitario_venta: roundMoney(detail.precio_unitario_venta),
    })),
  };
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

app.post("/api/login", async (req, res) => {
  const { email, contrasena } = req.body;

  try {
    const user = await Usuario.findOne({
      where: { email: String(email || "").trim().toLowerCase() },
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    if (!user) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    const plainPassword = String(contrasena || "");
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

    const token = jwt.sign({ id_usuario: user.id_usuario }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ token, user: serializeUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Error en login" });
  }
});

app.post("/api/usuarios", async (req, res) => {
  const { nombre, apellido, email, telefono, contrasena } = req.body;

  if (!nombre || !apellido || !email || !contrasena) {
    return res.status(400).json({ error: "Nombre, apellido, email y contrasena son obligatorios" });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await Usuario.findOne({ where: { email: normalizedEmail } });

    if (existingUser) {
      return res.status(409).json({ error: "El email ya esta registrado" });
    }

    const contrasena_hash = await bcrypt.hash(String(contrasena), 10);
    const nuevoUsuario = await Usuario.create({
      id_rol: 1,
      nombre: String(nombre).trim(),
      apellido: String(apellido).trim(),
      email: normalizedEmail,
      telefono: telefono ? String(telefono).trim() : null,
      contrasena_hash,
      activo: true,
    });

    res.status(201).json({
      message: "Usuario registrado correctamente",
      user: serializeUser(nuevoUsuario),
    });
  } catch (error) {
    res.status(500).json({ error: "Error registrando usuario" });
  }
});

// Agrega esto justo después de tu app.post("/api/usuarios")
app.get("/api/usuarios/:id", authMiddleware, async (req, res) => {
  try {
    const idUsuario = Number(req.params.id);
    
    // Buscamos el usuario incluyendo su rol para el frontend
    const user = await Usuario.findByPk(idUsuario, {
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Usamos tu función serializeUser para no enviar la contraseña
    res.json(serializeUser(user));
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el detalle del usuario" });
  }
});

app.get("/api/perfil", authMiddleware, async (req, res) => {
  res.json(serializeUser(req.user));
});

app.put("/api/perfil", authMiddleware, uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const updates = {};

    for (const field of ["nombre", "apellido", "telefono"]) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (req.file) {
      updates.avatar_url = `/uploads/perfiles/${req.file.filename}`;
    }

    if (Object.keys(updates).length > 0) {
      await req.user.update(updates);
    }

    const refreshedUser = await Usuario.findByPk(req.user.id_usuario, {
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    res.json(serializeUser(refreshedUser));
  } catch (error) {
    res.status(500).json({ error: "Error actualizando perfil" });
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
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

app.get("/api/productos/:id", async (req, res) => {
  try {
    const product = await Producto.findByPk(req.params.id, {
      include: [
        ...publicProductInclude,
        {
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
        },
      ],
      order: [[{ model: Resena, as: "Resenas" }, "fecha_resena", "DESC"]],
    });

    if (!product || product.activo === false) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(mapProduct(product));
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo producto" });
  }
});

app.post(
  "/api/productos",
  authMiddleware,
  requireRoles(...STAFF_ROLE_IDS),
  uploadProduct.single("imagen"),
  async (req, res) => {
    try {
      const payload = {
        id_tipo_producto: req.body.id_tipo_producto,
        id_fabricante: req.body.id_fabricante || null,
        titulo: req.body.titulo,
        descripcion: req.body.descripcion || null,
        precio: req.body.precio ? moneyToDb(req.body.precio) : moneyToDb(0),
        activo: req.body.activo !== undefined ? req.body.activo !== "false" : true,
      };

      if (req.file) {
        payload.imagen_url = `/uploads/productos/${req.file.filename}`;
      }

      const nuevoProducto = await Producto.create(payload);
      const created = await loadProductForSale(nuevoProducto.id_producto);
      res.status(201).json(mapProduct(created));
    } catch (error) {
      res.status(500).json({ error: "Error creando producto" });
    }
  },
);

app.put(
  "/api/productos/:id",
  authMiddleware,
  requireRoles(...STAFF_ROLE_IDS),
  uploadProduct.single("imagen"),
  async (req, res) => {
    try {
      const product = await Producto.findByPk(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      const updates = {
        id_tipo_producto: req.body.id_tipo_producto ?? product.id_tipo_producto,
        id_fabricante: req.body.id_fabricante ?? product.id_fabricante,
        titulo: req.body.titulo ?? product.titulo,
        descripcion: req.body.descripcion ?? product.descripcion,
        activo:
          req.body.activo !== undefined
            ? req.body.activo !== "false" && req.body.activo !== false
            : product.activo,
      };

      if (req.body.precio !== undefined && req.body.precio !== "") {
        updates.precio = moneyToDb(req.body.precio);
      }

      if (req.file) {
        updates.imagen_url = `/uploads/productos/${req.file.filename}`;
      }

      await product.update(updates);
      const updated = await loadProductForSale(product.id_producto);
      res.json(mapProduct(updated));
    } catch (error) {
      res.status(500).json({ error: "Error actualizando producto" });
    }
  },
);

app.delete("/api/productos/:id", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  try {
    const product = await Producto.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    await product.update({ activo: false });
    res.json({ message: "Producto desactivado correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error eliminando producto" });
  }
});

app.post("/api/resenas", authMiddleware, async (req, res) => {
  const { id_producto, puntuacion, comentario } = req.body;

  if (!id_producto || !comentario || !puntuacion) {
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
      comentario,
      estado: REVIEW_STATUS_PENDING,
      fecha_resena: new Date(),
    });

    res.status(201).json({
      message: "Resena enviada para moderacion",
      review,
    });
  } catch (error) {
    res.status(500).json({ error: "Error publicando resena" });
  }
});

app.get("/api/carrito", authMiddleware, async (req, res) => {
  try {
    const payload = await buildCartPayload(req.user.id_usuario);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo carrito" });
  }
});

app.post("/api/carrito", authMiddleware, async (req, res) => {
  const quantityToAdd = Number(req.body.cantidad || 1);
  const productId = Number(req.body.id_producto);

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
        lock: true,
      });

      const nextQuantity = Number(existing?.cantidad || 0) + quantityToAdd;

      if (pricing.stockControlled && nextQuantity > pricing.stockAvailable) {
        const error = new Error("No hay stock suficiente para esa cantidad");
        error.status = 409;
        throw error;
      }

      if (existing) {
        await existing.update({ cantidad: nextQuantity }, { transaction });
      } else {
        await CarritoDetalle.create(
          {
            id_carrito: cart.id_carrito,
            id_producto: productId,
            cantidad: quantityToAdd,
          },
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

      if (pricing.stockControlled && cantidad > pricing.stockAvailable) {
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

app.post("/api/checkout", authMiddleware, async (req, res) => {
  const { calle_envio, numero_casa_envio, municipio_envio, provincia_envio, id_metodo_pago } = req.body;

  if (!calle_envio || !municipio_envio) {
    return res.status(400).json({ error: "La direccion de envio requiere calle y municipio" });
  }

  let createdOrderId = null;

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

      const saleLines = [];
      let subtotal = 0;

      for (const detail of details) {
        const pricing = await resolveLinePricing(detail.id_producto, transaction, true);

        if (pricing.stockControlled && Number(detail.cantidad) > pricing.stockAvailable) {
          const error = new Error(`Stock insuficiente para ${pricing.product.titulo}`);
          error.status = 409;
          throw error;
        }

        const quantity = Number(detail.cantidad || 0);
        const unitPrice = roundMoney(pricing.price);
        subtotal += unitPrice * quantity;

        saleLines.push({
          id_producto: detail.id_producto,
          cantidad: quantity,
          precio_unitario_venta: moneyToDb(unitPrice),
          inventoryRow: pricing.inventoryRow,
        });
      }

      subtotal = roundMoney(subtotal);
      const itbis = roundMoney(subtotal * ITBIS_RATE);
      const total = roundMoney(subtotal + itbis);

      const pedido = await Pedido.create(
        {
          id_cliente: req.user.id_usuario,
          id_estado_pedido: ORDER_STATUS_CONFIRMADO,
          id_metodo_pago: id_metodo_pago || 1,
          fecha_pedido: new Date(),
          subtotal: moneyToDb(subtotal),
          itbis: moneyToDb(itbis),
          total: moneyToDb(total),
          calle_envio,
          numero_casa_envio: numero_casa_envio || null,
          municipio_envio,
          provincia_envio: provincia_envio || null,
        },
        { transaction },
      );

      for (const line of saleLines) {
        await DetallePedido.create(
          {
            id_pedido: pedido.id_pedido,
            id_producto: line.id_producto,
            cantidad: line.cantidad,
            precio_unitario_venta: line.precio_unitario_venta,
          },
          { transaction },
        );

        if (line.inventoryRow) {
          await line.inventoryRow.update(
            { stock: Number(line.inventoryRow.stock || 0) - line.cantidad },
            { transaction },
          );
        }
      }

      await CarritoDetalle.destroy({
        where: { id_carrito: cart.id_carrito },
        transaction,
      });
      await touchCart(cart, transaction);

      createdOrderId = pedido.id_pedido;
    });

    res.status(201).json({
      message: "Pedido confirmado correctamente",
      pedido: await loadPedidoPayload(createdOrderId),
      carrito: await buildCartPayload(req.user.id_usuario),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Error procesando checkout" });
  }
});

app.get("/api/pedidos", authMiddleware, async (req, res) => {
  try {
    const where = STAFF_ROLE_IDS.includes(Number(req.user.id_rol))
      ? {}
      : { id_cliente: req.user.id_usuario };

    const orders = await Pedido.findAll({
      where,
      include: [
        {
          model: Usuario,
          as: "Cliente",
          attributes: ["id_usuario", "nombre", "apellido", "email"],
        },
        {
          model: EstadoPedido,
          as: "Estado",
          attributes: ["id_estado_pedido", "nombre"],
        },
        {
          model: DetallePedido,
          as: "Detalles",
          include: [{ model: Producto, as: "Producto", attributes: ["id_producto", "titulo", "imagen_url"] }],
        },
      ],
      order: [["fecha_pedido", "DESC"]],
    });

    res.json(
      orders.map((order) => ({
        ...order.get({ plain: true }),
        subtotal: roundMoney(order.subtotal),
        itbis: roundMoney(order.itbis),
        total: roundMoney(order.total),
      })),
    );
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo pedidos" });
  }
});

app.get("/api/admin/reports", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  try {
    const { start, end, key } = getReportDateRange(String(req.query.period || "month"));
    const queryInterface = sequelize.getQueryInterface();
    const productSchema = await queryInterface.describeTable("producto");
    let categoryRows = [];

    const [dailyRows] = await sequelize.query(
      `
      SELECT
        DATE(p.fecha_pedido) AS fecha,
        COALESCE(SUM(p.total), 0) AS total
      FROM pedido p
      WHERE p.fecha_pedido >= :startDate
        AND p.fecha_pedido < :endDate
      GROUP BY DATE(p.fecha_pedido)
      ORDER BY DATE(p.fecha_pedido) ASC
      `,
      {
        replacements: {
          startDate: start,
          endDate: new Date(end.getTime() + 1),
        },
      },
    );

    const hasCategoryId = Object.prototype.hasOwnProperty.call(productSchema, "id_categoria");
    if (hasCategoryId) {
      try {
        await queryInterface.describeTable("categoria");
        const [rows] = await sequelize.query(
          `
          SELECT
            COALESCE(c.nombre, 'Sin categoria') AS categoria,
            COALESCE(SUM(d.cantidad * d.precio_unitario_venta), 0) AS total
          FROM detallepedido d
          INNER JOIN pedido p ON p.id_pedido = d.id_pedido
          INNER JOIN producto pr ON pr.id_producto = d.id_producto
          LEFT JOIN categoria c ON c.id_categoria = pr.id_categoria
          WHERE p.fecha_pedido >= :startDate
            AND p.fecha_pedido < :endDate
          GROUP BY COALESCE(c.nombre, 'Sin categoria')
          ORDER BY total DESC
          `,
          {
            replacements: {
              startDate: start,
              endDate: new Date(end.getTime() + 1),
            },
          },
        );
        categoryRows = rows;
      } catch {
        categoryRows = [];
      }
    } else {
      const [rows] = await sequelize.query(
        `
        SELECT
          COALESCE(CAST(pr.id_tipo_producto AS TEXT), 'Sin categoria') AS categoria,
          COALESCE(SUM(d.cantidad * d.precio_unitario_venta), 0) AS total
        FROM detallepedido d
        INNER JOIN pedido p ON p.id_pedido = d.id_pedido
        INNER JOIN producto pr ON pr.id_producto = d.id_producto
        WHERE p.fecha_pedido >= :startDate
          AND p.fecha_pedido < :endDate
        GROUP BY COALESCE(CAST(pr.id_tipo_producto AS TEXT), 'Sin categoria')
        ORDER BY total DESC
        `,
        {
          replacements: {
            startDate: start,
            endDate: new Date(end.getTime() + 1),
          },
        },
      );
      categoryRows = rows.map((row) => ({
        categoria: row.categoria === "Sin categoria" ? row.categoria : `Tipo ${row.categoria}`,
        total: row.total,
      }));
    }

    res.json({
      period: key,
      range: {
        from: start.toISOString(),
        to: end.toISOString(),
      },
      dailySales: dailyRows.map((row) => ({
        fecha: row.fecha,
        total: roundMoney(row.total),
      })),
      categorySales: categoryRows.map((row) => ({
        categoria: row.categoria,
        total: roundMoney(row.total),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo reportes de ventas" });
  }
});

app.get("/api/admin/dashboard", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (_req, res) => {
  try {
    const [users, products, orders, pendingReviews, lowStock] = await Promise.all([
      Usuario.count(),
      Producto.count({ where: { activo: { [Op.ne]: false } } }),
      Pedido.findAll({ attributes: ["total"] }),
      Resena.count({ where: { estado: REVIEW_STATUS_PENDING } }),
      VideoJuegoFormato.count({ where: { stock: { [Op.lt]: 5 } } }),
    ]);

    const totalVentas = roundMoney(
      orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    );

    res.json({
      usuarios: users,
      productos: products,
      pedidos: orders.length,
      totalVentas,
      resenasPendientes: pendingReviews,
      itemsBajoStock: lowStock,
    });
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo resumen administrativo" });
  }
});

app.get("/api/admin/inventario", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (_req, res) => {
  try {
    const inventory = await VideoJuegoFormato.findAll({
      include: [
        { model: Formato, as: "Formato", attributes: ["id_formato", "nombre"] },
        {
          model: VideoJuego,
          as: "VideoJuego",
          include: [
            {
              model: Producto,
              as: "Producto",
              attributes: ["id_producto", "titulo", "imagen_url", "activo"],
            },
            { model: Genero, as: "Genero", attributes: ["nombre"] },
            { model: Plataforma, as: "Plataforma", attributes: ["nombre"] },
          ],
        },
      ],
      order: [
        ["stock", "ASC"],
        [{ model: VideoJuego, as: "VideoJuego" }, { model: Producto, as: "Producto" }, "titulo", "ASC"],
      ],
    });

    res.json(
      inventory.map((row) => ({
        id_vj_formato: row.id_vj_formato,
        id_producto: row.VideoJuego?.Producto?.id_producto || row.id_videojuego,
        titulo: row.VideoJuego?.Producto?.titulo || "Videojuego",
        imagen_url: row.VideoJuego?.Producto?.imagen_url || null,
        formato: row.Formato?.nombre || "General",
        genero: row.VideoJuego?.Genero?.nombre || null,
        plataforma: row.VideoJuego?.Plataforma?.nombre || null,
        stock: Number(row.stock || 0),
        precio: roundMoney(row.precio),
        lowStock: Number(row.stock || 0) < 5,
        activo: row.VideoJuego?.Producto?.activo !== false,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo inventario" });
  }
});

app.put("/api/admin/inventario/:idVjFormato", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  const stock = Number(req.body.stock);

  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "El stock debe ser un entero mayor o igual a 0" });
  }

  try {
    const row = await VideoJuegoFormato.findByPk(req.params.idVjFormato);
    if (!row) {
      return res.status(404).json({ error: "Registro de inventario no encontrado" });
    }

    await row.update({ stock });
    res.json({
      message: "Inventario actualizado",
      id_vj_formato: row.id_vj_formato,
      stock: Number(row.stock || 0),
    });
  } catch (error) {
    res.status(500).json({ error: "Error actualizando inventario" });
  }
});

app.patch("/api/admin/pedidos/:idPedido/estado", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  const nextStatus = Number(req.body.id_estado_pedido);

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

    await order.update({ id_estado_pedido: nextStatus });
    res.json({
      message: "Estado del pedido actualizado",
      pedido: await loadPedidoPayload(order.id_pedido),
    });
  } catch (error) {
    res.status(500).json({ error: "Error actualizando pedido" });
  }
});

app.get("/api/admin/resenas", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (_req, res) => {
  try {
    const reviews = await Resena.findAll({
      include: [
        {
          model: Usuario,
          as: "Usuario",
          attributes: ["id_usuario", "nombre", "apellido", "email"],
        },
        {
          model: Producto,
          as: "Producto",
          attributes: ["id_producto", "titulo", "imagen_url"],
        },
      ],
      order: [
        ["estado", "ASC"],
        ["fecha_resena", "DESC"],
      ],
    });

    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo resenas" });
  }
});

app.patch("/api/admin/resenas/:idResena", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  const allowedStates = [REVIEW_STATUS_APPROVED, REVIEW_STATUS_REJECTED];
  const estado = req.body.estado;

  if (!allowedStates.includes(estado)) {
    return res.status(400).json({ error: "Estado de resena invalido" });
  }

  try {
    const review = await Resena.findByPk(req.params.idResena);
    if (!review) {
      return res.status(404).json({ error: "Resena no encontrada" });
    }

    await review.update({
      estado,
      id_moderador: req.user.id_usuario,
      fecha_moderacion: new Date(),
    });

    res.json({ message: `Resena marcada como ${estado}` });
  } catch (error) {
    res.status(500).json({ error: "Error moderando resena" });
  }
});

app.get("/api/usuarios", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (_req, res) => {
  try {
    const users = await Usuario.findAll({
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
      order: [["id_usuario", "ASC"]],
    });

    res.json(users.map(serializeUser));
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo usuarios" });
  }
});

app.get("/api/admin/usuarios", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  try {
    const isManager = Number(req.user.id_rol) === 3;
    const where = isManager ? { id_rol: 1 } : {};
    const users = await Usuario.findAll({
      where,
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
      order: [["id_usuario", "ASC"]],
    });

    res.json(users.map(serializeUser));
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo usuarios administrativos" });
  }
});

app.patch("/api/admin/usuarios/:idUsuario", authMiddleware, requireRoles(...STAFF_ROLE_IDS), async (req, res) => {
  try {
    const idUsuario = Number(req.params.idUsuario);
    const actorRole = Number(req.user.id_rol);
    const isManager = actorRole === 3;
    const target = await Usuario.findByPk(idUsuario, {
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (isManager && [2, 3].includes(Number(target.id_rol))) {
      return res.status(403).json({ error: "Los gerentes no pueden gestionar administradores ni gerentes" });
    }

    const updates = {};
    for (const field of ["nombre", "apellido", "telefono"]) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] ? String(req.body[field]).trim() : null;
      }
    }

    if (req.body.email !== undefined) {
      const normalizedEmail = String(req.body.email || "").trim().toLowerCase();
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
      const nextRole = Number(req.body.id_rol);
      if (!nextRole) {
        return res.status(400).json({ error: "Rol invalido" });
      }
      if (isManager && nextRole !== 1) {
        return res.status(403).json({ error: "Los gerentes solo pueden asignar rol de usuario" });
      }

      updates.id_rol = nextRole;
    }

    if (req.body.activo !== undefined) {
      const nextActive = Boolean(req.body.activo);
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
      include: [{ model: Rol, as: "Rol", attributes: ["id_rol", "nombre"] }],
    });

    res.json({
      message: "Usuario actualizado",
      user: serializeUser(refreshed),
    });
  } catch (error) {
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend activo en http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  sequelize,
};
