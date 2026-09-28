import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/AuthContext";
import { AdminLayout } from "@/components/AdminLayout";
import { Spinner } from "@/components/ui";

// Cada página en su propio chunk: alguien que solo mira un torneo público nunca debería
// bajar el código del panel de admin (y viceversa) — antes viajaba todo junto en un solo
// archivo de ~800KB sin importar qué página se estuviera visitando.
const Home = lazy(() => import("@/pages/public/Home").then((m) => ({ default: m.Home })));
const TournamentDetail = lazy(() => import("@/pages/public/TournamentDetail").then((m) => ({ default: m.TournamentDetail })));
const Login = lazy(() => import("@/pages/admin/Login").then((m) => ({ default: m.Login })));
const Tournaments = lazy(() => import("@/pages/admin/Tournaments").then((m) => ({ default: m.Tournaments })));
const TournamentManage = lazy(() => import("@/pages/admin/TournamentManage").then((m) => ({ default: m.TournamentManage })));
const CategoryManage = lazy(() => import("@/pages/admin/CategoryManage").then((m) => ({ default: m.CategoryManage })));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/torneo/:slug" element={<TournamentDetail />} />
            <Route path="/admin/login" element={<Login />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Tournaments />} />
              <Route path="torneos/:id" element={<TournamentManage />} />
              <Route path="torneos/:id/categorias/:categoryId" element={<CategoryManage />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
