import "dotenv/config";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import * as QRCode from "qrcode";

import { db } from "./db/client";
import { registros } from "./db/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WATERMARK_LOGO_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "logo.png"
);
let cachedWatermarkBuffer: Buffer | null = null;

const HEADER_IMAGE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "Cabecera.PNG"
);
let cachedHeaderBuffer: Buffer | null = null;

const DIST_PATH = resolve(__dirname, "..", "..", "dist");
const DIST_INDEX_HTML_PATH = resolve(DIST_PATH, "index.html");

async function getWatermarkBuffer() {
  if (cachedWatermarkBuffer) {
    return cachedWatermarkBuffer;
  }

  try {
    cachedWatermarkBuffer = await readFile(WATERMARK_LOGO_PATH);
    return cachedWatermarkBuffer;
  } catch (error) {
    console.error("No se pudo cargar el logo para la marca de agua:", error);
    return null;
  }
}

async function getHeaderBuffer() {
  if (cachedHeaderBuffer) {
    return cachedHeaderBuffer;
  }

  try {
    cachedHeaderBuffer = await readFile(HEADER_IMAGE_PATH);
    return cachedHeaderBuffer;
  } catch (error) {
    console.error("No se pudo cargar la cabecera:", error);
    return null;
  }
}

const PORT = Number(process.env.PORT ?? 4000);
const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registrosSchema = z.object({
  usuario: z.string().min(1),
  registros: z
    .array(
      z.object({
        dependencia: z.string().min(1),
        identificacion: z.string().min(1),
        grado: z.string().min(1),
        nombresCompletos: z.string().min(1),
        motivo: z.string().min(1),
        detalle: z.string().optional().default(""),
      })
    )
    .min(1),
});

app.post("/api/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos de entrada inválidos",
      errors: parsed.error.flatten(),
    });
  }

  const { email, password } = parsed.data;

  try {
    const foundUser = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.email, email),
    });

    if (!foundUser) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const isValid = await bcrypt.compare(password, foundUser.passwordHash);

    if (!isValid) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const sessionToken = randomUUID();

    return res.json({
      message: "Inicio de sesión exitoso",
      token: sessionToken,
      user: {
        id: foundUser.id,
        email: foundUser.email,
        name: foundUser.name,
      },
    });
  } catch (error) {
    console.error("Error interno durante el login:", error);
    return res
      .status(500)
      .json({ message: "Error interno del servidor. Revisa los logs." });
  }

});

app.post("/api/registros", async (req, res) => {
  const parsed = registrosSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos de entrada inválidos",
      errors: parsed.error.flatten(),
    });
  }

  const { registros: registrosEntrada, usuario } = parsed.data;
  const normalizedUsuario = usuario.trim();

  if (!normalizedUsuario) {
    return res.status(400).json({
      message: "El usuario es obligatorio.",
    });
  }

  try {
    const valores = registrosEntrada.map((registro) => ({
      dependencia: registro.dependencia.trim(),
      identificacion: registro.identificacion.trim(),
      grado: registro.grado.trim(),
      nombresCompletos: registro.nombresCompletos.trim(),
      motivo: registro.motivo.trim(),
      detalle: (registro.detalle ?? "").trim(),
      usuario: normalizedUsuario,
      creadoEn: new Date(),
    }));

    const seenIdentificaciones = new Map<
      string,
      { identificacion: string; dependencia: string }
    >();
    let payloadConflict:
      | { identificacion: string; dependencia: string }
      | null = null;

    for (const registro of valores) {
      const normalized = registro.identificacion.trim().toUpperCase();
      if (seenIdentificaciones.has(normalized)) {
        const first = seenIdentificaciones.get(normalized)!;
        payloadConflict = {
          identificacion: registro.identificacion,
          dependencia: first.dependencia,
        };
        break;
      }

      seenIdentificaciones.set(normalized, {
        identificacion: registro.identificacion,
        dependencia: registro.dependencia,
      });
    }

    if (payloadConflict) {
      return res.status(409).json({
        message: `La identificación ${payloadConflict.identificacion} ya fue ingresada en la dependencia ${payloadConflict.dependencia}.`,
        conflict: {
          identificacion: payloadConflict.identificacion,
          dependencia: payloadConflict.dependencia,
          source: "payload",
        },
      });
    }

    const uniqueIdentificaciones = Array.from(
      new Set(valores.map((registro) => registro.identificacion))
    );

    if (uniqueIdentificaciones.length > 0) {
      const existingConflicts = await db
        .select({
          identificacion: registros.identificacion,
          dependencia: registros.dependencia,
        })
        .from(registros)
        .where(inArray(registros.identificacion, uniqueIdentificaciones));

      if (existingConflicts.length > 0) {
        const conflict = existingConflicts[0];
        return res.status(409).json({
          message: `La identificación ${conflict.identificacion} ya está registrada en la dependencia ${conflict.dependencia}.`,
          conflict: {
            identificacion: conflict.identificacion,
            dependencia: conflict.dependencia,
            source: "database",
          },
        });
      }
    }

    const resultado = await db
      .insert(registros)
      .values(valores)
      .returning({ id: registros.id });

    return res.status(201).json({
      message: "Registros guardados correctamente.",
      total: resultado.length,
    });
  } catch (error) {
    console.error("Error al guardar registros:", error);
    return res.status(500).json({
      message: "Error interno al guardar los registros. Revisa los logs.",
    });
  }
});

