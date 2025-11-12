import "dotenv/config";
import bcrypt from "bcryptjs";

import { db, pool } from "./client";
import { users } from "./schema";

const DEFAULT_EMAIL = process.env.SEED_USER_EMAIL ?? "admin@example.com";
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD ?? "changeme";
const DEFAULT_NAME = process.env.SEED_USER_NAME ?? "Administrador";
const DEFAULT_UNIDAD = process.env.SEED_USER_UNIDAD;

async function main() {
  const existing = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, DEFAULT_EMAIL),
  });

  if (existing) {
    console.log(
      `El usuario ${DEFAULT_EMAIL} ya existe, omitiendo creación de usuario de ejemplo.`
    );
    return;
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  await db.insert(users).values({
    email: DEFAULT_EMAIL,
    passwordHash,
    name: DEFAULT_NAME,
    unidad: DEFAULT_UNIDAD || null,
  });

  console.log(
    `Usuario de ejemplo creado: ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`
  );
}

main()
  .catch((error) => {
    console.error("Error al ejecutar la semilla:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error(
        "Error al cerrar la conexión con la base de datos:",
        error
      );
    }
  });

