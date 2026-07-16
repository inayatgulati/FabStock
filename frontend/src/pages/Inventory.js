import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { cad, formatApiErrorDetail } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", sku: "", category: "", unit: "each", price: 0, cost: 0, stock_qty: 0, low_stock_threshold: 10 };

export default function Inventory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showProduct, setShowProduct] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjust, setAdjust] = useState({ change: 0, reason: "Manual Sale", note: "" });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get("/products")).data,
  });

  const saveProduct = useMutation({
    mutationFn: async (p) => (editing ? api.put(`/products/${editing}`, p) : api.post("/products", p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "Product updated" : "Product added");
      closeProduct();
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const doAdjust = useMutation({
    mutationFn: async () =>
      api.post("/inventory/adjust", {
        product_id: adjustFor.id,
        change: Number(adjust.change),
        reason: adjust.reason,
        note: adjust.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Inventory adjusted");
      setAdjustFor(null);
      setAdjust({ change: 0, reason: "Manual Sale", note: "" });
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const closeProduct = () => {
    setShowProduct(false);
    setEditing(null);
    setForm(empty);
  };

  const openEdit = (p) => {
    setEditing(p.id);
    setForm({ ...empty, ...p });
    setShowProduct(true);
  };

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const field = (label, key, type = "text") => (
    <div>
      <label className="label-eyebrow block mb-1.5">{label}</label>
      <input
        data-testid={`product-field-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: type === "number" ? e.target.value : e.target.value })}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
      />
    </div>
  );

  return (
    <div>
      <PageHeader eyebrow="Stock Control" title="Inventory">
        <button
          data-testid="add-product-button"
          onClick={() => { setForm(empty); setEditing(null); setShowProduct(true); }}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-orange-600 transition-colors duration-200"
        >
          <Plus className="h-4 w-4" /> New Product
        </button>
      </PageHeader>

      <div className="p-8 fade-up">
        <div className="relative mb-5 max-w-md">
          <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            data-testid="inventory-search"
            placeholder="Search products or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-sm pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-eyebrow text-left border-b border-zinc-800">
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold text-right">Price</th>
                <th className="px-4 py-3 font-semibold text-right">In Stock</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">Loading…</td></tr>
              )}
              {filtered.map((p, i) => {
                const low = p.stock_qty <= p.low_stock_threshold;
                return (
                  <tr key={p.id} data-testid={`product-row-${i}`} className={`border-b border-zinc-800/50 ${i % 2 ? "bg-zinc-900/40" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="font-mono text-xs text-zinc-500">{p.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{p.category}</td>
                    <td className="px-4 py-3 text-right font-mono">{cad(p.price)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-semibold ${low ? "text-primary" : "text-zinc-100"}`}>
                        {p.stock_qty}
                      </span>
                      <span className="text-zinc-600 text-xs ml-1">{p.unit}</span>
                      {low && <div className="text-[10px] uppercase tracking-wider text-primary">Low</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        data-testid={`adjust-button-${i}`}
                        onClick={() => setAdjustFor(p)}
                        className="text-xs text-zinc-400 hover:text-primary px-2 py-1 inline-flex items-center gap-1 transition-colors duration-200"
                      >
                        <SlidersHorizontal className="h-3 w-3" /> Adjust
                      </button>
                      <button
                        data-testid={`edit-button-${i}`}
                        onClick={() => openEdit(p)}
                        className="text-xs text-zinc-400 hover:text-zinc-50 px-2 py-1 transition-colors duration-200"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showProduct && (
        <Modal title={editing ? "Edit Product" : "New Product"} onClose={closeProduct}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">{field("Name", "name")}</div>
            {field("SKU", "sku")}
            {field("Category", "category")}
            {field("Unit", "unit")}
            {field("Price (CAD)", "price", "number")}
            {field("Cost (CAD)", "cost", "number")}
            {field("Stock Qty", "stock_qty", "number")}
            {field("Low Stock Threshold", "low_stock_threshold", "number")}
          </div>
          <button
            data-testid="save-product-button"
            onClick={() =>
              saveProduct.mutate({
                ...form,
                price: Number(form.price),
                cost: Number(form.cost),
                stock_qty: Number(form.stock_qty),
                low_stock_threshold: Number(form.low_stock_threshold),
              })
            }
            className="w-full mt-6 bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200"
          >
            {editing ? "Save Changes" : "Add Product"}
          </button>
        </Modal>
      )}

      {adjustFor && (
        <Modal title={`Adjust — ${adjustFor.name}`} onClose={() => setAdjustFor(null)}>
          <p className="text-sm text-zinc-500 mb-4">
            Current stock: <span className="font-mono text-zinc-100">{adjustFor.stock_qty}</span>. Use negative
            numbers for sales/removals.
          </p>
          <label className="label-eyebrow block mb-1.5">Change (+/-)</label>
          <input
            data-testid="adjust-change"
            type="number"
            value={adjust.change}
            onChange={(e) => setAdjust({ ...adjust, change: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
          <label className="label-eyebrow block mb-1.5">Reason</label>
          <select
            data-testid="adjust-reason"
            value={adjust.reason}
            onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-primary/50 focus:outline-none"
          >
            <option>Manual Sale</option>
            <option>Stock Received</option>
            <option>Damage / Loss</option>
            <option>Correction</option>
          </select>
          <label className="label-eyebrow block mb-1.5">Note (optional)</label>
          <input
            data-testid="adjust-note"
            value={adjust.note}
            onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm mb-6 focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
          <button
            data-testid="save-adjust-button"
            onClick={() => doAdjust.mutate()}
            className="w-full bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200"
          >
            Apply Adjustment
          </button>
        </Modal>
      )}
    </div>
  );
}

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-sm w-full max-w-lg p-6 fade-up"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-display font-bold text-lg tracking-tight">{title}</h3>
        <button data-testid="modal-close" onClick={onClose} className="text-zinc-500 hover:text-zinc-50 transition-colors duration-200">
          <X className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  </div>
);
