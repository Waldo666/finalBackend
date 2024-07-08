const UserModel = require("../models/user.model.js");
const CartModel = require("../models/cart.model.js");
const jwt = require("jsonwebtoken");
const { createHash, isValidPassword } = require("../utils/hashbcryp.js");
const UserDTO = require("../dto/user.dto.js");
const { generateResetToken } = require("../utils/tokenreset.js");
const MailingRepository = require("../repositories/mail.repository.js");

// Repositorio de usuarios
const UserRepository = require("../repositories/user.repository.js");
const userRepository = new UserRepository();
const mailingRepository = new MailingRepository();

// Tercer Integradora: 
const EmailManager = require("../services/email.js");
const emailManager = new EmailManager();

class UserController {
    async register(req, res) {
        const { first_name, last_name, email, password, age } = req.body;
        try {
            const existeUsuario = await userRepository.findByEmail(email);
            if (existeUsuario) {
                return res.status(400).send("El usuario ya existe");
            }

            // Creo un nuevo carrito: 
            const nuevoCarrito = new CartModel();
            await nuevoCarrito.save();

            const nuevoUsuario = new UserModel({
                first_name,
                last_name,
                email,
                cart: nuevoCarrito._id,
                password: createHash(password),
                age
            });

            await userRepository.create(nuevoUsuario);

            const token = jwt.sign({ user: nuevoUsuario }, "coderhouse", {
                expiresIn: "1h"
            });

            res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true
            });

            res.redirect("/api/users/profile");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async login(req, res) {
        const { email, password } = req.body;
        try {
            const usuarioEncontrado = await userRepository.findByEmail(email);

            if (!usuarioEncontrado) {
                return res.status(401).send("Usuario no válido");
            }

            const esValido = isValidPassword(password, usuarioEncontrado);
            if (!esValido) {
                return res.status(401).send("Contraseña incorrecta");
            }

            const token = jwt.sign({ user: usuarioEncontrado }, "coderhouse", {
                expiresIn: "1h"
            });
            usuarioEncontrado.last_connection = new Date();
            await usuarioEncontrado.save();

            res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true
            });

            res.redirect("/api/users/profile");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async profile(req, res) {
        try {
            const isPremium = req.user.role === 'premium';
            const userDto = new UserDTO(req.user.first_name, req.user.last_name, req.user.role);
            const isAdmin = req.user.role === 'admin';

            res.render("profile", { user: userDto, isPremium, isAdmin });
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }

    async logout(req, res) {
        if (req.user) {
            try {
                req.user.last_connection = new Date();
                await req.user.save();
            } catch (error) {
                console.error(error);
                res.status(500).send("Error interno del servidor");
                return;
            }
        }

        res.clearCookie("coderCookieToken");
        res.redirect("/login");
    }

    async admin(req, res) {
        if (req.user.user.role !== "admin") {
            return res.status(403).send("Acceso denegado");
        }
        res.render("admin");
    }

    // Tercer integradora: 
    async requestPasswordReset(req, res) {
        const { email } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Generar un token 
            const token = generateResetToken();

            // Guardar el token en el usuario
            user.resetToken = {
                token: token,
                expiresAt: new Date(Date.now() + 3600000) // 1 hora de duración
            };
            await userRepository.save(user);

            // Enviar correo electrónico con el enlace de restablecimiento utilizando EmailService
            await emailManager.enviarCorreoRestablecimiento(email, user.first_name, token);

            res.redirect("/confirmacion-envio");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async resetPassword(req, res) {
        const { email, password, token } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.render("passwordcambio", { error: "Usuario no encontrado" });
            }

            // Obtener el token de restablecimiento de la contraseña del usuario
            const resetToken = user.resetToken;
            if (!resetToken || resetToken.token !== token) {
                return res.render("passwordreset", { error: "El token de restablecimiento de contraseña es inválido" });
            }

            // Verificar si el token ha expirado
            const now = new Date();
            if (now > resetToken.expiresAt) {
                // Redirigir a la página de generación de nuevo correo de restablecimiento
                return res.redirect("/passwordcambio");
            }

            // Verificar si la nueva contraseña es igual a la anterior
            if (isValidPassword(password, user)) {
                return res.render("passwordcambio", { error: "La nueva contraseña no puede ser igual a la anterior" });
            }

            // Actualizar la contraseña del usuario
            user.password = createHash(password);
            user.resetToken = undefined; // Marcar el token como utilizado
            await userRepository.save(user);

            // Renderizar la vista de confirmación de cambio de contraseña
            return res.redirect("/login");
        } catch (error) {
            console.error(error);
            return res.status(500).render("passwordreset", { error: "Error interno del servidor" });
        }
    }

