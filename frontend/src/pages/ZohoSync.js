import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { RefreshCw, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function ZohoSync() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["zoho-status"],
    queryFn: async () => (await api.get("/zoho/status")).data,
    refetchInterval: 30000,
  });

  const sync = useMutation({
    mutationFn: async () => (await api.post("/zoho/sync")).data,
    onMutate: () => setSyncing(true),
    onSettled: () => setSyncing(false),
    onSuccess: (d) => {
      qc.invalidateQueries();
      toast.success(`Synced — ${d.invoices_new} new invoice(s), ${d.customers} customers, ${d.items} items`);
    },
    onError: (e) => toast.error(e.response?.data?.detail || "Sync failed"),
  });

  const configured = status?.configured;

  return (
    <div>
      <PageHeader eyebrow="Integration" title="Zoho Books Sync">
        <button
          data-testid="zoho-sync-now"
          disabled={!configured || syncing}
          onClick={() => sync.mutate()}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-sm hover:bg-orange-600 transition-colors duration-200 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync Now
        </button>
      </PageHeader>

      <div className="p-8 max-w-4xl fade-up space-y-6">
        {isLoading ? (
          <div className="h-32 bg-zinc-900 border border-zinc-800 rounded-sm animate-pulse" />
        ) : (
          <div data-testid="zoho-status-card" className="bg-zinc-900 border border-zinc-800 rounded-sm p-6">
            <div className="flex items-center gap-3">
              {configured ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              ) : (
                <XCircle className="h-6 w-6 text-primary" />
              )}
              <div>
                <div className="font-display font-bold text-lg tracking-tight">
                  {configured ? "Connected" : "Not Connected"}
                </div>
                <div className="text-sm text-zinc-500">
                  {configured
                    ? "Auto-syncing every 5 minutes. Invoices from Zoho update inventory & analytics automatically."
                    : "Add your OAuth credentials to the backend to activate sync."}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-zinc-800">
              <Info label="Organization ID" value={status?.org_id || "—"} />
              <Info label="Region" value={(status?.region || "").includes(".ca") ? "Canada (.ca)" : status?.region || "—"} />
              <Info label="Baseline Import" value={status?.baseline_done ? "Done" : "Pending"} />
              <Info label="Zoho Invoices" value={status?.zoho_invoice_count ?? 0} />
            </div>
            {status?.last_sync && (
              <div className="text-xs text-zinc-600 mt-4 font-mono">
                Last sync: {new Date(status.last_sync).toLocaleString("en-CA")}
              </div>
            )}
          </div>
        )}

        {!configured && (
          <div className="bg-zinc-900 border border-blue-500/40 rounded-sm p-6">
            <h3 className="font-display font-bold text-sm tracking-tight mb-4 text-blue-400">
              How to connect (one-time, ~5 minutes)
            </h3>
            <ol className="space-y-3 text-sm text-zinc-300 list-decimal pl-5">
              <li>
                Go to the{" "}
                <a href="https://api-console.zoho.ca/" target="_blank" rel="noreferrer" className="text-blue-400 inline-flex items-center gap-1 hover:underline">
                  Zoho API Console (.ca) <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and create a <span className="font-semibold">Self Client</span>.
              </li>
              <li>Copy the <span className="font-mono text-zinc-100">Client ID</span> and <span className="font-mono text-zinc-100">Client Secret</span>.</li>
              <li>
                In the Self Client "Generate Code" tab, enter scope{" "}
                <span className="font-mono text-xs bg-zinc-950 px-2 py-1 rounded-sm">ZohoBooks.invoices.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ</span>, pick a duration, and generate the grant code.
              </li>
              <li>Exchange the grant code for a <span className="font-semibold">Refresh Token</span> (I can do this step for you once you share the Client ID, Secret, and grant code).</li>
              <li>Send me those 3 values — I'll add them securely on the server and sync goes live.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

const Info = ({ label, value }) => (
  <div>
    <div className="label-eyebrow">{label}</div>
    <div className="font-mono text-sm mt-1">{value}</div>
  </div>
);
