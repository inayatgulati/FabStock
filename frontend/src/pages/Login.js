import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Boxes, Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) navigate("/");
    else setError(res.error);
  };

  return (
    <div className="min-h-screen flex bg-background grain">
      <div className="hidden lg:block lg:w-1/2 relative">
        <img
          src="https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400"
          alt="Fabrication welding"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
        <div className="absolute bottom-0 p-12 z-10">
          <div className="label-eyebrow text-primary">Inventory & Customer Intelligence</div>
          <h2 className="font-display font-extrabold text-4xl tracking-tight mt-3 max-w-md leading-tight">
            Track stock. Understand buying patterns. Upsell smarter.
          </h2>
          <p className="text-zinc-400 mt-4 max-w-md text-sm">
            Built for Canadian fabrication tools & materials suppliers.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 relative z-10">
        <form onSubmit={submit} className="w-full max-w-sm fade-up">
          <div className="flex items-center gap-3 mb-10">
            <div className="h-11 w-11 bg-primary flex items-center justify-center rounded-sm">
              <Boxes className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="font-display font-extrabold text-lg tracking-tight leading-none">FABSTOCK</div>
              <div className="label-eyebrow mt-1">Supply OS</div>
            </div>
          </div>

          <h1 className="font-display font-extrabold text-2xl tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-500 mt-1 mb-8">Access your inventory dashboard.</p>

          <label className="label-eyebrow block mb-2">Email</label>
          <input
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-sm px-4 py-3 text-sm mb-5 focus:ring-2 focus:ring-primary/50 focus:border-primary focus:outline-none transition-colors duration-200"
            required
          />

          <label className="label-eyebrow block mb-2">Password</label>
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-sm px-4 py-3 text-sm mb-6 focus:ring-2 focus:ring-primary/50 focus:border-primary focus:outline-none transition-colors duration-200"
            required
          />

          {error && (
            <div data-testid="login-error" className="text-sm text-red-400 mb-4 border border-red-900/50 bg-red-950/30 px-3 py-2 rounded-sm">
              {error}
            </div>
          )}

          <button
            data-testid="login-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
