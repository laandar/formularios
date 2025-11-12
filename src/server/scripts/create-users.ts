import "dotenv/config";
import bcrypt from "bcryptjs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { db, pool } from "../db/client";
import { users } from "../db/schema";

/**
 * Script para crear múltiples usuarios con la misma clave temporal
 * 
 * Uso:
 * 1. Crea un archivo emails.txt con formato: correo,nombre,unidad (uno por línea)
 *    Ejemplo:
 *    usuario1@ejemplo.com,Juan Pérez,Unidad Operativa
 *    usuario2@ejemplo.com,Maria García,Unidad de Planificación
 *    usuario3@ejemplo.com,,Unidad Administrativa  (si no especificas nombre, se genera automáticamente)
 *    usuario4@ejemplo.com  (si no especificas nombre ni unidad, se generarán automáticamente)
 * 
 * 2. Ejecuta: npm run create-users
 * 
 * O configura las variables de entorno:
 * - TEMP_PASSWORD: la clave temporal a usar (por defecto: "TempPass123!")
 * - EMAILS_FILE: ruta al archivo con correos (por defecto: "./emails.txt")
 * - DEFAULT_UNIDAD: unidad por defecto si no se especifica (por defecto: vacío)
 */

const TEMP_PASSWORD = process.env.TEMP_PASSWORD ?? "TempPass123!";
const EMAILS_FILE = process.env.EMAILS_FILE ?? resolve(process.cwd(), "emails.txt");
const OUTPUT_FILE = process.env.OUTPUT_FILE ?? resolve(process.cwd(), "usuarios-creados.csv");
const DEFAULT_UNIDAD = process.env.DEFAULT_UNIDAD ?? "";

interface UserData {
  email: string;
  name: string;
  unidad?: string;
}

async function readUsersFromFile(filePath: string): Promise<UserData[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const users: UserData[] = [];

    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        // Verificar si la línea contiene un correo
        if (!line.includes("@")) {
          return; // Saltar líneas sin correo
        }

        // Intentar dividir por coma
        const parts = line.split(",").map((p) => p.trim());
        const email = parts[0].toLowerCase();

        // Validar que sea un correo válido
        if (!email.includes("@") || email.length < 5) {
          return;
        }

        // Si hay segunda parte, es el nombre; si no, se generará automáticamente
        const name = parts.length > 1 && parts[1].length > 0 
          ? parts[1] 
          : generateUserName(email);

        // Si hay tercera parte, es la unidad; si no, se usará la unidad por defecto
        const unidad = parts.length > 2 && parts[2].length > 0
          ? parts[2]
          : DEFAULT_UNIDAD || undefined;

        users.push({ email, name, unidad });
      });

    if (users.length === 0) {
      throw new Error("No se encontraron correos válidos en el archivo");
    }

    return users;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No se encontró el archivo ${filePath}. Por favor, crea un archivo con formato: correo,nombre (uno por línea).`
      );
    }
    throw error;
  }
}

function generateUserName(email: string): string {
  const localPart = email.split("@")[0];
  const capitalized = localPart
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return capitalized || email;
}

async function main() {
  console.log("🚀 Iniciando creación de usuarios...");
  console.log(`📧 Archivo de usuarios: ${EMAILS_FILE}`);
  console.log(`🔑 Clave temporal: ${TEMP_PASSWORD}`);
  console.log("");

  // Leer usuarios del archivo
  let usersData: UserData[];
  try {
    usersData = await readUsersFromFile(EMAILS_FILE);
    console.log(`✅ Se encontraron ${usersData.length} usuarios en el archivo`);
  } catch (error) {
    console.error("❌ Error al leer el archivo:", error);
    process.exitCode = 1;
    return;
  }

  // Verificar correos duplicados en el archivo
  const emailMap = new Map<string, UserData>();
  const duplicates: string[] = [];

  usersData.forEach((user) => {
    if (emailMap.has(user.email)) {
      duplicates.push(user.email);
      // Mantener el primero encontrado
    } else {
      emailMap.set(user.email, user);
    }
  });

  if (duplicates.length > 0) {
    console.warn(
      `⚠️  Se encontraron ${duplicates.length} correos duplicados en el archivo. Se usarán únicamente los primeros.`
    );
  }

  const uniqueUsers = Array.from(emailMap.values());

  // Hashear la contraseña una sola vez
  console.log("🔐 Hasheando contraseña...");
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);

  // Verificar usuarios existentes
  console.log("🔍 Verificando usuarios existentes en la base de datos...");
  const existingUsers = await db.query.users.findMany({
    where: (table, { inArray }) => inArray(table.email, uniqueUsers.map((u) => u.email)),
  });

  const existingEmails = new Set(existingUsers.map((u) => u.email));
  const newUsers = uniqueUsers.filter((user) => !existingEmails.has(user.email));

  if (existingEmails.size > 0) {
    console.log(
      `⚠️  ${existingEmails.size} usuarios ya existen en la base de datos y serán omitidos.`
    );
  }

  if (newUsers.length === 0) {
    console.log("ℹ️  No hay usuarios nuevos para crear.");
    await pool.end();
    return;
  }

  console.log(`📝 Se crearán ${newUsers.length} nuevos usuarios...`);
  console.log("");

  // Preparar datos de usuarios
  const usersToInsert = newUsers.map((user) => ({
    email: user.email,
    passwordHash,
    name: user.name,
    unidad: user.unidad || null,
  }));

  // Insertar usuarios en lotes para mejor rendimiento
  const BATCH_SIZE = 50;
  const results: Array<{ email: string; name: string; unidad?: string; password: string }> = [];

  for (let i = 0; i < usersToInsert.length; i += BATCH_SIZE) {
    const batch = usersToInsert.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(usersToInsert.length / BATCH_SIZE);

    try {
      await db.insert(users).values(batch);
      console.log(
        `✅ Lote ${batchNumber}/${totalBatches}: ${batch.length} usuarios creados`
      );

      // Agregar a resultados para el CSV
      batch.forEach((user) => {
        results.push({
          email: user.email,
          name: user.name,
          unidad: user.unidad || undefined,
          password: TEMP_PASSWORD,
        });
      });
    } catch (error) {
      console.error(
        `❌ Error al crear el lote ${batchNumber}:`,
        error
      );
      // Continuar con el siguiente lote
    }
  }

  // Generar archivo CSV con las credenciales
  console.log("");
  console.log("📄 Generando archivo CSV con credenciales...");
  const csvHeader = "Email,Nombre,Unidad,Contraseña Temporal\n";
  const csvRows = results
    .map((r) => `"${r.email}","${r.name}","${r.unidad || ""}","${r.password}"`)
    .join("\n");
  const csvContent = csvHeader + csvRows;

  try {
    await writeFile(OUTPUT_FILE, csvContent, "utf-8");
    console.log(`✅ Archivo CSV guardado en: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error("❌ Error al guardar el archivo CSV:", error);
  }

  console.log("");
  console.log("✨ Proceso completado!");
  console.log(`📊 Resumen:`);
  console.log(`   - Total de usuarios en archivo: ${usersData.length}`);
  console.log(`   - Usuarios únicos: ${uniqueUsers.length}`);
  console.log(`   - Usuarios ya existentes: ${existingEmails.size}`);
  console.log(`   - Usuarios nuevos creados: ${results.length}`);
  console.log(`   - Clave temporal usada: ${TEMP_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("❌ Error fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error("Error al cerrar la conexión con la base de datos:", error);
    }
  });

