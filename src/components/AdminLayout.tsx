import { Navigate, Outlet, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Spinner } from "./ui";

export function AdminLayout() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  // Navegar primero (afuera de /admin) y recién después cerrar sesión evita que el guard
  // de abajo ("!session -> /admin/login") gane la carrera y deje al usuario en el login.
  function logout() {
    navigate("/");
    signOut();
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!session) return <Navigate to="/admin/login" replace />;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="font-semibold text-zinc-900">
            Panel de torneos
          </Link>
          <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-900">
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
