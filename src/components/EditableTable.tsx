import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import {
  DEPENDENCIA_OPTIONS,
  DEPENDENCIA_SET,
} from "../constants/dependencies";
import {
  MOTIVO_OPTIONS,
  MOTIVO_SET,
  findMotivoOption,
} from "../constants/motivos";
import { SearchableSelect } from "./SearchableSelect";

type EditableTableProps = {
  currentUser: {
    id: number;
    email: string;
    name: string;
    unidad: string | null;
  };
};

type ColumnKey =
  | "dependencia"
  | "identificacion"
  | "grado"
  | "nombresCompletos"
  | "motivo"
  | "detalle";

type ColumnConfig = {
  key: ColumnKey;
  label: string;
  placeholder: string;
  width?: string;
};

type TableRow = {
  id: string;
  persistedId?: number;
  dependencia: string;
  identificacion: string;
  grado: string;
  nombresCompletos: string;
  motivo: string;
  detalle: string;
};

type PersonalLookupData = {
  documento: string;
  grado: string;
  nombresCompletos: string;
};

type PersonalLookupEntry =
  | { status: "pending" }
  | { status: "not-found" }
  | { status: "found"; data: PersonalLookupData };

const GRADE_OPTIONS = [
  "SBTE",
  "TNTE",
  "CPTN",
  "MAYR",
  "TCNL",
  "CRNL",
  "GRAD",
  "GRAI",
  "GRAS",
  "POLI",
  "CBOS",
  "CBOP",
  "SGOS",
  "SGOP",
  "SBOS",
  "SBOP",
  "SBOM",
] as const;

const GRADE_SET = new Set<string>(GRADE_OPTIONS);

const normalizeIdentificacion = (value: string) => value.trim().toUpperCase();
const MIN_LOOKUP_LENGTH = 9;

type DuplicateMessage = {
  message: string;
  dependencia: string;
  source: "persisted" | "local";
  identificacion: string;
};

const buildDuplicateMessages = (rows: TableRow[]): Record<string, DuplicateMessage> => {
  const messages: Record<string, DuplicateMessage> = {};

  const persistedById = new Map<string, { dependencia: string }>();
  const seenUnsaved = new Map<string, TableRow>();

  rows.forEach((row) => {
    const normalizedId = normalizeIdentificacion(row.identificacion);

    if (!normalizedId) {
      return;
    }

    if (row.persistedId !== undefined) {
      if (!persistedById.has(normalizedId)) {
        persistedById.set(normalizedId, {
          dependencia: row.dependencia.trim(),
        });
      }
      return;
    }

    const persistedConflict = persistedById.get(normalizedId);

    if (persistedConflict) {
      const dependenciaName =
        persistedConflict.dependencia.length > 0
          ? persistedConflict.dependencia
          : "otra dependencia";

      messages[row.id] = {
        message: `Esta identificación ya está registrada en ${dependenciaName}.`,
        dependencia: dependenciaName,
        source: "persisted",
        identificacion: normalizedId,
      };
      return;
    }

    const existingUnsaved = seenUnsaved.get(normalizedId);

    if (existingUnsaved) {
      const dependencyCandidate =
        existingUnsaved.dependencia.trim() || row.dependencia.trim();

      const dependenciaName =
        dependencyCandidate.length > 0 ? dependencyCandidate : "otra fila";

      const message =
        dependenciaName === "otra fila"
          ? "Esta identificación ya está registrada en otra fila."
          : `Esta identificación ya está registrada en ${dependenciaName}.`;

      messages[row.id] = {
        message,
        dependencia: dependenciaName,
        source: "local",
        identificacion: normalizedId,
      };

      if (!messages[existingUnsaved.id]) {
        messages[existingUnsaved.id] = {
          message,
          dependencia: dependenciaName,
          source: "local",
          identificacion: normalizedId,
        };
      }
      return;
    }

    seenUnsaved.set(normalizedId, row);
  });

  return messages;
};

