import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api, { cad } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { ArrowLeft, Sparkles, Loader2, TrendingUp, Clock, Repeat } from "lucide-react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { toast } from "sonner";

const tooltipStyle = { backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: 2, fontSize: 12 };
const fmtMonth = (m) => new Date(m + "-01").toLocaleDateString("en-CA", { month: "short" });

function renderInsights(text) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("### "))
      return <h4 key={i} className="font-display font-bold text-sm text-blue-400 tracking-tight mt-4 mb-2 first:mt-0">{line.replace("### ", "")}</h4>;
    if (line.trim().startsWith("- ") || line.trim().startsWith("* "))
      return <div key={i} className="flex gap-2 text-sm text-zinc-300 mb-1.5"><span className="text-blue-500">▸</span><span>{line.replace(/^[-*]\s/, "")}</span></div>;
    if (line.trim()) return <p key={i} className="text-sm text-zinc-300 mb-2">{line}</p>;
    return null;
  });
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [insights, setInsights] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await api.get(`/customers/${id}`)).data,
  });

  const runAI = async () => {
    setLoadingAI(true);
    try {
      const res = await api.get(`/insights/customer/${id}`);
      setInsights(res.data.insights);
    } catch (e) {
      toast.error("AI insight generation failed");
    }
    setLoadingAI(false);
  };

  if (isLoading || !data)
    return (
      <div>
        <PageHeader eyebrow="Account" title="Customer" />
        <div className="p-8"><div className="h-40 bg-zinc-900 border border-zinc-800 rounded-sm animate-pulse" /></div>
      </div>
    );

  const { customer, analytics, invoices } = data;

  return (
    <div>
      <PageHeader eyebrow={customer.company || "Account"} title={customer.name}>
        <button
          data-testid="run-ai-button"
          onClick={runAI}
          disabled={loadingAI}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-blue-500 transition-colors duration-200 disabled:opacity-60"
        >
          {loadingAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          AI Insights
        </button>
      </PageHeader>

      <div className="p-8 space-y-6 fade-up">
        <button data-testid="back-button" onClick={() => navigate("/customers")} className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-50 transition-colors duration-200">
          <ArrowLeft className="h-4 w-4" /> Back to customers
        </button>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <Metric icon={TrendingUp} label="Total Spent" value={cad(analytics.total_spent)} accent="text-emerald-500" testid="metric-total-spent" />
          <Metric icon={Repeat} label="Total Orders" value={analytics.order_count} testid="metric-orders" />
          <Metric icon={Clock} label="Avg Order Gap" value={analytics.order_frequency_days ? `${analytics.order_frequency_days} days` : "—"} testid="metric-frequency" />
          <Metric icon={TrendingUp} label="Avg / Month" value={cad(analytics.avg_monthly_sales)} accent="text-emerald-500" testid="metric-monthly" />
        </div>

        {insights && (
          <div data-testid="ai-insights-panel" className="bg-zinc-900 border border-blue-500/40 rounded-sm p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 h-full w-1 bg-gradient-to-b from-blue-500 to-blue-500/0" />
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-blue-400" />
              <h3 className="font-display font-bold text-sm tracking-tight">AI Sales Insights</h3>
            </div>
            <div>{renderInsights(insights)}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-6">
            <h3 className="font-display font-bold text-sm tracking-tight mb-6">Monthly Sales — 12 Months</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={analytics.monthly_sales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fmtMonth} stroke="#71717a" fontSize={10} />
                <YAxis stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => cad(v)} labelFormatter={fmtMonth} />
                <Bar dataKey="sales" fill="#10b981" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-6">
            <h3 className="font-display font-bold text-sm tracking-tight mb-3">Product Consumption & Reorder Timing</h3>
            <div className="overflow-auto max-h-[240px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="label-eyebrow text-left border-b border-zinc-800">
                    <th className="py-2 font-semibold">Product</th>
                    <th className="py-2 font-semibold text-right">Qty</th>
                    <th className="py-2 font-semibold text-right">Reorder Cycle</th>
                    <th className="py-2 font-semibold text-right">Next Due</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.products.map((p, i) => (
                    <tr key={p.product_id} data-testid={`consumption-row-${i}`} className="border-b border-zinc-800/40">
                      <td className="py-2 pr-2">{p.name}</td>
                      <td className="py-2 text-right font-mono">{p.total_qty}</td>
                      <td className="py-2 text-right font-mono text-zinc-400">{p.avg_days_between_orders ? `${p.avg_days_between_orders}d` : "—"}</td>
                      <td className="py-2 text-right font-mono text-primary">{p.predicted_next_order || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-sm">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h3 className="font-display font-bold text-sm tracking-tight">Order History</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="label-eyebrow text-left border-b border-zinc-800">
                <th className="px-6 py-3 font-semibold">Invoice</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold">Items</th>
                <th className="px-6 py-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id} className={`border-b border-zinc-800/40 ${i % 2 ? "bg-zinc-900/40" : ""}`}>
                  <td className="px-6 py-3 font-mono text-xs">{inv.invoice_number}</td>
                  <td className="px-6 py-3 text-zinc-400">{inv.date}</td>
                  <td className="px-6 py-3 text-zinc-400">{inv.items.length} line(s)</td>
                  <td className="px-6 py-3 text-right font-mono font-semibold">{cad(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const Metric = ({ icon: Icon, label, value, accent, testid }) => (
  <div data-testid={testid} className="bg-zinc-900 border border-zinc-800 rounded-sm p-5">
    <div className="flex items-center justify-between">
      <div className="label-eyebrow">{label}</div>
      <Icon className={`h-4 w-4 ${accent || "text-zinc-500"}`} />
    </div>
    <div className="font-display font-extrabold text-2xl tracking-tight mt-2">{value}</div>
  </div>
);
