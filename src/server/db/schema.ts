import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    unidad: varchar("unidad", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIndex: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const registros = pgTable("registros", {
  id: serial("id").primaryKey(),
  dependencia: varchar("dependencia", { length: 255 }).notNull(),
  identificacion: varchar("identificacion", { length: 150 }).notNull(),
  grado: varchar("grado", { length: 100 }).notNull(),
  nombresCompletos: varchar("nombres_completos", { length: 255 }).notNull(),
  motivo: varchar("motivo", { length: 255 }).notNull(),
  detalle: text("detalle").notNull(),
  usuario: varchar("usuario", { length: 150 }).notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Registro = typeof registros.$inferSelect;
export type NuevoRegistro = typeof registros.$inferInsert;