const columns: ColumnConfig[] = [
  {
    key: "identificacion",
    label: "Identificación",
    placeholder: "Documento",
    width: "14rem",
  },
  {
    key: "grado",
    label: "Grado",
    placeholder: "Grado",
    width: "12rem",
  },
  {
    key: "nombresCompletos",
    label: "Nombres completos",
    placeholder: "Nombre y apellidos",
    width: "50rem",
  },
  {
    key: "dependencia",
    label: "Dependencia",
    placeholder: "Dependencia",
    width: "18rem",
  },
  {
    key: "motivo",
    label: "Motivo",
    placeholder: "Motivo",
    width: "18rem",
  },
  {
    key: "detalle",
    label: "Detalle",
    placeholder: "Detalle adicional",
    width: "20rem",
  },
];

const REQUIRED_COLUMNS: ColumnKey[] = [
  "identificacion",
  "grado",
  "nombresCompletos",
  "dependencia",
  "motivo",
];

const createEmptyRow = (): TableRow => ({
  id: crypto.randomUUID(),
  persistedId: undefined,
  dependencia: "",
  identificacion: "",
  grado: "",
  nombresCompletos: "",
  motivo: "",
  detalle: "",
});

export function EditableTable({ currentUser }: EditableTableProps) {
  const tableId = useId();
  const [rows, setRows] = useState<TableRow[]>(() => [createEmptyRow()]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"success" | "error" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<number[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, ColumnKey[]>>({});
  const [personalCache, setPersonalCache] = useState<Record<string, PersonalLookupEntry>>({});
  const personalCacheRef = useRef(personalCache);
  const duplicateMessages = useMemo(
    () => buildDuplicateMessages(rows),
    [rows]
  );

  useEffect(() => {
    personalCacheRef.current = personalCache;
  }, [personalCache]);

  const fetchExistingRows = useCallback(async () => {
    const usuario = currentUser.email.trim();

    if (usuario.length === 0) {
      setRows([createEmptyRow()]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        usuario,
      });

      const response = await fetch(`/api/registros?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        registros: Array<Omit<TableRow, "id"> & { id: number }>;
      };

      const normalizedRows =
        payload?.registros?.map((registro) => {
          const rawDependencia = (registro.dependencia ?? "").trim().toUpperCase();
          const rawGrado = (registro.grado ?? "").trim().toUpperCase();
          const rawMotivo = (registro.motivo ?? "").trim();
          const normalizedMotivo = findMotivoOption(rawMotivo);

          return {
            id: String(registro.id),
            persistedId: registro.id,
            dependencia: DEPENDENCIA_SET.has(rawDependencia) ? rawDependencia : "",
            identificacion: (registro.identificacion ?? "").trim(),
            grado: GRADE_SET.has(rawGrado) ? rawGrado : "",
            nombresCompletos: (registro.nombresCompletos ?? "").trim(),
            motivo: normalizedMotivo ?? rawMotivo,
            detalle: (registro.detalle ?? "").trim(),
          };
        }) ?? [];

      const rowsWithEntry =
        normalizedRows.length > 0
          ? [...normalizedRows, createEmptyRow()]
          : [createEmptyRow()];

      setRows(rowsWithEntry);
    } catch (error) {
      console.error("No se pudieron cargar los registros:", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los registros existentes."
      );
      setRows([createEmptyRow()]);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.email]);

  useEffect(() => {
    void fetchExistingRows();
  }, [fetchExistingRows]);

  const requestPersonalData = useCallback(
    async (normalizedIdentificacion: string, options?: { force?: boolean }) => {
      const forceLookup = options?.force ?? false;
      const existingEntry = personalCacheRef.current[normalizedIdentificacion];

      if (existingEntry && !forceLookup) {
        return;
      }

      setPersonalCache((current) => ({
        ...current,
        [normalizedIdentificacion]: { status: "pending" },
      }));

    try {
      const requestUrl = `/api/personal/${encodeURIComponent(
        normalizedIdentificacion
      )}`;
      const response = await fetch(requestUrl);

      if (response.status === 404) {
        setPersonalCache((current) => ({
          ...current,
          [normalizedIdentificacion]: { status: "not-found" },
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        documento: string;
        siglas: string;
        nombresApellidos: string;
      };

      setPersonalCache((current) => ({
        ...current,
        [normalizedIdentificacion]: {
          status: "found",
          data: {
            documento: payload.documento.trim().toUpperCase(),
            grado: payload.siglas.trim().toUpperCase(),
            nombresCompletos: payload.nombresApellidos.trim(),
          },
        },
      }));
    } catch (error) {
      console.error("No se pudo obtener los datos del personal:", error);
      setPersonalCache((current) => {
        if (current[normalizedIdentificacion]?.status !== "pending") {
          return current;
        }
        const { [normalizedIdentificacion]: _pending, ...rest } = current;
        return rest;
      });
    }
    },
    [],
  );

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    const rowsToUpdate: Record<string, PersonalLookupData> = {};

    rows.forEach((row) => {
      if (row.persistedId !== undefined) {
        return;
      }

      const normalizedIdentificacion = normalizeIdentificacion(row.identificacion);
      if (!normalizedIdentificacion || normalizedIdentificacion.length < MIN_LOOKUP_LENGTH) {
        return;
      }

      const cacheEntry = personalCache[normalizedIdentificacion];

      if (!cacheEntry) {
        void requestPersonalData(normalizedIdentificacion);
        return;
      }

      if (cacheEntry.status === "pending") {
        return;
      }

      if (cacheEntry.status === "not-found") {
        if (row.grado.trim().length > 0 || row.nombresCompletos.trim().length > 0) {
          rowsToUpdate[row.id] = {
            documento: normalizedIdentificacion,
            grado: "",
            nombresCompletos: "",
          };
        }
        return;
      }

      if (cacheEntry.status === "found") {
        const needsGrado =
          row.grado.trim().length === 0 && GRADE_SET.has(cacheEntry.data.grado);
        const needsNombre =
          row.nombresCompletos.trim().length === 0 &&
          cacheEntry.data.nombresCompletos.length > 0;

        if (needsGrado || needsNombre) {
          rowsToUpdate[row.id] = cacheEntry.data;
        }
      }
    });

    const pendingRowIds = Object.keys(rowsToUpdate);
    if (pendingRowIds.length === 0) {
      return;
    }

    setRows((currentRows) => {
      let hasChanges = false;
      const updatedRows = currentRows.map((row) => {
        if (row.persistedId !== undefined) {
          return row;
        }

        const lookupData = rowsToUpdate[row.id];
        if (!lookupData) {
          return row;
        }

        const normalizedIdentificacion = normalizeIdentificacion(row.identificacion);
        if (!normalizedIdentificacion || normalizedIdentificacion !== lookupData.documento) {
          return row;
        }

        const shouldUpdateGrado =
          row.grado.trim().length === 0 && GRADE_SET.has(lookupData.grado);
        const shouldUpdateNombre =
          row.nombresCompletos.trim().length === 0 &&
          lookupData.nombresCompletos.length > 0;

        if (!shouldUpdateGrado && !shouldUpdateNombre) {
          return row;
        }

        hasChanges = true;

        return {
          ...row,
          grado: shouldUpdateGrado ? lookupData.grado : row.grado,
          nombresCompletos: shouldUpdateNombre
            ? lookupData.nombresCompletos
            : row.nombresCompletos,
        };
      });

      return hasChanges ? updatedRows : currentRows;
    });
  }, [rows, personalCache, requestPersonalData]);

  useEffect(() => {
    setValidationErrors((currentErrors) => {
      const errorEntries = Object.entries(currentErrors);
      if (errorEntries.length === 0) {
        return currentErrors;
      }

      let hasChanges = false;
      const nextErrors: Record<string, ColumnKey[]> = {};

      errorEntries.forEach(([rowId, missingColumns]) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === rowId && candidate.persistedId === undefined
        );

        if (!row) {
          hasChanges = true;
          return;
        }

        const stillMissing = missingColumns.filter((column) => {
          const value =
            column === "grado"
              ? row.grado.trim()
              : row[column].trim();

          if (value.length === 0) {
            return true;
          }

          if (column === "grado" && !GRADE_SET.has(value)) {
            return true;
          }

          return false;
        });

        if (stillMissing.length > 0) {
          nextErrors[rowId] = stillMissing;
        } else {
          hasChanges = true;
        }
      });

      if (!hasChanges && errorEntries.length === Object.keys(nextErrors).length) {
        return currentErrors;
      }

      return nextErrors;
    });
  }, [rows]);

  const handleAddRow = () => {
    setRows((current) => [...current, createEmptyRow()]);
  };

  const handleRemoveRow = (id: string) => {
    setRows((current) => {
      if (current.length === 1) {
        return current;
      }

      const filtered = current.filter(
        (row) => !(row.id === id && row.persistedId === undefined)
      );

      const hasEditableRow = filtered.some(
        (row) => row.persistedId === undefined
      );

      if (!hasEditableRow) {
        return [...filtered, createEmptyRow()];
      }

      return filtered;
    });
  };

  const handleCellChange = (id: string, key: ColumnKey, value: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id || row.persistedId !== undefined) {
          return row;
        }

        if (key === "grado") {
          const normalized = value.toUpperCase();
          const finalValue = GRADE_SET.has(normalized) ? normalized : "";
          return {
            ...row,
            grado: finalValue,
          };
        }

        if (key === "identificacion") {
          return {
            ...row,
            identificacion: value,
            grado: "",
            nombresCompletos: "",
          };
        }

        if (key === "dependencia") {
          const normalized = value.toUpperCase();
          const finalValue = DEPENDENCIA_SET.has(normalized) ? normalized : "";
          return {
            ...row,
            dependencia: finalValue,
          };
        }

        if (key === "motivo") {
          const selectedMotivo = findMotivoOption(value);
          return {
            ...row,
            motivo: selectedMotivo ?? "",
          };
        }

        return {
          ...row,
          [key]: value,
        };
      })
    );

    if (!REQUIRED_COLUMNS.includes(key)) {
      return;
    }

    const normalizedValue =
      key === "grado" || key === "dependencia"
        ? value.toUpperCase()
        : key === "motivo"
        ? findMotivoOption(value) ?? ""
        : value;
    const trimmedValue = normalizedValue.trim();
    let stillInvalid = trimmedValue.length === 0;

    if (!stillInvalid) {
      if (key === "grado" && !GRADE_SET.has(trimmedValue)) {
        stillInvalid = true;
      }
      if (key === "dependencia" && !DEPENDENCIA_SET.has(trimmedValue)) {
        stillInvalid = true;
      }
      if (key === "motivo" && !MOTIVO_SET.has(trimmedValue as typeof MOTIVO_OPTIONS[number])) {
        stillInvalid = true;
      }
    }

    setValidationErrors((currentErrors) => {
      const existingMissing = currentErrors[id] ?? [];

      if (stillInvalid) {
        if (existingMissing.includes(key)) {
          return currentErrors;
        }
        return {
          ...currentErrors,
          [id]: [...existingMissing, key],
        };
      }

      if (!existingMissing.includes(key)) {
        return currentErrors;
      }

      const filtered = existingMissing.filter((column) => column !== key);
      if (filtered.length === 0) {
        const { [id]: _removed, ...rest } = currentErrors;
        return rest;
      }

      return {
        ...currentErrors,
        [id]: filtered,
      };
    });
  };

  const handleDeletePersistedRow = async (row: TableRow) => {
    const persistedId = row.persistedId;

    if (persistedId === undefined) {
      return;
    }

    setDeletingIds((prev) =>
      prev.includes(persistedId) ? prev : [...prev, persistedId]
    );
    setSaveMessage(null);
    setSaveStatus(null);

    try {
      const params = new URLSearchParams({
        usuario: currentUser.email.trim(),
      });

      const response = await fetch(
        `/api/registros/${persistedId}?${params.toString()}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ??
            `Error HTTP ${response.status}`
        );
      }

      setSaveStatus("success");
      setSaveMessage("Registro eliminado correctamente.");
      await fetchExistingRows();
    } catch (error) {
      console.error("No se pudo eliminar el registro:", error);
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error
          ? `No se pudo eliminar el registro: ${error.message}`
          : "No se pudo eliminar el registro."
      );
    } finally {
      setDeletingIds((prev) =>
        prev.filter((idPersisted) => idPersisted !== persistedId)
      );
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
    }
  };

  const handleCellPaste = (
    event: ClipboardEvent<HTMLInputElement>,
    rowId: string,
    columnKey: ColumnKey
  ) => {
    const targetRow = rows.find((row) => row.id === rowId);
    if (targetRow?.persistedId !== undefined) {
      return;
    }

    const text = event.clipboardData.getData("text");

    if (!text) {
      return;
    }

    event.preventDefault();

    const startColumnIndex = columns.findIndex(
      (column) => column.key === columnKey
    );

    if (startColumnIndex === -1) {
      return;
    }

    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((line, index, array) => !(line === "" && index === array.length - 1));

    if (lines.length === 0) {
      return;
    }

    const parsedLines = lines.map((line) => line.split("\t"));

    setRows((current) => {
      const rowIndex = current.findIndex((row) => row.id === rowId);

      if (rowIndex === -1) {
        return current;
      }

      if (current[rowIndex]?.persistedId !== undefined) {
        return current;
      }

      const applyValues = (targetRow: TableRow, values: string[]) => {
        const nextRow = { ...targetRow };

        values.forEach((rawValue, valueIndex) => {
          const column = columns[startColumnIndex + valueIndex];
          if (!column) {
            return;
          }

          const normalizedValue = rawValue.trim();

          if (column.key === "grado") {
            const upper = normalizedValue.toUpperCase();
            nextRow.grado = GRADE_SET.has(upper) ? upper : "";
            return;
          }

          if (column.key === "dependencia") {
            const upper = normalizedValue.toUpperCase();
            nextRow.dependencia = DEPENDENCIA_SET.has(upper) ? upper : "";
            return;
          }

          if (column.key === "motivo") {
            const matched = findMotivoOption(normalizedValue);
            nextRow.motivo = matched ?? "";
            return;
          }

          nextRow[column.key] = normalizedValue;
        });

        return nextRow;
      };

      const nextRows = [...current];

      const [firstValues, ...otherValues] = parsedLines;
      nextRows[rowIndex] = applyValues(nextRows[rowIndex], firstValues);

      let insertIndex = rowIndex + 1;

      otherValues.forEach((values) => {
        if (!nextRows[insertIndex]) {
          nextRows.splice(insertIndex, 0, createEmptyRow());
        }

        nextRows[insertIndex] = applyValues(nextRows[insertIndex], values);
        insertIndex += 1;
      });

      return nextRows;
    });
  };

  const sanitizedRows = useMemo(() => {
    const cleaned = rows
      .filter((row) => row.persistedId === undefined)
      .map(({ id, persistedId: _persistedId, ...row }) => {
        const dependencia = row.dependencia.trim().toUpperCase();
        const grado = row.grado.trim().toUpperCase();

        return {
          dependencia: DEPENDENCIA_SET.has(dependencia) ? dependencia : "",
          identificacion: row.identificacion.trim(),
          grado: GRADE_SET.has(grado) ? grado : "",
          nombresCompletos: row.nombresCompletos.trim(),
          motivo: (findMotivoOption(row.motivo) ?? "").trim(),
          detalle: row.detalle.trim(),
        } satisfies Omit<TableRow, "id" | "persistedId">;
      });

    return cleaned.filter((row) =>
      REQUIRED_COLUMNS.some((key) => row[key].length > 0) ||
      row.detalle.length > 0
    );
  }, [rows]);

  const handleSaveAll = async () => {
    setSaveMessage(null);
    setSaveStatus(null);

    const usuarioActual = currentUser.email.trim();

    if (usuarioActual.length === 0) {
      setSaveStatus("error");
      setSaveMessage("No se pudo determinar el usuario actual.");
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
      return;
    }

    const editableRows = rows.filter((row) => row.persistedId === undefined);

    const duplicateConflicts = editableRows
      .map((row) => ({ row, info: duplicateMessages[row.id] }))
      .filter(
        (entry): entry is { row: TableRow; info: DuplicateMessage } =>
          entry.info !== undefined
      );

    if (duplicateConflicts.length > 0) {
      const { row: conflictingRow, info } = duplicateConflicts[0];
      const humanIdentificacion =
        conflictingRow.identificacion.trim() || info.identificacion;

      setSaveStatus("error");
      setSaveMessage(
        info.source === "persisted"
          ? `La identificación ${humanIdentificacion} ya está registrada en ${info.dependencia}.`
          : `La identificación ${humanIdentificacion} está duplicada en las filas capturadas.`
      );
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
      return;
    }

    const errors: Record<string, ColumnKey[]> = {};
    editableRows.forEach((row) => {
      const missing = REQUIRED_COLUMNS.filter(
        (key) => row[key].trim().length === 0
      );
      if (missing.length > 0) {
        errors[row.id] = missing;
      }
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      const totalInvalid = Object.keys(errors).length;
      const message =
        totalInvalid === 1
          ? "Completa los campos obligatorios en la fila resaltada."
          : `Completa los campos obligatorios en las ${totalInvalid} filas resaltadas.`;
      setSaveStatus("error");
      setSaveMessage(message);
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
      return;
    }

    if (sanitizedRows.length === 0) {
      setValidationErrors({});
      setSaveStatus("error");
      setSaveMessage("Agrega al menos un registro nuevo antes de guardar.");
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
      return;
    }

    setValidationErrors({});
    setIsSaving(true);

    try {
      const response = await fetch("/api/registros", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registros: sanitizedRows,
          usuario: usuarioActual,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ??
            `Error HTTP ${response.status}`
        );
      }

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        total?: number;
      };

      setSaveStatus("success");
      setSaveMessage(
        payload?.message ??
          `Registros guardados correctamente${
            typeof payload?.total === "number"
              ? ` (${payload.total} ${
                  payload.total === 1 ? "registro" : "registros"
                })`
              : ""
          }.`
      );
      await fetchExistingRows();
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error
          ? `No se pudieron guardar los registros: ${error.message}`
          : "No se pudieron guardar los registros."
      );
    } finally {
      setIsSaving(false);
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
    }
  };

  const handleDownloadPdf = async () => {
    const usuarioActual = currentUser.email.trim();
    if (usuarioActual.length === 0) {
      setSaveStatus("error");
      setSaveMessage("No se pudo determinar el usuario actual.");
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
      return;
    }

    try {
      const response = await fetch(
        `/api/registros/pdf?usuario=${encodeURIComponent(usuarioActual)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/pdf",
          },
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ??
            `Error HTTP ${response.status}`
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `registro-novedades-${usuarioActual}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("No se pudo descargar el PDF:", error);
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error
          ? `No se pudo descargar el PDF: ${error.message}`
          : "No se pudo descargar el PDF."
      );
      setTimeout(() => {
        setSaveMessage(null);
        setSaveStatus(null);
      }, 5000);
    }
  };

  return (
    <div className="sheet-container" aria-labelledby={`${tableId}-title`}>
      <div className="sheet-header">
        <h2 id={`${tableId}-title`}>Registro de novedades</h2>
        <div className="sheet-actions">
          <button type="button" className="secondary" onClick={handleDownloadPdf}>
            Descargar PDF
          </button>
          <button type="button" onClick={handleAddRow}>
            Añadir fila
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleSaveAll}
            disabled={isSaving || sanitizedRows.length === 0}
          >
            {isSaving ? "Guardando..." : "Guardar todo"}
          </button>
        </div>
      </div>

      {saveMessage && (
        <p
          className={`sheet-feedback ${
            saveStatus === "success" ? "success" : "error"
          }`}
        >
          {saveMessage}
        </p>
      )}

      <div className="sheet-table-wrapper" role="region" aria-live="polite">
        {isLoading ? (
          <div className="sheet-loader">Cargando registros...</div>
        ) : (
          <table className="sheet-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} style={{ width: column.width }}>
                    {column.label}
                  </th>
                ))}
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const persistedId = row.persistedId;
                const isPersisted = persistedId !== undefined;
                const isDeleting =
                  isPersisted && deletingIds.includes(persistedId);
                const missingColumns = validationErrors[row.id] ?? [];
                const duplicateInfo = duplicateMessages[row.id];
                const hasDuplicate = Boolean(duplicateInfo);
                const isInvalidRow = missingColumns.length > 0 || hasDuplicate;

                return (
                  <tr
                    key={row.id}
                    className={isInvalidRow ? "invalid-row" : undefined}
                  >
                    {columns.map((column) => {
                      const isCellInvalid = missingColumns.includes(column.key);
                      const isDuplicateCell =
                        column.key === "identificacion" && hasDuplicate;
                      const isGradeColumn = column.key === "grado";
                      const isNamesColumn = column.key === "nombresCompletos";
                      const isReadOnlyColumn = isGradeColumn || isNamesColumn;
                      const fieldClasses = [
                        isPersisted ? "persisted-input" : "",
                        isCellInvalid || isDuplicateCell ? "invalid-field" : "",
                        isNamesColumn ? "nombres-field" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined;

                      const shouldRenderSelect =
                        column.key === "grado" ||
                        column.key === "dependencia" ||
                        column.key === "motivo";

                      return (
                        <td key={column.key} data-column={column.label}>
                          {shouldRenderSelect ? (
                            (() => {
                              const baseOptions: readonly string[] =
                                column.key === "grado"
                                  ? GRADE_OPTIONS
                                  : column.key === "dependencia"
                                  ? DEPENDENCIA_OPTIONS
                                  : MOTIVO_OPTIONS;
                              const currentValue = row[column.key];
                              const optionsArray =
                                column.key === "motivo" &&
                                currentValue.trim().length > 0 &&
                                !baseOptions.includes(currentValue)
                                  ? [currentValue, ...baseOptions]
                                  : baseOptions;

                              const placeholderText =
                                column.key === "grado"
                                  ? "Selecciona un grado"
                                  : column.key === "dependencia"
                                  ? "Selecciona una dependencia"
                                  : "Selecciona un motivo";
                              const isSelectDisabled =
                                isPersisted || column.key === "grado";

                              return (
                                <SearchableSelect
                                  options={optionsArray}
                                  value={row[column.key]}
                                  placeholder={placeholderText}
                                  onChange={(nextValue) =>
                                    handleCellChange(row.id, column.key, nextValue)
                                  }
                                  ariaLabel={`${column.label} fila ${index + 1}`}
                                  disabled={isSelectDisabled}
                                  inputClassName={fieldClasses}
                                />
                              );
                            })()
                          ) : (
                            (() => {
                              if (column.key === "nombresCompletos") {
                                return (
                                  <textarea
                                    value={row.nombresCompletos}
                                    placeholder={column.placeholder}
                                    readOnly
                                    rows={2}
                                    aria-label={`${column.label} fila ${index + 1}`}
                                    className={`nombres-textarea ${fieldClasses ?? ""}`.trim()}
                                  />
                                );
                              }

                              const inputElement = (
                                <input
                                  type="text"
                                  value={row[column.key]}
                                  placeholder={column.placeholder}
                                  onChange={(event) =>
                                    handleCellChange(
                                      row.id,
                                      column.key,
                                      event.target.value
                                    )
                                  }
                                  aria-label={`${column.label} fila ${index + 1}`}
                                  onPaste={(event) =>
                                    handleCellPaste(event, row.id, column.key)
                                  }
                                  readOnly={isPersisted || isReadOnlyColumn}
                                  className={fieldClasses}
                                />
                              );

                              if (column.key !== "identificacion") {
                                return inputElement;
                              }

                              return inputElement;
                            })()
                          )}
                          {column.key === "identificacion" && duplicateInfo && (
                            <small className="cell-feedback error">
                              {duplicateInfo.message}
                            </small>
                          )}
                        </td>
                      );
                    })}
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="danger"
                        onClick={() =>
                          isPersisted
                            ? handleDeletePersistedRow(row)
                            : handleRemoveRow(row.id)
                        }
                        disabled={
                          isPersisted
                            ? isDeleting
                            : rows.length === 1
                        }
                        aria-label={`Eliminar fila ${index + 1}`}
                      >
                        {isPersisted
                          ? isDeleting
                            ? "Eliminando..."
                            : "Eliminar"
                          : "Quitar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="sheet-helper">
        Los registros guardados se muestran en modo lectura. Puedes eliminarlos con el botón correspondiente o añadir nuevas filas (o pegar desde Excel) para capturar información adicional.
      </p>
      {loadError && (
        <p className="sheet-feedback error">
          No se pudieron cargar los registros existentes: {loadError}
        </p>
      )}
    </div>
  );
}