    async cambiarRolPremium(req, res) {
        const { uid } = req.params;
        try {
            const user = await userRepository.findById(uid);

            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Verificamos si el usuario tiene la documentacion requerida: 
            const documentacionRequerida = ["Identificacion", "Comprobante de domicilio", "Comprobante de estado de cuenta"];

            const userDocuments = user.documents.map(doc => doc.name);

            const tieneDocumentacion = documentacionRequerida.every(doc => userDocuments.includes(doc));

            if (!tieneDocumentacion) {
                return res.status(400).send("El usuario tiene que completar toda la documentacion requerida o nunca sera premium");
            }

            const nuevoRol = user.role === "usuario" ? "premium" : "usuario";

            res.send(nuevoRol); 

        } catch (error) {
            res.status(500).send("Error del servidor, premium no funca");
        }
    }

        async getUsuarios(req, res) {
            //traer todos los usuarios pero solo mostrar los datos como nombre, correo y rol
            //primero traemos todos los usuarios
            const usuarios = await UserModel.find({ role: "usuario" });
            try {
            if (!usuarios) {
                console.log("no se pudo obtener usuarios");
            }
            console.log(usuarios);
            //no olvidarse de que ada listado de objetos que traigamos desde mongo se debes ahcer un map()
            const userss = usuarios.map((usuarios) => ({
                first_name: usuarios.first_name,
                last_name: usuarios.last_name,
                email: usuarios.email,
                role: usuarios.role,
            }));
        
            res.render("users", { users: userss });
            //una vez seteada la fecha voy a hacer un find con el parametro de busqueda de la fecha por que es estio? por que se genera la fecha actual de ahora mismo luego se le restan 30 minutos una vez echo esto, hacemos un $lt en elñ find que es un menor que y la fecha actual restada por 30 minutos
        
            //luego hacemos un await usuariosModel.deleeMany (let que tiene los usuarios que son 30 minutos a al fecha actual)
        
            //el problema aqui es de que manera activamos la funcion si ya esta iinactivo el usuario
            } catch (err) {
            console.log(err);
            res.status(500).send("hubo un error en traer usuarios");
            }
        }
        async deleteUserinactividad(req, res) {
            try {
            const fecha = new Date();
            console.log(fecha);
        
            const fechaRest = fecha.setMinutes(fecha.getMinutes() - 30);
            console.log(fechaRest);
        
            const fechaDos = new Date(fechaRest);
            console.log(fechaDos);
        
            const fechaSeteada = await UserModel.find({
                last_connection: { $lt: fechaDos },
            });
            console.log(
                "esto es la fecha seteada",
                fechaSeteada,
                "aqui termina la fecha seteada"
            );
            if (fechaSeteada.length === 0) {
                console.log("no hay usuarios para borrar, esto viene de console.log");
                return res.status(500).send("No hay usaurios para borrar lokoooooo");
            }
        
            const cleaner = await UserModel.deleteMany({
                last_connection: { $lt: fechaDos },
            });
            console.log(
                "aqui empieza el cleaner",
                cleaner,
                "aqui termina el cleaner"
            );
        
            //una vez seteada la fecha voy a hacer un find con el parametro de busqueda de la fecha por que es estio? por que se genera la fecha actual de ahora mismo luego se le restan 30 minutos una vez echo esto, hacemos un $lt en elñ find que es un menor que y la fecha actual restada por 30 minutos
        
            //luego hacemos un await usuariosModel.deleeMany (let que tiene los usuarios que son 30 minutos a al fecha actual)
        
            //el problema aqui es de que manera activamos la funcion si ya esta iinactivo el usuario
            res.status(200).json(fechaSeteada);
            } catch (error) {
            console.log(error);
            res.status(500).send("huo unn error al eliminar");
            }
        }
        
}

module.exports = UserController;