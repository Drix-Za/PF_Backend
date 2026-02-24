require("dotenv").config({ path: "backend/.env" });
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { Sequelize, DataTypes } = require("sequelize");

// Encriptación y tokens
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "clave_secreta_para_pruebas";

// Multer
const multer = require("multer");

const app = express();
const port = process.env.PORT;

// Sequelize
const baseOptions = {
    dialect: "postgres",
    logging: false,
    define: {
        freezeTableName: true,
        timestamps: false
    },
    dialectOptions: {
        ssl:
            process.env.DB_SSL === "true"
                ? { require: true, rejectUnauthorized: false }
                : false
    }
};

let sequelize;

if (process.env.DATABASE_URL) {
    sequelize = new Sequelize(process.env.DATABASE_URL, baseOptions);
} else {
    sequelize = new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            ...baseOptions
        }
    );
}

// Test conexión
(async () => {
    try {
        await sequelize.authenticate();
        console.log("Conectado a PostgreSQL");
    } catch (err) {
        console.error("Error de BD:", err.message);
    }
})();

// Modelos
const Rol = sequelize.define("Rol", {
    id_rol: { type: DataTypes.INTEGER, primaryKey: true },
    nombre: DataTypes.STRING
}, { tableName: "rol" });

const Usuario = sequelize.define("Usuario", {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true },
    id_rol: DataTypes.INTEGER,
    email: DataTypes.STRING,
    contrasena_hash: DataTypes.STRING,
    nombre: DataTypes.STRING,
    apellido: DataTypes.STRING,
    telefono: DataTypes.STRING,
    avatar_url: DataTypes.STRING,
    activo: DataTypes.BOOLEAN
}, { tableName: "usuario" });

const Producto = sequelize.define("Producto", {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true },
    id_tipo_producto: DataTypes.INTEGER,
    id_fabricante: DataTypes.INTEGER,
    titulo: DataTypes.STRING,
    activo: DataTypes.BOOLEAN
}, { tableName: "producto" });

const Pedido = sequelize.define("Pedido", {
    id_pedido: { type: DataTypes.INTEGER, primaryKey: true },
    id_cliente: DataTypes.INTEGER,
    id_estado_pedido: DataTypes.INTEGER,
    id_metodo_pago: DataTypes.INTEGER,
    total: DataTypes.DECIMAL,
    fecha_pedido: DataTypes.DATE
}, { tableName: "pedido" });

// Middlewares
app.use(cors());
app.use(express.json());

// Ubicación de las imágenes
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Autenticación tokens
const authMiddleware = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: "Token requerido" });

    const token = header.split(" ")[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Token inválido" });
    }
};

// Rol
const requireAdmin = async (req, res, next) => {
    try {
        // 1. Se busca el usuario al que pertenece el token
        const usuario = await Usuario.findByPk(req.user.id_usuario);
        
        if (!usuario) {
            return res.status(401).json({ error: "Usuario no encontrado" });
        }

        // 2. Verificación de rol por id: 
        // 3 = Administrador, 2 = Gerente de Operaciones
        if (usuario.id_rol === 3 || usuario.id_rol === 2) {
            return next(); // Tiene permiso, adelante.
        }

        // 3. Si es id_rol 1 (Cliente) u otro, bloqueamos
        return res.status(403).json({ error: "Acceso denegado: Se requieren permisos de administrador" });
    } catch (error) {
        console.error("Error en requireAdmin:", error);
        res.status(500).json({ error: "Error interno al validar permisos" });
    }
};

// Multer
const uploadDir = path.join(__dirname, "uploads/perfiles");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `user_${req.user.id_usuario}_${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

// Usuarios
app.get("/api/usuarios", authMiddleware, requireAdmin, async (req, res) => {
    const usuarios = await Usuario.findAll({
        attributes: ["id_usuario", "email", "nombre", "apellido", "activo", "id_rol", "avatar_url"]
    });
    res.json(usuarios);
});

app.get("/api/usuarios/:id", authMiddleware, requireAdmin, async (req, res) => {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(usuario);
});

// Login
app.post("/api/login", async (req, res) => {
    const { email, contrasena } = req.body;

    try {
        const usuario = await Usuario.findOne({ where: { email } });
        if (!usuario) return res.status(401).json({ error: "Credenciales inválidas" });

        const ok = await bcrypt.compare(contrasena, usuario.contrasena_hash);
        if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

        const token = jwt.sign(
            { id_usuario: usuario.id_usuario },
            JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({ token });
    } catch {
        res.status(500).json({ error: "Error en login" });
    }
});

// Perfil
app.put(
    "/api/perfil",
    authMiddleware,
    upload.single("avatar"),
    async (req, res) => {
        try {
            const { nombre, apellido, telefono } = req.body;

            const data = { nombre, apellido, telefono };
            if (req.file) {
                data.avatar_url = `/uploads/perfiles/${req.file.filename}`;
            }

            await Usuario.update(data, {
                where: { id_usuario: req.user.id_usuario }
            });

            const usuarioActualizado = await Usuario.findByPk(req.user.id_usuario, {
                attributes: ["id_usuario", "nombre", "apellido", "telefono", "avatar_url", "email", "id_rol"]
            });

            res.json(usuarioActualizado);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Error actualizando perfil" });
        }
    }
);

// Productos
app.get("/api/productos", async (_, res) => {
    res.json(await Producto.findAll());
});

app.get("/api/productos/:id", authMiddleware, requireAdmin, async (req, res) => {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(producto);
});

// Pedidos
app.get("/api/pedidos", authMiddleware, requireAdmin, async (_, res) => {
    res.json(await Pedido.findAll());
});

app.get("/api/pedidos/:id", authMiddleware, requireAdmin, async (req, res) => {
    const pedido = await Pedido.findByPk(req.params.id);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(pedido);
});

// Servidor
app.listen(port, () => {
    console.log(`Backend activo en http://localhost:${port}`);
    console.log(`Api de usuarios: http://localhost:${port}` + '/api/usuarios');
    console.log(`Api de productos: http://localhost:${port}` + '/api/productos');
    console.log(`Api de pedidos: http://localhost:${port}` + '/api/pedidos');
    console.log('Existen otras apis pero no todas pueden soportar GET.')
});
