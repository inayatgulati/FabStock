import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { cad, formatApiErrorDetail } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Plus, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";

export default function Customers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", address: "" });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api.get("/customers")).data,
  });

  const create = useMutation({
    mutationFn: async () => api.post("/customers", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer added");
      setShow(false);
      setForm({ name: "", company: "", email: "", phone: "", address: "" });
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  return (
    <div>
      <PageHeader eyebrow="Accounts" title="Customers">
        <button
          data-testid="add-customer-button"
          onClick={() => setShow(true)}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-orange-600 transition-colors duration-200"
        >
          <Plus className="h-4 w-4" /> New Customer
        </button>
      </PageHeader>

      <div className="p-8 fade-up">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading && [...Array(3)].map((_, i) => <div key={i} className="h-40 bg-zinc-900 border border-zinc-800 rounded-sm animate-pulse" />)}
          {customers.map((c, i) => (
            <button
              key={c.id}
              data-testid={`customer-card-${i}`}
              onClick={() => navigate(`/customers/${c.id}`)}
              className="text-left bg-zinc-900 border border-zinc-800 rounded-sm p-5 hover:-translate-y-1 hover:border-primary/50 transition-all duration-200 group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display font-bold text-base tracking-tight">{c.name}</div>
                  <div className="text-xs text-zinc-500">{c.company}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-primary transition-colors duration-200" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-zinc-800">
                <div>
                  <div className="label-eyebrow">Total Spent</div>
                  <div className="font-mono font-semibold text-emerald-500 mt-1">{cad(c.total_spent)}</div>
                </div>
                <div>
                  <div className="label-eyebrow">Orders</div>
                  <div className="font-mono font-semibold mt-1">{c.order_count}</div>
                </div>
              </div>
              <div className="text-xs text-zinc-600 mt-3">Last order: {c.last_order || "—"}</div>
            </button>
          ))}
        </div>
      </div>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShow(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm w-full max-w-lg p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg tracking-tight">New Customer</h3>
              <button onClick={() => setShow(false)} className="text-zinc-500 hover:text-zinc-50"><X className="h-5 w-5" /></button>
            </div>
            {[
              ["Name", "name"], ["Company", "company"], ["Email", "email"], ["Phone", "phone"], ["Address", "address"],
            ].map(([label, key]) => (
              <div key={key} className="mb-4">
                <label className="label-eyebrow block mb-1.5">{label}</label>
                <input
                  data-testid={`customer-field-${key}`}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                />
              </div>
            ))}
            <button
              data-testid="save-customer-button"
              onClick={() => create.mutate()}
              className="w-full mt-2 bg-primary text-white font-semibold text-sm py-3 rounded-sm hover:bg-orange-600 transition-colors duration-200"
            >
              Add Customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
