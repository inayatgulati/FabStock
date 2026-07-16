import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { cad, formatApiErrorDetail } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Plus, X, Trash2, Banknote } from "lucide-react";
import { toast } from "sonner";

const TAX_RATE = 0.13;

export default function Invoices() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState([{ _k: crypto.randomUUID(), product_id: "", qty: 1 }]);
  const [notes, setNotes] = useState("");
  const [showCash, setShowCash] = useState(false);
  const [cashMode, setCashMode] = useState("new"); // new | existing
  const [cashName, setCashName] = useState("");
  const [cashCustomerId, setCashCustomerId] = useState("");
  const [cashLines, setCashLines] = useState([{ _k: crypto.randomUUID(), product_id: "", qty: 1 }]);
  const [cashNote, setCashNote] = useState("");

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.get("/invoices")).data,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api.get("/customers")).data,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
  });

  const pmap = Object.fromEntries(products.map((p) => [p.id, p]));
  const subtotal = lines.reduce((s, l) => s + (pmap[l.product_id]?.price || 0) * Number(l.qty || 0), 0);
  const tax = subtotal * TAX_RATE;

  const create = useMutation({
    mutationFn: async () =>
      api.post("/invoices", {
        customer_id: customerId,
        items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: Number(l.qty) })),
        notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Invoice created — inventory updated");
      reset();
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const reset = () => {
    setShow(false);
    setCustomerId("");
    setLines([{ _k: crypto.randomUUID(), product_id: "", qty: 1 }]);
    setNotes("");
  };

  const cashSubtotal = cashLines.reduce((s, l) => s + (pmap[l.product_id]?.price || 0) * Number(l.qty || 0), 0);
  const createCash = useMutation({
    mutationFn: async () =>
      api.post("/cash-sales", {
        customer_id: cashMode === "existing" ? cashCustomerId : undefined,
        customer_name: cashMode === "new" ? cashName : undefined,
        items: cashLines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: Number(l.qty) })),
        note: cashNote,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Cash sale recorded — inventory updated");
      resetCash();
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const resetCash = () => {
    setShowCash(false);
    setCashMode("new");
    setCashName("");
    setCashCustomerId("");
    setCashLines([{ _k: crypto.randomUUID(), product_id: "", qty: 1 }]);
    setCashNote("");
  };

  const canSaveCash =
    ((cashMode === "new" && cashName.trim()) || (cashMode === "existing" && cashCustomerId)) &&
    cashLines.some((l) => l.product_id);

  const canSave = customerId && lines.some((l) => l.product_id);

  return (
    <div>
      <PageHeader eyebrow="Sales" title="Invoices">
        <button
          data-testid="record-cash-sale-button"
          onClick={() => setShowCash(true)}
          className="flex items-center gap-2 bg-zinc-800 text-zinc-100 text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-zinc-700 transition-colors duration-200"
        >
          <Banknote className="h-4 w-4" /> Record Cash Sale
        </button>
        <button
          data-testid="new-invoice-button"
          onClick={() => setShow(true)}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-orange-600 transition-colors duration-200"
        >
          <Plus className="h-4 w-4" /> New Invoice
        </button>
      </PageHeader>

      <div className="p-8 fade-up">
        <div className="bg-zinc-900 border border-zinc-800 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-eyebrow text-left border-b border-zinc-800">
                <th className="px-6 py-3 font-semibold">Invoice</th>
                <th className="px-6 py-3 font-semibold">Customer</th>
                <th className="px-6 py-3 font-semibold">Source</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold text-right">Items</th>
                <th className="px-6 py-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-zinc-500">No invoices yet.</td></tr>
              )}
              {invoices.map((inv, i) => (
                <tr key={inv.id} data-testid={`invoice-row-${i}`} className={`border-b border-zinc-800/40 ${i % 2 ? "bg-zinc-900/40" : ""}`}>
                  <td className="px-6 py-3 font-mono text-xs">{inv.invoice_number}</td>
                  <td className="px-6 py-3 font-medium">{inv.customer_name}</td>
                  <td className="px-6 py-3"><SourceBadge source={inv.source} /></td>
                  <td className="px-6 py-3 text-zinc-400">{inv.date}</td>
                  <td className="px-6 py-3 text-right text-zinc-400">{inv.items.length}</td>
                  <td className="px-6 py-3 text-right font-mono font-semibold text-emerald-500">{cad(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={reset}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm w-full max-w-2xl p-6 fade-up max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg tracking-tight">New Invoice</h3>
              <button onClick={reset} className="text-zinc-500 hover:text-zinc-50"><X className="h-5 w-5" /></button>
            </div>

            <label className="label-eyebrow block mb-1.5">Customer</label>
            <select
              data-testid="invoice-customer-select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-5 focus:ring-2 focus:ring-primary/50 focus:outline-none"
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.company ? `— ${c.company}` : ""}</option>
              ))}
            </select>

            <label className="label-eyebrow block mb-2">Line Items</label>
            <div className="space-y-2 mb-4">
              {lines.map((l, idx) => (
                <div key={l._k} className="flex gap-2 items-center">
                  <select
                    data-testid={`invoice-product-${idx}`}
                    value={l.product_id}
                    onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, product_id: e.target.value } : x)))}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({cad(p.price)}) · stock {p.stock_qty}</option>
                    ))}
                  </select>
                  <input
                    data-testid={`invoice-qty-${idx}`}
                    type="number"
                    min="1"
                    value={l.qty}
                    onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  />
                  <div className="w-24 text-right font-mono text-sm text-zinc-400">
                    {cad((pmap[l.product_id]?.price || 0) * Number(l.qty || 0))}
                  </div>
                  <button
                    data-testid={`remove-line-${idx}`}
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    className="text-zinc-600 hover:text-red-400 transition-colors duration-200"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              data-testid="add-line-button"
              onClick={() => setLines([...lines, { _k: crypto.randomUUID(), product_id: "", qty: 1 }])}
              className="text-xs text-zinc-400 hover:text-primary flex items-center gap-1 mb-6 transition-colors duration-200"
            >
              <Plus className="h-3 w-3" /> Add line
            </button>

            <div className="border-t border-zinc-800 pt-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="font-mono">{cad(subtotal)}</span></div>
              <div className="flex justify-between text-zinc-400"><span>HST (13%)</span><span className="font-mono">{cad(tax)}</span></div>
              <div className="flex justify-between font-semibold text-base"><span>Total</span><span className="font-mono text-emerald-500">{cad(subtotal + tax)}</span></div>
            </div>

            <button
              data-testid="save-invoice-button"
              disabled={!canSave || create.isPending}
              onClick={() => create.mutate()}
              className="w-full mt-6 bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200 disabled:opacity-50"
            >
              Create Invoice & Deduct Stock
            </button>
          </div>
        </div>
      )}

      {showCash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={resetCash}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm w-full max-w-2xl p-6 fade-up max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display font-bold text-lg tracking-tight flex items-center gap-2">
                <Banknote className="h-5 w-5 text-primary" /> Record Cash Sale
              </h3>
              <button onClick={resetCash} className="text-zinc-500 hover:text-zinc-50"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-xs text-zinc-500 mb-5">Off-books cash sale. Deducts inventory but is not sent to Zoho.</p>

            <div className="flex gap-2 mb-4">
              <button
                data-testid="cash-mode-new"
                onClick={() => setCashMode("new")}
                className={`flex-1 text-sm py-2 rounded-sm transition-colors duration-200 ${cashMode === "new" ? "bg-primary text-white" : "bg-zinc-950 border border-zinc-800 text-zinc-400"}`}
              >
                New Cash Buyer
              </button>
              <button
                data-testid="cash-mode-existing"
                onClick={() => setCashMode("existing")}
                className={`flex-1 text-sm py-2 rounded-sm transition-colors duration-200 ${cashMode === "existing" ? "bg-primary text-white" : "bg-zinc-950 border border-zinc-800 text-zinc-400"}`}
              >
                Existing Customer
              </button>
            </div>

            {cashMode === "new" ? (
              <input
                data-testid="cash-buyer-name"
                placeholder="Cash buyer name (e.g. Walk-in — Joe)"
                value={cashName}
                onChange={(e) => setCashName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-5 focus:ring-2 focus:ring-primary/50 focus:outline-none"
              />
            ) : (
              <select
                data-testid="cash-customer-select"
                value={cashCustomerId}
                onChange={(e) => setCashCustomerId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-5 focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} {c.company ? `— ${c.company}` : ""}</option>
                ))}
              </select>
            )}

            <label className="label-eyebrow block mb-2">Line Items</label>
            <div className="space-y-2 mb-4">
              {cashLines.map((l, idx) => (
                <div key={l._k} className="flex gap-2 items-center">
                  <select
                    data-testid={`cash-product-${idx}`}
                    value={l.product_id}
                    onChange={(e) => setCashLines(cashLines.map((x, i) => (i === idx ? { ...x, product_id: e.target.value } : x)))}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({cad(p.price)}) · stock {p.stock_qty}</option>
                    ))}
                  </select>
                  <input
                    data-testid={`cash-qty-${idx}`}
                    type="number"
                    min="1"
                    value={l.qty}
                    onChange={(e) => setCashLines(cashLines.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                    className="w-20 bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  />
                  <div className="w-24 text-right font-mono text-sm text-zinc-400">
                    {cad((pmap[l.product_id]?.price || 0) * Number(l.qty || 0))}
                  </div>
                  <button
                    onClick={() => setCashLines(cashLines.filter((_, i) => i !== idx))}
                    className="text-zinc-600 hover:text-red-400 transition-colors duration-200"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              data-testid="cash-add-line"
              onClick={() => setCashLines([...cashLines, { _k: crypto.randomUUID(), product_id: "", qty: 1 }])}
              className="text-xs text-zinc-400 hover:text-primary flex items-center gap-1 mb-4 transition-colors duration-200"
            >
              <Plus className="h-3 w-3" /> Add line
            </button>

            <input
              data-testid="cash-note"
              placeholder="Note (optional)"
              value={cashNote}
              onChange={(e) => setCashNote(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-5 focus:ring-2 focus:ring-primary/50 focus:outline-none"
            />

            <div className="border-t border-zinc-800 pt-4 flex justify-between font-semibold text-base">
              <span>Total (no tax)</span>
              <span className="font-mono text-emerald-500">{cad(cashSubtotal)}</span>
            </div>

            <button
              data-testid="save-cash-sale-button"
              disabled={!canSaveCash || createCash.isPending}
              onClick={() => createCash.mutate()}
              className="w-full mt-6 bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200 disabled:opacity-50"
            >
              Record Cash Sale & Deduct Stock
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SourceBadge = ({ source }) => {
  const map = {
    zoho: { label: "Zoho", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    cash: { label: "Cash", cls: "bg-primary/15 text-primary border-primary/30" },
    manual: { label: "Manual", cls: "bg-zinc-700/30 text-zinc-300 border-zinc-600/40" },
  };
  const s = map[source] || map.manual;
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border ${s.cls}`}>
      {s.label}
    </span>
  );
};
