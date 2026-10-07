'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  ShieldAlert,
  Terminal,
  Zap,
  RefreshCw,
  Play,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  Code2,
} from 'lucide-react';

interface Transaction {
  reference: string;
  amount: number;
  currency: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  provider: string;
  createdAt: string;
}

interface WebhookLog {
  id: string;
  reference: string;
  targetUrl: string;
  status: string;
  payload: any;
  headers: Record<string, string>;
  responseStatus: number;
  responseBody: string;
  executionTimeMs: number;
  timestamp: string;
}

export default function DashboardHome() {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'transactions' | 'logs' | 'attack'
  >('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [attackRef, setAttackRef] = useState('ATTACK-REF-1');
  const [tamperSig, setTamperSig] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchDashboardData = async () => {
    setIsRefreshing(true);
    try {
      const [logsRes, txRes] = await Promise.all([
        fetch('/api/logs').catch(() => null),
        fetch('/api/transactions').catch(() => null),
      ]);
      if (logsRes && logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs || []);
      }
      if (txRes && txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions || []);
      }
    } catch {
      // fallback
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 3000);
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleManualTrigger = async (reference: string, status: string) => {
    try {
      await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, status }),
      });
      fetchDashboardData();
    } catch {
      alert('Error triggering webhook');
    }
  };

  const handleReplay = async (logId: string) => {
    try {
      const res = await fetch(`/api/logs/${logId}/replay`, { method: 'POST' });
      const data = await res.json();
      alert(`Webhook replayed! HTTP Target Response: ${data.log?.responseStatus || 200}`);
      fetchDashboardData();
    } catch {
      alert('Error replaying webhook');
    }
  };

  const handleAttackDispatch = async () => {
    try {
      const res = await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: attackRef,
          status: 'SUCCEEDED',
          tamperSignature: tamperSig,
        }),
      });
      const data = await res.json();
      alert(`Attack Webhook Dispatched! Target Response HTTP: ${data.responseStatus}`);
      fetchDashboardData();
    } catch {
      alert('Error dispatching attack webhook');
    }
  };

  const successCount = logs.filter((l) => l.responseStatus === 200).length;
  const successRate = logs.length > 0 ? Math.round((successCount / logs.length) * 100) : 100;
  const avgLatency =
    logs.length > 0
      ? Math.round(
          logs.reduce((acc, l) => acc + (l.executionTimeMs || 25), 0) / logs.length
        )
      : 32;

  return (
    <div className="flex min-h-screen bg-[#070a12] text-slate-100 font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#0c1220] border-r border-white/10 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 text-sky-400 font-extrabold text-lg tracking-tight mb-8">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 shadow-[0_0_12px_#10b981]"></span>
            Ethio-Pay Console
          </div>

          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'overview'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="w-4 h-4" /> Overview Dashboard
            </button>

            <button
              onClick={() => setActiveTab('transactions')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'transactions'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-4 h-4" /> Active Transactions
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'logs'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Terminal className="w-4 h-4" /> Webhook Inspector
            </button>

            <button
              onClick={() => setActiveTab('attack')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                activeTab === 'attack'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <ShieldAlert className="w-4 h-4" /> Security Attack Lab
            </button>
          </nav>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-400 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200">Sandbox Target</span>
            <RefreshCw
              className={`w-3.5 h-3.5 cursor-pointer text-sky-400 ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              onClick={fetchDashboardData}
            />
          </div>
          <div className="font-mono text-sky-400 text-[11px] truncate">
            http://localhost:3000/api/webhooks/chapa
          </div>
        </div>
      </aside>

      {/* Main Console Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Developer Webhook Console
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Production-grade inspection for Ethiopian payment provider webhooks
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Gateway Online (Port 4040)
            </span>
          </div>
        </header>

        {/* Real-time Metrics */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-[#121929] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Initialized Orders</span>
              <Layers className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-3xl font-extrabold text-white mt-2">
              {transactions.length}
            </div>
          </div>

          <div className="bg-[#121929] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Dispatched Webhooks</span>
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-extrabold text-white mt-2">
              {logs.length}
            </div>
          </div>

          <div className="bg-[#121929] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Success Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-extrabold text-emerald-400 mt-2">
              {successRate}%
            </div>
          </div>

          <div className="bg-[#121929] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Avg Latency</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-3xl font-extrabold text-white mt-2">
              {avgLatency}ms
            </div>
          </div>
        </div>

        {/* Tab 1: Overview Dashboard */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-6">
              <div className="bg-[#121929] border border-white/10 rounded-2xl p-6">
                <h3 className="text-base font-bold text-white mb-4 flex items-center justify-between">
                  <span>Recent Webhook Deliveries</span>
                  <button
                    onClick={() => setActiveTab('logs')}
                    className="text-xs text-sky-400 font-semibold hover:underline"
                  >
                    View All Logs
                  </button>
                </h3>

                <div className="space-y-3">
                  {logs.length > 0 ? (
                    logs.slice(0, 4).map((log) => (
                      <div
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-sky-500/40 cursor-pointer transition"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold ${
                              log.responseStatus === 200
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {log.responseStatus}
                          </span>
                          <div>
                            <div className="font-mono text-xs text-white font-semibold">
                              {log.reference}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              {log.targetUrl}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs">
                          <span className="font-mono text-slate-400">
                            {log.executionTimeMs || 25}ms
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReplay(log.id);
                            }}
                            className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"
                            title="Replay Webhook"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-slate-400 text-xs">
                      No webhooks dispatched yet. Run a payment from the Express app.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions Panel */}
            <div className="space-y-6">
              <div className="bg-[#121929] border border-white/10 rounded-2xl p-6">
                <h3 className="text-base font-bold text-white mb-4">
                  Quick Security Attacks
                </h3>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1.5 font-semibold">
                      Target Reference
                    </label>
                    <input
                      type="text"
                      value={attackRef}
                      onChange={(e) => setAttackRef(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={tamperSig}
                      onChange={(e) => setTamperSig(e.target.checked)}
                      className="rounded accent-sky-400"
                    />
                    <span>Forge HMAC Signature (MITM Attack)</span>
                  </label>

                  <button
                    onClick={handleAttackDispatch}
                    className="w-full py-2.5 rounded-xl font-bold bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/25 hover:opacity-95 transition"
                  >
                    🚀 Dispatch Attack Webhook
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Webhook Inspector Modal / Inspector View */}
        {activeTab === 'logs' && (
          <div className="bg-[#121929] border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-extrabold text-white mb-4">
              Live Webhook Request Inspector
            </h3>

            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-3 py-1 rounded-md text-xs font-mono font-bold ${
                          log.responseStatus === 200
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        HTTP {log.responseStatus}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">
                        {log.reference}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <button
                        onClick={() => handleReplay(log.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Replay
                      </button>
                    </div>
                  </div>

                  {/* Header & Body Details */}
                  <div className="grid grid-cols-2 gap-4 text-xs font-mono bg-black/40 p-3 rounded-lg border border-white/5">
                    <div>
                      <div className="text-slate-500 mb-1 font-bold">HMAC Signature Header</div>
                      <div className="text-sky-400 truncate">
                        {log.headers?.['x-chapa-signature'] || 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1 font-bold">Payload Summary</div>
                      <div className="text-emerald-400 truncate">
                        {JSON.stringify(log.payload)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
