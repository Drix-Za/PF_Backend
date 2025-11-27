const request = require("supertest");

// Mock de Express para evitar que se levante el servidor real
jest.mock("express", () => {
  const actualExpress = jest.requireActual("express");
  const app = actualExpress();
  app.listen = jest.fn(() => app);

  // Devuelvo la app y conservo las funciones estáticas necesarias
  const expressMock = () => app;
  expressMock.json = actualExpress.json;
  expressMock.Router = actualExpress.Router;
  expressMock.static = actualExpress.static;

  return expressMock;
});

// Mock de Sequelize para simular la base de datos sin conectarme realmente
const mockAuthenticate = jest.fn();
const mockFindAll = jest.fn();
const mockCreate = jest.fn();
const mockDestroy = jest.fn();
const mockUpdate = jest.fn();

jest.mock("sequelize", () => {
  const actual = jest.requireActual("sequelize");
  return {
    ...actual,
    Sequelize: jest.fn().mockImplementation(() => ({
      authenticate: mockAuthenticate,
      define: jest.fn(() => ({
        findAll: mockFindAll,
        create: mockCreate,
        destroy: mockDestroy,
        update: mockUpdate,
      })),
    })),
    DataTypes: actual.DataTypes,
  };
});

const { sequelize, testConnection } = require("./server");
const express = require("express");
const app = express();

describe("testConnection()", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("debería mostrar mensaje de éxito si authenticate() funciona", async () => {
    mockAuthenticate.mockResolvedValueOnce();

    await testConnection();

    expect(mockAuthenticate).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      "Conectado correctamente a PostgreSQL (Sequelize)"
    );
  });

  test("debería mostrar mensaje de error si authenticate() falla", async () => {
    const error = new Error("falló la conexión");
    mockAuthenticate.mockRejectedValueOnce(error);

    await testConnection();

    expect(console.error).toHaveBeenCalledWith(
      "Error al conectar con PostgreSQL:",
      error.message
    );
  });
});

describe("Rutas de tareas (mockeadas)", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCreate.mockReset();
    mockDestroy.mockReset();
    mockUpdate.mockReset();
  });

  test("GET /api/tareas debería devolver la lista de tareas", async () => {
    const tareasMock = [
      { id: 1, texto: "Probar API", completada: false },
      { id: 2, texto: "Otra tarea", completada: true },
    ];
    mockFindAll.mockResolvedValueOnce(tareasMock);

    const response = await request(app).get("/api/tareas");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(tareasMock);
  });

  test("POST /api/tareas debería crear una nueva tarea válida", async () => {
    const nueva = { id: 3, texto: "Nueva tarea", completada: false };
    mockCreate.mockResolvedValueOnce(nueva);

    const response = await request(app)
      .post("/api/tareas")
      .send({ texto: "Nueva tarea" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(nueva);
  });

  test("POST /api/tareas debería devolver 400 si 'texto' está vacío", async () => {
    const response = await request(app).post("/api/tareas").send({ texto: "" });
    expect(response.status).toBe(400);
  });
});
