import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, Users, FileText, LogOut, Boxes, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/zoho", label: "Zoho Sync", icon: RefreshCw },
];

export const Layout = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-background grain">
      <aside className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col fixed h-screen z-20">
        <div className="px-6 py-6 border-b border-zinc-800 flex items-center gap-3">
          <div className="h-9 w-9 bg-primary flex items-center justify-center rounded-sm">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-display font-extrabold text-sm tracking-tight leading-none">FABSTOCK</div>
            <div className="label-eyebrow mt-1">Supply OS</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-6 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={`nav-${n.label.toLowerCase()}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-900 border-l-2 border-transparent"
                }`
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-zinc-800">
          <div className="text-sm font-medium text-zinc-100 truncate">{user?.name}</div>
          <div className="text-xs text-zinc-500 truncate mb-3">{user?.email}</div>
          <button
            data-testid="logout-button"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex items-center gap-2 text-xs text-zinc-400 hover:text-primary transition-colors duration-200"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 ml-64 min-h-screen relative z-10">{children}</main>
    </div>
  );
};
