import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/AuthContext";
import { AdminLayout } from "@/components/AdminLayout";
import { Home } from "@/pages/public/Home";
import { TournamentDetail } from "@/pages/public/TournamentDetail";
import { Login } from "@/pages/admin/Login";
import { Tournaments } from "@/pages/admin/Tournaments";
import { TournamentManage } from "@/pages/admin/TournamentManage";
import { CategoryManage } from "@/pages/admin/CategoryManage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  );
}
