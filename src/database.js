
const mongoose = require("mongoose");



mongoose.connect("mongodb+srv://zerowaldo:coderhouse@waldo555.0pbi0ns.mongodb.net/?retryWrites=true&w=majority&appName=Waldo555")
    .then(() => console.log("Conexion exitosa"))
    .catch(() => console.log("Error en la conexion"))

