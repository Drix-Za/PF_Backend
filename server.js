// configuracion inicial
require("dotenv").config({ path: "backend/.env" });
const express = require("express");
const cors = require("cors"); 
const Sequelize = require("sequelize");
const { DataTypes } = require("sequelize");

const app = express();
const port = process.env.PORT || 3000;

// inicio configuracion sequelize
const baseOptions = {
    dialect: "postgres",
    logging: false,
    dialectOptions: {
        ssl:
            process.env.DB_SSL === "true"
                ? { require: true, rejectUnauthorized: false }
                : false,
    },
};

let sequelize;

if (process.env.DATABASE_URL) {
    console.log("detectada database_url. conectando con url completa.");
    sequelize = new Sequelize(process.env.DATABASE_URL, baseOptions);
} else {
    console.log("database_url no encontrada. conectando con variables separadas.");
    sequelize = new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            dialect: "postgres",
            logging: false,
            dialectOptions: { ssl: false },
        }
    );
}

// prueba de conexion db
async function testConnection() {
    try {
        await sequelize.authenticate();
        console.log("conectado correctamente a postgresql (sequelize)");
    } catch (error) {
        console.error("error al conectar con postgresql:", error.message);
    }
}
testConnection();
module.exports = { sequelize, testConnection };

// inicio definicion de modelos
const Rol = sequelize.define('Rol', {
    id_rol: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false, unique: true }
}, { tableName: 'rol', timestamps: false });

const TipoProducto = sequelize.define('TipoProducto', { 
    id_tipo_producto: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false, unique: true }
}, { tableName: 'tipoproducto', timestamps: false });

const Fabricante = sequelize.define('Fabricante', { 
    id_fabricante: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(100), allowNull: false, unique: true }
}, { tableName: 'fabricante', timestamps: false });

const EstadoPedido = sequelize.define('EstadoPedido', {
    id_estado_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false, unique: true }
}, { tableName: 'estadopedido', timestamps: false });

const MetodoPago = sequelize.define('MetodoPago', { 
    id_metodo_pago: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false, unique: true }
}, { tableName: 'metodopago', timestamps: false });

const Usuario = sequelize.define('Usuario', {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_rol: { type: DataTypes.INTEGER, allowNull: false, references: { model: Rol, key: 'id_rol' } },
    email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    contrasena_hash: { type: DataTypes.STRING(255), allowNull: false },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    apellido: { type: DataTypes.STRING(50), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'usuario', timestamps: false });

const Producto = sequelize.define('Producto', {
    id_producto: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_tipo_producto: { type: DataTypes.INTEGER, allowNull: false, references: { model: TipoProducto, key: 'id_tipo_producto' } },
    id_fabricante: { type: DataTypes.INTEGER, references: { model: Fabricante, key: 'id_fabricante' } },
    titulo: { type: DataTypes.STRING(200), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'producto', timestamps: false });

const Pedido = sequelize.define('Pedido', {
    id_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_cliente: { type: DataTypes.INTEGER, allowNull: false, references: { model: Usuario, key: 'id_usuario' } },
    id_estado_pedido: { type: DataTypes.INTEGER, allowNull: false, references: { model: EstadoPedido, key: 'id_estado_pedido' } },
    id_metodo_pago: { type: DataTypes.INTEGER, allowNull: false, references: { model: MetodoPago, key: 'id_metodo_pago' } },
    total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    fecha_pedido: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'pedido', timestamps: false });

const Resena = sequelize.define('Resena', {
    id_resena: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false, references: { model: Usuario, key: 'id_usuario' } },
    id_producto: { type: DataTypes.INTEGER, allowNull: false, references: { model: Producto, key: 'id_producto' } },
    puntuacion: { type: DataTypes.SMALLINT, allowNull: false, validate: { min: 1, max: 5 } },
    comentario: { type: DataTypes.TEXT },
}, { tableName: 'resena', timestamps: false });

// inicio middlewares
app.use(cors());
app.use(express.json());

// inicio rutas crud usuario
const API_BASE_USUARIOS = "/api/usuarios";

// get todos los usuarios
app.get(API_BASE_USUARIOS, async (req, res) => {
    try {
        const usuarios = await Usuario.findAll({
            attributes: ['id_usuario', 'id_rol', 'email', 'nombre', 'apellido', 'activo']
        });
        res.json(usuarios);
    } catch (err) {
        console.error("error al obtener usuarios:", err.message);
        res.status(500).json({ error: "error al obtener usuarios" });
    }
});

// post nuevo usuario
app.post(API_BASE_USUARIOS, async (req, res) => {
    const { id_rol, email, contrasena_hash, nombre, apellido } = req.body;

    if (!email || !contrasena_hash || !nombre || !apellido || !id_rol) {
        return res.status(400).json({ error: 'faltan campos obligatorios: email, contrasena_hash, nombre, apellido, id_rol.' });
    }

    try {
        const nuevo = await Usuario.create({
            id_rol,
            email: email.trim(),
            contrasena_hash,
            nombre: nombre.trim(),
            apellido: apellido.trim(),
        });
        res.status(201).json({
            id_usuario: nuevo.id_usuario,
            email: nuevo.email,
            nombre: nuevo.nombre,
            activo: nuevo.activo
        });
    } catch (err) {
        console.error("error al añadir usuario:", err.message);
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: "el email ya esta registrado." });
        }
        res.status(500).json({ error: "error al añadir usuario" });
    }
});

