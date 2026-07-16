import { useQuery } from "@tanstack/react-query";
import api, { cad } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Package, Users, FileText, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid,
} from "recharts";

const Stat = ({ icon: Icon, label, value, accent, testid }) => (
  <div data-testid={testid} className="bg-zinc-900 border border-zinc-800 rounded-sm p-5 hover:-translate-y-1 transition-transform duration-200">
    <div className="flex items-center justify-between">
      <div className="label-eyebrow">{label}</div>
      <Icon className={`h-4 w-4 ${accent || "text-zinc-500"}`} />
    </div>
    <div className="font-display font-extrabold text-3xl tracking-tight mt-3">{value}</div>
  </div>
);

const tooltipStyle = { backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 2, fontSize: 12 };
const fmtMonth = (m) => new Date(m + "-01").toLocaleDateString("en-CA", { month: "short" });

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/stats")).data,
  });

  if (isLoading || !data)
    return (
      <div>
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <div className="p-8 grid grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-zinc-900 border border-zinc-800 rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader eyebrow="Overview" title="Dashboard">
        <div className="text-xs text-zinc-500 font-mono">
          Updated {new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </PageHeader>

      <div className="p-8 space-y-6 fade-up">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Stat testid="stat-month-revenue" icon={DollarSign} label="Revenue (This Month)" value={cad(data.month_revenue)} accent="text-emerald-500" />
          <Stat testid="stat-inventory-value" icon={Package} label="Inventory Value" value={cad(data.inventory_value)} />
          <Stat testid="stat-customers" icon={Users} label="Customers" value={data.customers_count} />
          <Stat testid="stat-lowstock" icon={AlertTriangle} label="Low Stock Items" value={data.low_stock_count} accent="text-primary" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-sm p-6">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <h3 className="font-display font-bold text-sm tracking-tight">Revenue — Last 6 Months</h3>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.revenue_chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fmtMonth} stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => cad(v)} labelFormatter={fmtMonth} />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} dot={{ fill: "#10b981", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-6">
            <h3 className="font-display font-bold text-sm tracking-tight mb-6">Top Products</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.top_products} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} stroke="#71717a" fontSize={10} tickFormatter={(v) => (v.length > 18 ? v.slice(0, 18) + "…" : v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => cad(v)} />
                <Bar dataKey="revenue" fill="#f97316" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-sm">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-zinc-800">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <h3 className="font-display font-bold text-sm tracking-tight">Low Stock Alerts</h3>
          </div>
          {data.low_stock_items.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-zinc-500">All stock levels healthy.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="label-eyebrow text-left border-b border-zinc-800">
                  <th className="px-6 py-3 font-semibold">Product</th>
                  <th className="px-6 py-3 font-semibold">SKU</th>
                  <th className="px-6 py-3 font-semibold text-right">In Stock</th>
                  <th className="px-6 py-3 font-semibold text-right">Threshold</th>
                </tr>
              </thead>
              <tbody>
                {data.low_stock_items.map((p, i) => (
                  <tr key={p.id} data-testid={`lowstock-row-${i}`} className={i % 2 ? "bg-zinc-900/50" : ""}>
                    <td className="px-6 py-3 font-medium">{p.name}</td>
                    <td className="px-6 py-3 font-mono text-zinc-500 text-xs">{p.sku}</td>
                    <td className="px-6 py-3 text-right font-mono text-primary font-semibold">{p.stock_qty}</td>
                    <td className="px-6 py-3 text-right font-mono text-zinc-500">{p.low_stock_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
