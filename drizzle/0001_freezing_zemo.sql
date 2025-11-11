CREATE TABLE "registros" (
	"id" serial PRIMARY KEY NOT NULL,
	"dependencia" varchar(255) NOT NULL,
	"grado" varchar(100) NOT NULL,
	"nombres_completos" varchar(255) NOT NULL,
	"motivo" varchar(255) NOT NULL,
	"detalle" text NOT NULL,
	"usuario" varchar(150) NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