// delete usuario por id
app.delete(`${API_BASE_USUARIOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id de usuario no valido." });

    try {
        const eliminados = await Usuario.destroy({ where: { id_usuario: id } });
        if (!eliminados)
            return res.status(404).json({ error: "usuario no encontrado." });
        res.status(204).send();
    } catch (err) {
        console.error("error al eliminar usuario:", err.message);
        res.status(500).json({ error: "error al eliminar usuario" });
    }
});

// put (actualizar estado o datos) usuario por id
app.put(`${API_BASE_USUARIOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    const { activo } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: "id de usuario no valido." });
    if (typeof activo !== "boolean")
        return res.status(400).json({ error: '"activo" debe ser booleano.' });

    try {
        const [filas, [actualizado]] = await Usuario.update(
            { activo },
            { where: { id_usuario: id }, returning: true }
        );

        if (filas === 0)
            return res.status(404).json({ error: "usuario no encontrado." });

        res.json({
            id_usuario: actualizado.id_usuario,
            email: actualizado.email,
            nombre: actualizado.nombre,
            activo: actualizado.activo
        });
    } catch (err) {
        console.error("error al actualizar usuario:", err.message);
        res.status(500).json({ error: "error al actualizar usuario" });
    }
});

// inicio rutas crud producto
const API_BASE_PRODUCTOS = "/api/productos";

// get todos los productos
app.get(API_BASE_PRODUCTOS, async (req, res) => {
    try {
        const productos = await Producto.findAll();
        res.json(productos);
    } catch (err) {
        console.error("error al obtener productos:", err.message);
        res.status(500).json({ error: "error al obtener productos" });
    }
});

// post nuevo producto
app.post(API_BASE_PRODUCTOS, async (req, res) => {
    const { id_tipo_producto, id_fabricante, titulo } = req.body;

    if (!id_tipo_producto || !titulo) {
        return res.status(400).json({ error: 'faltan campos obligatorios: id_tipo_producto y titulo.' });
    }

    try {
        const nuevo = await Producto.create({
            id_tipo_producto,
            id_fabricante: id_fabricante || null,
            titulo: titulo.trim(),
            activo: true
        });
        res.status(201).json(nuevo);
    } catch (err) {
        console.error("error al añadir producto:", err.message);
        res.status(500).json({ error: "error al añadir producto" });
    }
});

