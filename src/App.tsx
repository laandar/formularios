import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { EditableTable } from "./components/EditableTable";
import { DependencySummary } from "./components/DependencySummary";

type AuthUser = {
  id: number;
  email: string;
  name: string;
  unidad: string | null;
};

type AuthSession = {
  token: string;
  user: AuthUser;
};

const AUTHORIZED_EMAIL = "deinplaneamiento@gmail.com";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeView, setActiveView] = useState<"form" | "summary">("form");

  // Redirigir a "form" si el usuario no está autorizado y está en "summary"
  useEffect(() => {
    if (session && activeView === "summary") {
      if (session.user.email.toLowerCase() !== AUTHORIZED_EMAIL.toLowerCase()) {
        setActiveView("form");
      }
    }
  }, [session, activeView]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const rawBody = await response.text();
      let payload: unknown;

      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch (parseError) {
        console.error("No se pudo parsear la respuesta JSON:", parseError);
        payload = null;
      }

      if (!response.ok || !payload || typeof payload !== "object") {
        const errorPayload =
          payload && typeof payload === "object"
            ? payload
            : rawBody
            ? { rawBody }
            : null;

        const errorMessage =
          (errorPayload as { message?: string } | null)?.message ??
          `Error HTTP ${response.status} ${response.statusText}`;

        console.error("Error al iniciar sesión", {
          status: response.status,
          statusText: response.statusText,
          payload: errorPayload,
        });

        throw new Error(errorMessage);
      }

      const {
        token,
        user,
      } = payload as {
        token: string;
        user: AuthUser;
      };

      if (!token || !user) {
        throw new Error("La respuesta del servidor es incompleta.");
      }


      setSession({ token, user });
      setPassword("");
      setActiveView("form");
    } catch (err) {
      console.error("Fallo en el flujo de login:", err);
      setSession(null);
      setError(
        err instanceof Error
          ? err.message
          : `Error inesperado: ${JSON.stringify(err)}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    setPassword("");
    setActiveView("form");
  };

  return (
    <div className="app-container">
      {!session && <h1>Iniciar sesión</h1>}

      {session ? (
        <>
          <div className="session-card">
            <div className="session-header">
              <div>
                <p className="session-title">Hola, {session.user.name}</p>
                <p className="session-title">Dependencia: {session.user.unidad?.trim() || "No especificada"}</p>
                <p className="session-email">{session.user.email}</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={handleLogout}
              >
                Cerrar sesión
              </button>
            </div>
            <div className="session-tabs">
              <button
                type="button"
                className={`tab-button ${
                  activeView === "form" ? "active" : ""
                }`}
                onClick={() => setActiveView("form")}
              >
                Captura de novedades
              </button>
              {session.user.email.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase() && (
                <button
                  type="button"
                  className={`tab-button ${
                    activeView === "summary" ? "active" : ""
                  }`}
                  onClick={() => setActiveView("summary")}
                >
                  Resumen por dependencia
                </button>
              )}
            </div>
          </div>
          {activeView === "form" ? (
            <EditableTable currentUser={session.user} />
          ) : (
            <DependencySummary currentUser={session.user} />
          )}
        </>
      ) : (
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              minLength={5}
              required
            />
          </label>

          {error && <p className="error-message">{error}</p>}

          <button type="submit" disabled={isLoading}>
            {isLoading ? "Ingresando..." : "Entrar"}
          </button>
        </form>
      )}

      
    </div>
  );
}

export default App;
