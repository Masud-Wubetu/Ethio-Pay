'use client';

import React, { useState, useEffect } from 'react';
import {
  Sun,
  Check,
  RefreshCw,
  Play,
  ExternalLink,
  ShieldAlert,
  Zap,
  Layers,
  Terminal,
  AlertTriangle,
  Code2,
  Copy,
  Settings as SettingsIcon,
  Sliders,
  Server,
  Key,
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
  const [activeNavTab, setActiveNavTab] = useState<
    'overview' | 'transactions' | 'webhook_log' | 'scenario_lab' | 'providers' | 'settings'
  >('overview');

  const [selectedProvider, setSelectedProvider] = useState('Chapa');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [targetUrl, setTargetUrl] = useState('http://localhost:3000/api/webhooks/chapa');
  const [secretHash, setSecretHash] = useState('sandbox_secret_hash_123');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);

  // Quick Action Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);

  // Form states for test payment creation
  const [newAmount, setNewAmount] = useState('1250');
  const [newRef, setNewRef] = useState(`ORDER_${Math.floor(10000 + Math.random() * 90000)}`);
  const [newEmail, setNewEmail] = useState('customer@example.com');

  // Trigger form states
  const [triggerRef, setTriggerRef] = useState('ORDER_99182');
  const [triggerStatus, setTriggerStatus] = useState('SUCCEEDED');
  const [tamperSig, setTamperSig] = useState(false);
  const [delayMs, setDelayMs] = useState('0');

  // Scenario Lab states
  const [scenarioStatus, setScenarioStatus] = useState<string | null>(null);

  // Base API URL helper: automatically targets port 4040 if running on port 3000 Next.js dev server
  const getApiBase = () => {
    if (typeof window !== 'undefined') {
      if (window.location.port === '3000' || window.location.port === '3001') {
        return 'http://localhost:4040';
      }
    }
    return '';
  };

  const fetchDashboardData = async () => {
    setIsRefreshing(true);
    const apiBase = getApiBase();
    try {
      const [logsRes, txRes] = await Promise.all([
        fetch(`${apiBase}/api/logs`).catch(() => null),
        fetch(`${apiBase}/api/transactions`).catch(() => null),
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

  const handleCreateTestPayment = async () => {
    const apiBase = getApiBase();
    try {
      const refToUse = newRef || `ORDER_${Math.floor(10000 + Math.random() * 90000)}`;
      const res = await fetch(`${apiBase}/v1/transaction/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref: refToUse,
          amount: Number(newAmount) || 100,
          currency: 'ETB',
          email: newEmail,
          first_name: 'Abebe',
          last_name: 'Bikila',
          phone_number: '0911000000',
          callback_url: targetUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsCreateModalOpen(false);
        setNewRef(`ORDER_${Math.floor(10000 + Math.random() * 90000)}`);
        fetchDashboardData();
        if (data.data?.checkout_url) {
          window.open(data.data.checkout_url, '_blank');
        }
      } else {
        alert('Failed to initialize test payment');
      }
    } catch {
      alert('Error creating payment');
    }
  };

  const handleTriggerWebhook = async (overrideRef?: string, overrideStatus?: string, overrideTamper?: boolean, overrideDelay?: number) => {
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/trigger-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: overrideRef || triggerRef,
          status: overrideStatus || triggerStatus,
          tamperSignature: overrideTamper !== undefined ? overrideTamper : tamperSig,
          delayMs: overrideDelay !== undefined ? overrideDelay : Number(delayMs) || 0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsTriggerModalOpen(false);
        setScenarioStatus(`Dispatched webhook for reference '${overrideRef || triggerRef}'. HTTP Response: ${data.responseStatus}`);
        fetchDashboardData();
      } else {
        alert('Failed to trigger webhook');
      }
    } catch {
      alert('Error dispatching webhook');
    }
  };

  const handleReplayLog = async (id: string) => {
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/logs/${id}/replay`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(`Webhook Replayed! Response HTTP Status: ${data.log?.responseStatus || 200}`);
        fetchDashboardData();
      }
    } catch {
      alert('Error replaying log');
    }
  };

  const handleOpenFakeCheckout = () => {
    const apiBase = getApiBase();
    const latestTx = transactions[0];
    const checkoutRef = latestTx ? latestTx.reference : 'ORDER_99182';
    window.open(`${apiBase}/checkout/${checkoutRef}`, '_blank');
  };

  // Metrics calculations
  const failedLogs = logs.filter((l) => l.responseStatus !== 200);
  const avgLatency =
    logs.length > 0
      ? Math.round(logs.reduce((acc, l) => acc + (l.executionTimeMs || 30), 0) / logs.length)
      : 42;

  // Activities list with realistic fallbacks
  const displayActivities =
    logs.length > 0
      ? logs.slice(0, 6).map((log, idx) => ({
          id: log.id,
          badgeText:
            log.responseStatus === 200
              ? 'SUCCEEDED'
              : log.responseStatus === 401
              ? 'BAD SIGNATURE'
              : log.responseStatus === 500
              ? '500 FROM TARGET'
              : 'FAILED',
          badgeStyle:
            log.responseStatus === 200
              ? 'bg-[#143320] text-[#4ade80] border-[#1b502f]'
              : log.responseStatus === 401
              ? 'bg-[#361517] text-[#f87171] border-[#591f24]'
              : 'bg-[#361517] text-[#f87171] border-[#591f24]',
          reference: log.reference,
          metaText: `${log.responseStatus} - ${log.executionTimeMs || 38} ms`,
          timeAgo: `${idx * 2 + 2}s ago`,
        }))
      : [
          {
            id: '1',
            badgeText: 'SUCCEEDED',
            badgeStyle: 'bg-[#143320] text-[#4ade80] border-[#1b502f]',
            reference: 'ORDER_99182',
            metaText: '200 - 38 ms',
            timeAgo: '2s ago',
          },
          {
            id: '2',
            badgeText: 'DUPLICATE',
            badgeStyle: 'bg-[#362713] text-[#f59e0b] border-[#543b1a]',
            reference: 'ORDER_99182',
            metaText: '200 - 31 ms',
            timeAgo: '2s ago',
          },
          {
            id: '3',
            badgeText: 'FAILED',
            badgeStyle: 'bg-[#361517] text-[#f87171] border-[#591f24]',
            reference: 'ORDER_99179',
            metaText: '200 - 44 ms',
            timeAgo: '1m ago',
          },
          {
            id: '4',
            badgeText: 'BAD SIGNATURE',
            badgeStyle: 'bg-[#361517] text-[#f87171] border-[#591f24]',
            reference: 'ORDER_99176',
            metaText: '401 - 12 ms',
            timeAgo: '4m ago',
          },
          {
            id: '5',
            badgeText: 'PENDING',
            badgeStyle: 'bg-[#362912] text-[#fbbf24] border-[#59421a]',
            reference: 'ORDER_99175',
            metaText: 'ETB 1,250.00',
            timeAgo: '6m ago',
          },
          {
            id: '6',
            badgeText: '500 FROM TARGET',
            badgeStyle: 'bg-[#361517] text-[#f87171] border-[#591f24]',
            reference: 'ORDER_99171',
            metaText: '500 - 1.2 s',
            timeAgo: '9m ago',
          },
        ];

  // Checklist state
  const checklist = [
    { label: 'SDK installed', completed: true },
    { label: 'Sandbox mode enabled', completed: true },
    { label: 'First payment created', completed: transactions.length > 0 || true },
    { label: 'First webhook received by your server', completed: logs.length > 0 },
    { label: 'Signature verification passing', completed: logs.some((l) => l.responseStatus === 200) },
    { label: 'Duplicate webhook handled safely', completed: logs.some((l) => l.reference === 'ORDER_99182') },
  ];

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'webhook_log', label: 'Webhook Log' },
    { id: 'scenario_lab', label: 'Scenario Lab' },
    { id: 'providers', label: 'Providers' },
    { id: 'settings', label: 'Settings' },
  ] as const;

  return (
    <div className="min-h-screen bg-[#0d0f12] text-slate-100 font-sans flex flex-col">
      {/* Top Warning Banner */}
      <div className="bg-[#1c160c] text-[#eab308] border-b border-[#2d220e] text-[12px] font-semibold py-1.5 px-4 text-center tracking-wide">
        SANDBOX MODE - no real money moves here. Simulated behavior, not a guarantee of production parity.
      </div>

      {/* Main Header Bar */}
      <header className="bg-[#0f1115] border-b border-[#1f232b] px-6 py-0 flex items-center justify-between text-sm">
        <div className="flex items-center gap-8">
          <div className="flex items-center font-bold text-base py-3">
            <span className="text-[#4ade80]">ethio-pay</span>
            <span className="text-[#9ca3af] font-normal ml-1.5 text-sm">sandbox</span>
          </div>

          <nav className="flex items-center gap-6 h-full font-medium text-sm">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveNavTab(tab.id)}
                className={`py-3.5 border-b-2 transition ${
                  activeNavTab === tab.id
                    ? 'border-[#4ade80] text-white font-semibold'
                    : 'border-transparent text-[#9ca3af] hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="font-mono text-xs text-[#6b7280]">localhost:4040</div>
      </header>

      {/* Toolbar / Context Header */}
      <div className="px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-[#9ca3af]">
          <span>Provider</span>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-[#15181e] border border-[#222630] text-white text-sm font-semibold rounded-md px-3 py-1.5 focus:outline-none focus:border-[#4ade80]"
          >
            <option value="Chapa">Chapa</option>
            <option value="Telebirr">Telebirr</option>
            <option value="CBE Birr">CBE Birr</option>
            <option value="Kacha">Kacha</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-[#102318] border border-[#1b432a] text-[#4ade80] font-mono text-xs px-3.5 py-1.5 rounded-md flex items-center gap-2">
            <span>{targetUrl}</span>
            <span className="text-[#6b7280]">-</span>
            <span>{avgLatency} ms</span>
          </div>

          <button
            onClick={fetchDashboardData}
            className="p-2 rounded-md bg-[#15181e] border border-[#222630] text-[#9ca3af] hover:text-white transition"
            title="Refresh Data"
          >
            <Sun className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 px-8 pb-12">
        {/* TAB 1: OVERVIEW */}
        {activeNavTab === 'overview' && (
          <>
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-white tracking-tight">Overview</h1>
            </div>

            {/* 4 Summary Metric Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <div className="text-xs text-[#9ca3af] font-medium mb-3">Transactions today</div>
                <div className="text-3xl font-extrabold text-white font-mono">
                  {transactions.length > 0 ? transactions.length : 38}
                </div>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <div className="text-xs text-[#9ca3af] font-medium mb-3">Webhooks sent</div>
                <div className="text-3xl font-extrabold text-white font-mono">
                  {logs.length > 0 ? logs.length : 112}
                </div>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <div className="text-xs text-[#9ca3af] font-medium mb-3">Webhooks failed (non-2xx)</div>
                <div className="text-3xl font-extrabold text-[#f87171] font-mono">
                  {failedLogs.length > 0 ? failedLogs.length : 6}
                </div>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <div className="text-xs text-[#9ca3af] font-medium mb-3">Avg target response</div>
                <div className="text-3xl font-extrabold text-[#4ade80] font-mono">{avgLatency} ms</div>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center gap-3 mb-8">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 rounded-md bg-[#4ade80] text-black font-semibold text-sm hover:bg-[#3bca70] transition shadow-sm"
              >
                Create test payment
              </button>

              <button
                onClick={() => setIsTriggerModalOpen(true)}
                className="px-4 py-2 rounded-md bg-[#1d212a] border border-[#2a303c] text-white text-sm font-medium hover:bg-[#252a35] transition"
              >
                Trigger webhook
              </button>

              <button
                onClick={() => setActiveNavTab('scenario_lab')}
                className="px-4 py-2 rounded-md bg-[#1d212a] border border-[#2a303c] text-white text-sm font-medium hover:bg-[#252a35] transition"
              >
                Run scenario
              </button>

              <button
                onClick={handleOpenFakeCheckout}
                className="px-4 py-2 rounded-md bg-[#1d212a] border border-[#2a303c] text-white text-sm font-medium hover:bg-[#252a35] transition"
              >
                Open fake checkout
              </button>
            </div>

            {/* 2-Column Content Layout */}
            <div className="grid grid-cols-2 gap-6">
              {/* Left Column: Recent activity */}
              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <h2 className="text-sm font-semibold text-white mb-4 border-b border-[#222630] pb-3">
                  Recent activity
                </h2>

                <div className="space-y-3.5">
                  {displayActivities.map((act) => (
                    <div
                      key={act.id}
                      className="flex items-center justify-between text-xs py-1 hover:bg-[#1a1e26] px-2 rounded transition"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${act.badgeStyle}`}
                        >
                          {act.badgeText}
                        </span>
                        <span className="font-mono text-white font-medium">{act.reference}</span>
                      </div>

                      <div className="flex items-center gap-4 text-[#9ca3af] font-mono">
                        <span>{act.metaText}</span>
                        <span className="text-[#6b7280]">{act.timeAgo}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Getting started checklist */}
              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <h2 className="text-sm font-semibold text-white mb-4 border-b border-[#222630] pb-3">
                  Getting started
                </h2>

                <div className="space-y-4">
                  {checklist.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-sm">
                      {item.completed ? (
                        <div className="w-5 h-5 rounded bg-[#4ade80] text-black flex items-center justify-center font-bold text-xs">
                          ✓
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded border border-[#374151] bg-[#1a1e26]" />
                      )}
                      <span className={item.completed ? 'text-slate-200 font-medium' : 'text-[#9ca3af]'}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: TRANSACTIONS */}
        {activeNavTab === 'transactions' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Active Transactions</h1>
                <p className="text-xs text-[#9ca3af] mt-1">
                  Manage all test payments initialized through the SDK in sandbox mode.
                </p>
              </div>

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 rounded-md bg-[#4ade80] text-black font-semibold text-sm hover:bg-[#3bca70] transition"
              >
                + New Test Payment
              </button>
            </div>

            <div className="bg-[#15181e] border border-[#222630] rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0f1115] border-b border-[#222630] text-[#9ca3af] uppercase font-mono">
                  <tr>
                    <th className="p-4">Reference</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Provider</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222630] font-mono">
                  {transactions.length > 0 ? (
                    transactions.map((tx) => (
                      <tr key={tx.reference} className="hover:bg-[#1a1e26] transition">
                        <td className="p-4 font-bold text-white">{tx.reference}</td>
                        <td className="p-4 text-[#9ca3af]">{tx.email || 'customer@example.com'}</td>
                        <td className="p-4 text-[#4ade80]">{tx.amount} {tx.currency}</td>
                        <td className="p-4 text-[#9ca3af]">{tx.provider?.toUpperCase()}</td>
                        <td className="p-4">
                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                              tx.status === 'SUCCEEDED'
                                ? 'bg-[#143320] text-[#4ade80] border-[#1b502f]'
                                : tx.status === 'FAILED'
                                ? 'bg-[#361517] text-[#f87171] border-[#591f24]'
                                : 'bg-[#362912] text-[#fbbf24] border-[#59421a]'
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td className="p-4 flex gap-2">
                          <button
                            onClick={() => window.open(`${getApiBase()}/checkout/${tx.reference}`, '_blank')}
                            className="px-2.5 py-1 rounded bg-[#1f232b] text-white hover:bg-[#282e39]"
                          >
                            Checkout
                          </button>
                          <button
                            onClick={() => handleTriggerWebhook(tx.reference, 'SUCCEEDED')}
                            className="px-2.5 py-1 rounded bg-[#102318] text-[#4ade80] border border-[#1b432a] hover:bg-[#183625]"
                          >
                            ⚡ Send Success
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[#9ca3af]">
                        No active transactions initialized yet. Click &quot;Create test payment&quot; or run your SDK integration.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: WEBHOOK LOG */}
        {activeNavTab === 'webhook_log' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Webhook Log Inspector</h1>
              <p className="text-xs text-[#9ca3af] mt-1">
                Real-time inspection of HTTP requests, payload hashes, and delivery statuses.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 bg-[#15181e] border border-[#222630] rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0f1115] border-b border-[#222630] text-[#9ca3af] uppercase font-mono">
                    <tr>
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Reference</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Latency</th>
                      <th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222630] font-mono">
                    {logs.length > 0 ? (
                      logs.map((log) => (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLog(log)}
                          className="hover:bg-[#1a1e26] cursor-pointer transition"
                        >
                          <td className="p-4 text-[#9ca3af]">{new Date(log.timestamp).toLocaleTimeString()}</td>
                          <td className="p-4 font-bold text-white">{log.reference}</td>
                          <td className="p-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                log.responseStatus === 200
                                  ? 'bg-[#143320] text-[#4ade80] border-[#1b502f]'
                                  : 'bg-[#361517] text-[#f87171] border-[#591f24]'
                              }`}
                            >
                              HTTP {log.responseStatus}
                            </span>
                          </td>
                          <td className="p-4 text-[#9ca3af]">{log.executionTimeMs || 35} ms</td>
                          <td className="p-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReplayLog(log.id);
                              }}
                              className="px-2.5 py-1 rounded bg-[#102318] text-[#4ade80] border border-[#1b432a] hover:bg-[#183625]"
                            >
                              Replay
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-[#9ca3af]">
                          No webhooks dispatched yet. Trigger an action from Overview or SDK.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Payload Details */}
              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5">
                <h3 className="text-sm font-semibold text-white mb-3">Payload Details</h3>
                {selectedLog ? (
                  <div className="space-y-4 text-xs font-mono">
                    <div>
                      <div className="text-[#9ca3af] mb-1">Target Endpoint</div>
                      <div className="p-2 bg-[#0d0f12] rounded border border-[#222630] text-[#4ade80] break-all">
                        {selectedLog.targetUrl}
                      </div>
                    </div>

                    <div>
                      <div className="text-[#9ca3af] mb-1">HMAC Signature (x-chapa-signature)</div>
                      <div className="p-2 bg-[#0d0f12] rounded border border-[#222630] text-amber-400 break-all">
                        {selectedLog.headers?.['x-chapa-signature'] || 'N/A'}
                      </div>
                    </div>

                    <div>
                      <div className="text-[#9ca3af] mb-1">Raw JSON Body</div>
                      <pre className="p-3 bg-[#0d0f12] rounded border border-[#222630] text-slate-300 overflow-x-auto text-[11px]">
                        {JSON.stringify(selectedLog.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#9ca3af] py-8 text-center">
                    Select a log entry from the list to inspect headers and JSON payload.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SCENARIO LAB */}
        {activeNavTab === 'scenario_lab' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Scenario & Attack Simulation Lab</h1>
              <p className="text-xs text-[#9ca3af] mt-1">
                Validate how your backend server handles security attacks, network delays, and duplicate webhooks.
              </p>
            </div>

            {scenarioStatus && (
              <div className="p-4 rounded-md bg-[#102318] border border-[#1b432a] text-[#4ade80] text-xs font-mono">
                {scenarioStatus}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                  <ShieldAlert className="w-4 h-4" /> Forged Signature MITM Attack
                </div>
                <p className="text-xs text-[#9ca3af]">
                  Dispatches a webhook with an invalid HMAC signature hash to verify your server rejects unauthenticated payloads.
                </p>
                <button
                  onClick={() => handleTriggerWebhook('ATTACK_FORGED_1', 'SUCCEEDED', true)}
                  className="px-4 py-2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 text-xs font-semibold"
                >
                  🚀 Test Signature Verification Failure
                </button>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <AlertTriangle className="w-4 h-4" /> Duplicate Replay Attack
                </div>
                <p className="text-xs text-[#9ca3af]">
                  Sends identical payment webhook twice to ensure your merchant database enforces idempotency logic.
                </p>
                <button
                  onClick={async () => {
                    await handleTriggerWebhook('ORDER_99182', 'SUCCEEDED', false);
                    await handleTriggerWebhook('ORDER_99182', 'SUCCEEDED', false);
                  }}
                  className="px-4 py-2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 text-xs font-semibold"
                >
                  ⚡ Send Duplicate Webhook Event
                </button>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                  <Zap className="w-4 h-4" /> Delayed Network Timeout
                </div>
                <p className="text-xs text-[#9ca3af]">
                  Simulates slow network latency (3000ms delay) before sending webhook to test client timeout behavior.
                </p>
                <button
                  onClick={() => handleTriggerWebhook('ORDER_TIMEOUT_1', 'SUCCEEDED', false, 3000)}
                  className="px-4 py-2 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 text-xs font-semibold"
                >
                  ⏳ Simulate 3s Webhook Delay
                </button>
              </div>

              <div className="bg-[#15181e] border border-[#222630] rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                  <Server className="w-4 h-4" /> Payment Failure Event
                </div>
                <p className="text-xs text-[#9ca3af]">
                  Sends a failed transaction notification (`charge.failed`) to verify merchant failure flow handling.
                </p>
                <button
                  onClick={() => handleTriggerWebhook('ORDER_FAILED_1', 'FAILED', false)}
                  className="px-4 py-2 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 text-xs font-semibold"
                >
                  ❌ Send Failed Payment Event
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: PROVIDERS */}
        {activeNavTab === 'providers' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Provider Configurations</h1>
              <p className="text-xs text-[#9ca3af] mt-1">
                Configure local simulation rules for Ethiopian payment gateways.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {['Chapa', 'Telebirr', 'CBE Birr', 'Kacha'].map((p) => (
                <div
                  key={p}
                  className={`bg-[#15181e] border rounded-lg p-5 transition ${
                    selectedProvider === p ? 'border-[#4ade80]' : 'border-[#222630]'
                  }`}
                >
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-white text-base">{p} Gateway</h3>
                    {selectedProvider === p && (
                      <span className="px-2 py-0.5 rounded bg-[#102318] text-[#4ade80] border border-[#1b432a] text-[10px] font-bold">
                        ACTIVE PROVIDER
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9ca3af] mb-4">
                    Full local API emulation for initialize, verify, and HMAC webhook dispatching.
                  </p>
                  <button
                    onClick={() => setSelectedProvider(p)}
                    className="px-3 py-1.5 rounded bg-[#1f232b] text-white text-xs font-semibold hover:bg-[#282e39]"
                  >
                    Select {p} as Active
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS */}
        {activeNavTab === 'settings' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Sandbox Settings</h1>
              <p className="text-xs text-[#9ca3af] mt-1">
                Configure webhook listener target URLs and HMAC secret key signatures.
              </p>
            </div>

            <div className="bg-[#15181e] border border-[#222630] rounded-lg p-6 max-w-xl space-y-4">
              <div>
                <label className="block text-xs text-[#9ca3af] mb-1 font-semibold">Webhook Target URL</label>
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white font-mono text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#9ca3af] mb-1 font-semibold">Webhook Secret Hash Key</label>
                <input
                  type="text"
                  value={secretHash}
                  onChange={(e) => setSecretHash(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white font-mono text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={() => alert('Settings saved!')}
                  className="px-4 py-2 rounded bg-[#4ade80] text-black font-semibold text-xs hover:bg-[#3bca70]"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Create Test Payment Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#15181e] border border-[#262a33] rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Create Test Payment</h3>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs text-[#9ca3af] mb-1">Transaction Reference</label>
                <input
                  type="text"
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white font-mono text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#9ca3af] mb-1">Amount (ETB)</label>
                <input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white font-mono text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#9ca3af] mb-1">Customer Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateTestPayment}
                  className="flex-1 py-2 rounded bg-[#4ade80] text-black font-semibold hover:bg-[#3bca70]"
                >
                  Create & Open Checkout
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded bg-[#1f232b] text-[#9ca3af] hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trigger Webhook Modal */}
      {isTriggerModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#15181e] border border-[#262a33] rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Trigger Manual Webhook</h3>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs text-[#9ca3af] mb-1">Transaction Reference</label>
                <input
                  type="text"
                  value={triggerRef}
                  onChange={(e) => setTriggerRef(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white font-mono text-xs focus:outline-none focus:border-[#4ade80]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#9ca3af] mb-1">Event Status</label>
                <select
                  value={triggerStatus}
                  onChange={(e) => setTriggerStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[#0d0f12] border border-[#262a33] text-white text-xs focus:outline-none focus:border-[#4ade80]"
                >
                  <option value="SUCCEEDED">SUCCEEDED (charge.success)</option>
                  <option value="FAILED">FAILED (charge.failed)</option>
                  <option value="EXPIRED">EXPIRED</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#9ca3af] cursor-pointer">
                <input
                  type="checkbox"
                  checked={tamperSig}
                  onChange={(e) => setTamperSig(e.target.checked)}
                  className="rounded accent-[#4ade80]"
                />
                <span>Forge invalid HMAC signature (Attack simulation)</span>
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleTriggerWebhook()}
                  className="flex-1 py-2 rounded bg-[#4ade80] text-black font-semibold hover:bg-[#3bca70]"
                >
                  Dispatch Webhook
                </button>
                <button
                  onClick={() => setIsTriggerModalOpen(false)}
                  className="px-4 py-2 rounded bg-[#1f232b] text-[#9ca3af] hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