app.get("/api/registros", async (req, res) => {
  const rawUsuario =
    typeof req.query.usuario === "string" ? req.query.usuario.trim() : "";

  if (!rawUsuario) {
    return res
      .status(400)
      .json({ message: "Debe especificar el usuario a consultar." });
  }

  try {
    const registrosExistentes = await db
      .select({
        id: registros.id,
        dependencia: registros.dependencia,
        identificacion: registros.identificacion,
        grado: registros.grado,
        nombresCompletos: registros.nombresCompletos,
        motivo: registros.motivo,
        detalle: registros.detalle,
        usuario: registros.usuario,
        creadoEn: registros.creadoEn,
      })
      .from(registros)
      .where(eq(registros.usuario, rawUsuario))
      .orderBy(registros.dependencia, desc(registros.creadoEn));

    return res.json({ registros: registrosExistentes });
  } catch (error) {
    console.error("Error al obtener registros:", error);
    return res
      .status(500)
      .json({ message: "Error interno al obtener los registros." });
  }
});

app.get("/api/registros/por-dependencia", async (_req, res) => {
  try {
    const resultados = await db
      .select({
        dependencia: registros.dependencia,
        total: sql<number>`count(${registros.id})`,
      })
      .from(registros)
      .groupBy(registros.dependencia)
      .orderBy(desc(sql<number>`count(${registros.id})`));

    return res.json({ dependencias: resultados });
  } catch (error) {
    console.error("Error al obtener agregados por dependencia:", error);
    return res.status(500).json({
      message: "Error interno al obtener los agregados.",
    });
  }
});