// delete producto por id
app.delete(`${API_BASE_PRODUCTOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id de producto no valido." });

    try {
        const eliminados = await Producto.destroy({ where: { id_producto: id } });
        if (!eliminados)
            return res.status(404).json({ error: "producto no encontrado." });
        res.status(204).send();
    } catch (err) {
        console.error("error al eliminar producto:", err.message);
        res.status(500).json({ error: "error al eliminar producto" });
    }
});

// put (actualizar estado o titulo) producto por id
app.put(`${API_BASE_PRODUCTOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    const { activo, titulo } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: "id de producto no valido." });
    
    const camposActualizar = {};
    if (typeof activo === "boolean") camposActualizar.activo = activo;
    if (typeof titulo === "string" && titulo.trim().length > 0) camposActualizar.titulo = titulo.trim();

    if (Object.keys(camposActualizar).length === 0) {
        return res.status(400).json({ error: 'debe proporcionar al menos un campo valido para actualizar (activo o titulo).' });
    }

    try {
        const [filas, [actualizado]] = await Producto.update(
            camposActualizar,
            { where: { id_producto: id }, returning: true }
        );

        if (filas === 0)
            return res.status(404).json({ error: "producto no encontrado." });

        res.json(actualizado);
    } catch (err) {
        console.error("error al actualizar producto:", err.message);
        res.status(500).json({ error: "error al actualizar producto" });
    }
});

// inicio rutas crud pedido
const API_BASE_PEDIDOS = "/api/pedidos";

// get todos los pedidos
app.get(API_BASE_PEDIDOS, async (req, res) => {
    try {
        const pedidos = await Pedido.findAll();
        res.json(pedidos);
    } catch (err) {
        console.error("error al obtener pedidos:", err.message);
        res.status(500).json({ error: "error al obtener pedidos" });
    }
});

// post nuevo pedido
app.post(API_BASE_PEDIDOS, async (req, res) => {
    const { id_cliente, id_estado_pedido, id_metodo_pago, total } = req.body;

    if (!id_cliente || !id_estado_pedido || !id_metodo_pago || typeof total === 'undefined') {
        return res.status(400).json({ error: 'faltan campos obligatorios: id_cliente, id_estado_pedido, id_metodo_pago, total.' });
    }

    try {
        const nuevo = await Pedido.create({
            id_cliente,
            id_estado_pedido,
            id_metodo_pago,
            total,
            fecha_pedido: new Date(),
        });
        res.status(201).json(nuevo);
    } catch (err) {
        console.error("error al crear pedido:", err.message);
        res.status(500).json({ error: "error al crear pedido" });
    }
});

// delete pedido por id
app.delete(`${API_BASE_PEDIDOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id de pedido no valido." });

    try {
        const eliminados = await Pedido.destroy({ where: { id_pedido: id } });
        if (!eliminados)
            return res.status(404).json({ error: "pedido no encontrado." });
        res.status(204).send();
    } catch (err) {
        console.error("error al eliminar pedido:", err.message);
        res.status(500).json({ error: "error al eliminar pedido" });
    }
});

// put (actualizar estado) pedido por id
app.put(`${API_BASE_PEDIDOS}/:id`, async (req, res) => {
    const id = parseInt(req.params.id);
    const { id_estado_pedido } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: "id de pedido no valido." });
    if (typeof id_estado_pedido !== "number")
        return res.status(400).json({ error: '"id_estado_pedido" debe ser un numero entero.' });

    try {
        const [filas, [actualizado]] = await Pedido.update(
            { id_estado_pedido },
            { where: { id_pedido: id }, returning: true }
        );

        if (filas === 0)
            return res.status(404).json({ error: "pedido no encontrado." });

        res.json(actualizado);
    } catch (err) {
        console.error("error al actualizar pedido:", err.message);
        res.status(500).json({ error: "error al actualizar pedido" });
    }
});

// inicio escucha del puerto
app.listen(port, () => {
    console.log(`servidor backend corriendo en http://localhost:${port}`);
    console.log(`apis disponibles: ${API_BASE_USUARIOS}, ${API_BASE_PRODUCTOS}, ${API_BASE_PEDIDOS}`);
});