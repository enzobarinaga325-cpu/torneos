import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Lock, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button, Card, Input, Label } from "@/components/ui";

export function Login() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/admin" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError("Email o contraseña incorrectos");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-5">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-center gap-2 text-emerald-700">
          <Lock className="h-5 w-5" />
          <h1 className="text-xl font-semibold">PANEL ORGANIZADOR</h1>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <Label>Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Contraseña</Label>
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading} className="mt-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
}
