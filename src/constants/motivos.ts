export const MOTIVO_OPTIONS = [
  "Otros",
  "Hospitalización",
  "Descanso Domiciliario",
  "Imputables a vacaciones",
  "Maternidad o Parto",
  "PATERNIDAD",
  "Licencias sin remuneración",
  "Liceacias con remuneración",
  "Por calamidad doméstica",
  "Aprehensión",
  "Ausencia injustificada por más de 3 días",
  "Detención",
  "Fallecido(a)",
  "Vacaciones",
  "Accidentes de Tránsito",
  
] as const;

export type MotivoOption = (typeof MOTIVO_OPTIONS)[number];

const MOTIVO_LOOKUP = new Map<string, MotivoOption>(
  MOTIVO_OPTIONS.map((option) => [option.trim().toUpperCase(), option])
);

export const MOTIVO_SET = new Set<MotivoOption>(MOTIVO_OPTIONS);

export const findMotivoOption = (value: string): MotivoOption | null => {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return MOTIVO_LOOKUP.get(normalized) ?? null;
};