app.get("/api/registros/pdf", async (req, res) => {
  const rawUsuario =
    typeof req.query.usuario === "string" ? req.query.usuario.trim() : "";

  if (!rawUsuario) {
    return res
      .status(400)
      .json({ message: "Debe especificar el usuario a consultar." });
  }

  try {
    const registrosExistentes = await db
      .select({
        id: registros.id,
        dependencia: registros.dependencia,
        identificacion: registros.identificacion,
        grado: registros.grado,
        nombresCompletos: registros.nombresCompletos,
        motivo: registros.motivo,
        detalle: registros.detalle,
        usuario: registros.usuario,
        creadoEn: registros.creadoEn,
      })
      .from(registros)
      .where(eq(registros.usuario, rawUsuario))
      .orderBy(registros.dependencia, desc(registros.creadoEn));

    const [watermarkBuffer, headerBuffer] = await Promise.all([
      getWatermarkBuffer(),
      getHeaderBuffer(),
    ]);
    const generatedAt = new Date();
    const verificationCode = randomUUID();
    const qrPayload = JSON.stringify({
      usuario: rawUsuario,
      emitidoEn: generatedAt.toISOString(),
      totalRegistros: registrosExistentes.length,
      codigoVerificacion: verificationCode,
    });

    let qrBuffer: Buffer | null = null;
    try {
      qrBuffer = await QRCode.toBuffer(qrPayload, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 6,
      });
    } catch (error) {
      console.error("No se pudo generar el código QR:", error);
    }

    const safeUsuario = rawUsuario.replace(/[^a-zA-Z0-9_\-@.]+/g, "_");
    const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="registro-novedades-${safeUsuario}-${timestamp}.pdf"`
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true,
    });
    doc.pipe(res);

    const drawWatermark = () => {
      if (!watermarkBuffer) {
        return;
      }
      const { width, height } = doc.page;
      const watermarkWidth = width * 0.5;
      doc.save();
      doc.opacity(0.07);
      doc.rotate(-30, { origin: [width / 2, height / 2] });
      doc.image(
        watermarkBuffer,
        width / 2 - watermarkWidth / 2,
        height / 2 - watermarkWidth / 2,
        {
          width: watermarkWidth,
        }
      );
      doc.restore();
      doc.opacity(1);
    };

    if (watermarkBuffer) {
      drawWatermark();
      doc.on("pageAdded", drawWatermark);
    }

    const bodyWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    if (headerBuffer) {
      const availableWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const headerHeight = availableWidth * 0.18;
      doc.image(headerBuffer, doc.page.margins.left, doc.page.margins.top, {
        width: availableWidth,
        height: headerHeight,
      });
      doc.y = doc.page.margins.top + headerHeight + 16;
    } else {
      doc.y = doc.page.margins.top + 24;
    }

    doc
      .fontSize(20)
      .fillColor("#111827")
      .text("Personal que no laboró en el Referéndum y Consulta Popular 2025", {
        align: "center",
        width: bodyWidth,
      });
    doc.moveDown(0.5);

    doc
      .fontSize(12)
      .fillColor("#1f2937")
      .text(`Usuario: ${rawUsuario}`, { width: bodyWidth });
    doc.text(
      `Generado: ${generatedAt.toLocaleString("es-EC", {
        dateStyle: "full",
        timeStyle: "medium",
      })}`,
      { width: bodyWidth }
    );
    doc.text(`Código de verificación: ${verificationCode}`, {
      width: bodyWidth,
    });
    doc.moveDown(1.2);
    doc.moveDown(1);

    if (registrosExistentes.length === 0) {
      doc
        .fontSize(12)
        .fillColor("#475569")
        .text("No existen registros para mostrar.", { width: bodyWidth });
      doc.end();
      return;
    }

    const columnDefinitions = [
      {
        header: "Dependencia",
        ratio: 0.18,
        minWidth: 100,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.dependencia ?? "—",
      },
      {
        header: "Identificación",
        ratio: 0.12,
        minWidth: 85,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.identificacion ?? "—",
      },
      {
        header: "Grado",
        ratio: 0.07,
        minWidth: 55,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.grado ?? "—",
      },
      {
        header: "Nombres completos",
        ratio: 0.19,
        minWidth: 140,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.nombresCompletos ?? "—",
      },
      {
        header: "Motivo",
        ratio: 0.18,
        minWidth: 130,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.motivo ?? "—",
      },
      {
        header: "Detalle",
        ratio: 0.16,
        minWidth: 120,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.detalle && registro.detalle.trim().length > 0
            ? registro.detalle.trim()
            : "—",
      },
      {
        header: "Creado en",
        ratio: 0.10,
        minWidth: 95,
        accessor: (registro: typeof registrosExistentes[number]) =>
          registro.creadoEn
            ? new Date(registro.creadoEn).toLocaleString("es-EC", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "Sin fecha",
      },
    ];

    let remainingWidth = bodyWidth;
    const columns: Array<
      (typeof columnDefinitions)[number] & { width: number }
    > = [];

    columnDefinitions.forEach((column, index) => {
      let width =
        index === columnDefinitions.length - 1
          ? remainingWidth
          : Math.floor(bodyWidth * column.ratio);

      width = Math.max(width, column.minWidth);
      if (width > remainingWidth) {
        width = remainingWidth;
      }

      columns.push({ ...column, width });
      remainingWidth -= width;
    });

    if (remainingWidth > 0 && columns.length > 0) {
      columns[columns.length - 1] = {
        ...columns[columns.length - 1],
        width: columns[columns.length - 1].width + remainingWidth,
      };
      remainingWidth = 0;
    }

    const totalWidth = columns.reduce((acc, column) => acc + column.width, 0);
    const startX = doc.page.margins.left;
    const rowPadding = 8;
    doc.fontSize(10).fillColor("#1f2937").font("Helvetica");

    const drawTableHeader = () => {
      const headerHeight = 26;
      let currentX = startX;
      doc.save();
      doc.font("Helvetica-Bold").fillColor("#0f172a");
      const headerTop = doc.y;
      columns.forEach((column) => {
        doc.rect(currentX, headerTop, column.width, headerHeight).fill("#e2e8f0");
        doc.fillColor("#0f172a").text(column.header, currentX + 6, headerTop + (headerHeight - 12) / 2, {
          width: column.width - 12,
          align: "left",
        });
        doc.y = headerTop;
        currentX += column.width;
      });
      doc.restore();
      doc
        .moveTo(startX, headerTop + headerHeight)
        .lineTo(startX + totalWidth, headerTop + headerHeight)
        .strokeColor("#cbd5f5")
        .lineWidth(0.5)
        .stroke();
      doc.y = headerTop + headerHeight;
      doc.moveDown(0.1);
    };

    const ensureSpaceFor = (height: number) => {
      const availableBottom = doc.page.height - doc.page.margins.bottom;
      if (doc.y + height > availableBottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        if (watermarkBuffer) {
          drawWatermark();
        }
        drawTableHeader();
      }
    };

    drawTableHeader();

    registrosExistentes.forEach((registro, index) => {
      const cellTexts = columns.map((column) => column.accessor(registro));
      const cellHeights = cellTexts.map((text, columnIndex) =>
        doc.heightOfString(text ?? "—", {
          width: columns[columnIndex].width - 12,
          align: "left",
        })
      );
      const rowHeight = Math.max(...cellHeights, 0) + rowPadding * 2 + 6;

      ensureSpaceFor(rowHeight + (index === 0 ? 0 : 2));

      let currentX = startX;
      const rowTop = doc.y;
      columns.forEach((column, columnIndex) => {
        doc
          .rect(currentX, rowTop, column.width, rowHeight)
          .strokeColor("#cbd5f5")
          .lineWidth(0.5)
          .stroke();
        doc.fillColor("#1f2937").text(cellTexts[columnIndex] ?? "—", currentX + 6, rowTop + rowPadding, {
          width: column.width - 12,
          align: "left",
        });
        doc.y = rowTop;
        currentX += column.width;
      });

      doc.y = rowTop + rowHeight + 2;
    });

    if (qrBuffer) {
      const qrSize = 120;
      ensureSpaceFor(qrSize + 40);
      const qrX =
        doc.page.margins.left +
        (bodyWidth - qrSize) / 2;
      const qrY = doc.y;
      doc.image(qrBuffer, qrX, qrY, { width: qrSize });
      doc
        .fontSize(9)
        .fillColor("#475569")
        .text(
          `Código: ${verificationCode}`,
          doc.page.margins.left,
          qrY + qrSize + 6,
          {
            width: bodyWidth,
            align: "center",
          }
        );
    }

    doc.end();
  } catch (error) {
    console.error("Error al generar el PDF de registros:", error);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ message: "Error interno al generar el PDF." });
    }
    res.end();
  }
});

app.delete("/api/registros/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const rawUsuario =
    typeof req.query.usuario === "string" ? req.query.usuario.trim() : "";

  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "Identificador inválido." });
  }

  if (!rawUsuario) {
    return res
      .status(400)
      .json({ message: "Debe especificar el usuario para eliminar." });
  }

  try {
    const resultado = await db
      .delete(registros)
      .where(and(eq(registros.id, id), eq(registros.usuario, rawUsuario)))
      .returning({ id: registros.id });

    if (resultado.length === 0) {
      return res.status(404).json({ message: "Registro no encontrado." });
    }

    return res.json({ message: "Registro eliminado correctamente." });
  } catch (error) {
    console.error("Error al eliminar registro:", error);
    return res
      .status(500)
      .json({ message: "Error interno al eliminar el registro." });
  }
});

if (existsSync(DIST_INDEX_HTML_PATH)) {
  app.use(express.static(DIST_PATH));

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      return next();
    }

    res.sendFile(DIST_INDEX_HTML_PATH);
  });
} else {
  console.warn(
    `No se encontró el frontend compilado en ${DIST_INDEX_HTML_PATH}. Ejecuta "npm run build" antes de iniciar el servidor en producción.`
  );
}

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});

