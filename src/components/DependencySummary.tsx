import { useEffect, useMemo, useState, useCallback } from "react";
import { DEPENDENCIA_OPTIONS } from "../constants/dependencies";

export type DependencySummaryItem = {
  dependencia: string;
  total: number;
};

type AuthUser = {
  id: number;
  email: string;
  name: string;
  unidad: string | null;
};

type DependencySummaryProps = {
  currentUser: AuthUser;
};

// Función para normalizar texto eliminando tildes y convirtiendo a mayúsculas
const normalizeText = (text: string): string => {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
};

export function DependencySummary({ currentUser }: DependencySummaryProps) {
  const [items, setItems] = useState<DependencySummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/registros/por-dependencia", {
        headers: {
          "X-User-Email": currentUser.email,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ??
            `Error HTTP ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        dependencias: Array<{ dependencia: string; total: number }>;
      };

      const rawItems = Array.isArray(payload?.dependencias)
        ? payload.dependencias
        : [];

      const totalsByNormalizedName = new Map<string, number>();

      rawItems.forEach((item) => {
        const normalized = (item.dependencia ?? "").trim().toUpperCase();
        if (!normalized) {
          return;
        }

        const numericTotal = Number(item.total ?? 0);
        if (!Number.isFinite(numericTotal)) {
          return;
        }

        totalsByNormalizedName.set(normalized, numericTotal);
      });

      const canonicalItems = DEPENDENCIA_OPTIONS.map((dependencia) => {
        const normalized = dependencia.trim().toUpperCase();
        return {
          dependencia,
          total: totalsByNormalizedName.get(normalized) ?? 0,
        };
      });

      const knownDependencias = new Set(
        DEPENDENCIA_OPTIONS.map((dependencia) => dependencia.trim().toUpperCase())
      );

      const additionalItems = rawItems
        .filter((item) => {
          const normalized = (item.dependencia ?? "").trim().toUpperCase();
          return normalized.length > 0 && !knownDependencias.has(normalized);
        })
        .map((item) => ({
          dependencia: item.dependencia,
          total: Number(item.total ?? 0) || 0,
        }));

      const mergedItems = [...canonicalItems, ...additionalItems].sort((a, b) => {
        const totalDiff = Number(b.total ?? 0) - Number(a.total ?? 0);
        if (totalDiff !== 0) {
          return totalDiff;
        }
        return a.dependencia.localeCompare(b.dependencia, "es");
      });

      setItems(mergedItems);
      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el resumen."
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.email]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalRegistros = useMemo(
    () => items.reduce((acc, item) => acc + Number(item.total ?? 0), 0),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) {
      return items;
    }
    const normalizedSearch = normalizeText(searchTerm.trim());
    return items.filter((item) =>
      normalizeText(item.dependencia).includes(normalizedSearch)
    );
  }, [items, searchTerm]);

  return (
    <div className="summary-container">
      <div className="summary-header">
        <div>
          <h2>Registros por dependencia</h2>
          <p>
            {isLoading
              ? "Obteniendo datos..."
              : error
              ? ""
              : `Total de registros: ${totalRegistros.toLocaleString("es-EC", {
                  maximumFractionDigits: 0,
                })}`}
          </p>
          {lastUpdated && !isLoading && !error && (
            <p className="summary-updated">
              Última actualización: {lastUpdated.toLocaleString("es-EC")}
            </p>
          )}
        </div>
        <button type="button" className="secondary" onClick={loadData}>
          Recargar
        </button>
      </div>

      {error ? (
        <div className="summary-error">
          <p>{error}</p>
          <button type="button" onClick={loadData}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {!isLoading && items.length > 0 && (
            <div className="summary-search">
              <input
                type="text"
                placeholder="Buscar dependencia..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="summary-search-input"
              />
            </div>
          )}
          <div className="summary-table-wrapper">
            {isLoading ? (
              <div className="summary-loader">Cargando resumen...</div>
            ) : items.length === 0 ? (
              <p className="summary-empty">
                No hay registros para mostrar.
              </p>
            ) : filteredItems.length === 0 ? (
              <p className="summary-empty">
                No se encontraron dependencias que coincidan con la búsqueda.
              </p>
            ) : (
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Dependencia</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const hasZeroRecords = Number(item.total ?? 0) === 0;
                    return (
                      <tr
                        key={item.dependencia}
                        className={hasZeroRecords ? "summary-row-zero" : ""}
                      >
                        <td>{item.dependencia}</td>
                        <td className="summary-total">
                          {Number(item.total ?? 0).toLocaleString("es-EC", {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
