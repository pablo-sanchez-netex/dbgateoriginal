db = db.getSiblingDB('testdb');

// Crear colección de usuarios
db.createCollection('usuarios');
db.usuarios.insertMany([
    {
        nombre: "Admin",
        email: "admin@example.com",
        roles: ["admin"],
        fechaRegistro: new Date()
    },
    {
        nombre: "Usuario",
        email: "usuario@example.com",
        roles: ["user"],
        fechaRegistro: new Date()
    }
]);

// Crear colección de productos
db.createCollection('productos');
db.productos.insertMany([
    {
        nombre: "Producto A",
        precio: 99.99,
        categoria: "electronica",
        stock: 25
    },
    {
        nombre: "Producto B",
        precio: 49.99,
        categoria: "hogar",
        stock: 40
    }
]);

// Crear índices
db.usuarios.createIndex({ email: 1 }, { unique: true });
db.productos.createIndex({ nombre: 1 });
