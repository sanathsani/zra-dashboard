// ============================================================================
// App.jsx — shell, routing and the single date filter that scopes every page.
//
// There is no snapshot data anywhere in this app: every page renders from the
// live feed, derived once per range change in data.js.
// ============================================================================

import { useState, useMemo } from "react";
import { clearSession } from "./SignIn.jsx";
import { ThemeProvider, useTheme, colorFor } from "./theme";
import {
  useLiveData, derive, buildStableOrder, dataBounds, presetRanges, fmtDate,
} from "./data";
import { DateRange, ThemeToggle, TicketDrawer } from "./components";
import Overview from "./pages/Overview";
import Trends from "./pages/Trends";
import { AgentsPage, AgentDetail } from "./pages/Agents";
import Unsolved from "./pages/Unsolved";
import { CustomerList, CustomerDetail, RobotDetail } from "./pages/Customers";
import Anomalies from "./pages/Anomalies";
import Faults from "./pages/Faults";
import "./styles.css";

const NAV = [
  { group: "Operations", items: [
    { id: "overview", label: "Overview",      icon: "▤" },
    { id: "trends",   label: "Shift Summary", icon: "▦" },
    { id: "agents",   label: "Agents",        icon: "◍", internalOnly: true },
    { id: "unsolved", label: "Unsolved",      icon: "◷", badge: "unsolved", alert: true },
  ]},
  { group: "Intelligence", items: [
    { id: "faults",    label: "Fault Analysis", icon: "◈", badge: "faults" },
    { id: "customers", label: "Customers", icon: "◫" },
    { id: "anomalies", label: "Anomalies", icon: "◮", badge: "anomalies", alert: true },
  ]},
];

const TITLES = {
  overview: "Overview", trends: "Shift Summary", agents: "Agents",
  unsolved: "Unsolved Tickets", faults: "Fault Analysis",
  customers: "Customers", anomalies: "Anomalies",
};

function Dashboard({ session }) {
  const t = useTheme();
  const { loading, error, staleError, data, role, ts, refreshing } = useLiveData();

  const [view, setView] = useState("overview");
  const [selCust, setSelCust] = useState(null);
  const [selRobot, setSelRobot] = useState(null);
  const [selAgent, setSelAgent] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [range, setRange] = useState(null); // null → the data's own full span
  const [drill, setDrill] = useState(null); // the tickets behind a clicked figure

  const bounds = useMemo(() => dataBounds(data), [data]);
  const stableOrder = useMemo(() => buildStableOrder(data), [data]);

  const allTime = useMemo(() => presetRanges(bounds).find(p => p.id === "all"), [bounds]);
  const from = range?.from || bounds.from;
  const to = range?.to || (allTime?.to ?? bounds.to);
  const isAllTime = from === allTime?.from && to === allTime?.to;

  const d = useMemo(
    () => derive(data, from, to, stableOrder),
    [data, from, to, stableOrder]
  );

  const colorForAgent = name => colorFor(name, stableOrder.agents, t);
  const colorForCategory = name => colorFor(name, stableOrder.categories, t);

  const go = v => {
    setView(v); setSelCust(null); setSelRobot(null); setSelAgent(null);
    setSideOpen(false); setDrill(null);
  };
  const openDrill = payload => setDrill(payload);
  const openCustomer = name => { setSelCust(name); setSelRobot(null); setView("customers"); };
  const openRobot = id => { setSelRobot(id); setSelCust(d.rmap[id]?.customer || null); setView("customers"); };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
                    justifyContent: "center", minHeight: "100vh" }}>
        <div className="livedot" />
        <div style={{ fontSize: 14, color: "var(--text2)" }}>Connecting to live data…</div>
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>Reading the support log</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
                    justifyContent: "center", minHeight: "100vh", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--criticalText)" }}>Connection failed</div>
        <div style={{ fontSize: 13, color: "var(--text2)", maxWidth: 400, lineHeight: 1.7 }}>{error}</div>
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>
          Check the Apps Script web app is deployed and your email is on the access list.
        </div>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  const badges = {
    unsolved: d.unsolved.length,
    anomalies: d.anomalies.length,
    faults: d.faults.signatures.length,
  };
  const subtitle = selRobot ? `Robot ${selRobot}` : selCust || selAgent || `${fmtDate(from)} – ${fmtDate(to)}`;

  return (
    <div className="app">
      <nav className={`sidebar ${sideOpen ? "sidebar--open" : ""}`} aria-label="Sections">
        <div className="sidebar__brand">
          <span className="sidebar__mark">ZR</span>
          <span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 680, letterSpacing: "-.01em" }}>ZRA CEC</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text3)" }}>Customer Excellence Center</span>
          </span>
        </div>

        <div className="sidebar__nav">
          {NAV.map(g => {
            const items = g.items.filter(i => !i.internalOnly || role === "internal");
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="sidebar__group">{g.group}</div>
                {items.map(item => {
                  const n = badges[item.badge] || 0;
                  return (
                    <button key={item.id} className={`navitem ${view === item.id ? "navitem--active" : ""}`}
                      onClick={() => go(item.id)} aria-current={view === item.id ? "page" : undefined}>
                      <span className="navitem__icon" aria-hidden="true">{item.icon}</span>
                      <span>{item.label}</span>
                      {n > 0 && (
                        <span className={`navitem__badge ${item.alert ? "navitem__badge--alert" : ""}`}>{n}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="sidebar__foot">
          {session?.user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, minWidth: 0 }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 640, color: "var(--text2)",
                               overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.user.name}
                </span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text3)" }}>{session.user.role}</span>
              </span>
              <button className="btn btn--icon" title="Sign out" style={{ padding: "4px 7px" }}
                      onClick={() => { clearSession(); location.reload(); }}>⏻</button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text3)" }}>
            <span className={`livedot ${staleError ? "livedot--stale" : ""}`} />
            <span>
              {staleError ? "Reconnecting" : "Live"} ·{" "}
              {ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
        </div>
      </nav>

      {sideOpen && <button className="scrim" onClick={() => setSideOpen(false)} aria-label="Close menu" />}

      <div className="main">
        <header className="topbar">
          <button className="btn btn--icon menubtn" onClick={() => setSideOpen(o => !o)}
            aria-label="Toggle menu">☰</button>
          <div style={{ minWidth: 0 }}>
            <h1 className="topbar__title">{TITLES[view]}</h1>
            <div className="topbar__sub">{subtitle}</div>
          </div>
          <div className="topbar__spacer" />
          <span className="chip topbar__count">{d.summary.total.toLocaleString()} tickets</span>
          <DateRange from={from} to={to} bounds={bounds}
            onChange={(f, tt) => setRange({ from: f, to: tt })} />
          <ThemeToggle />
        </header>

        <main className={`content ${refreshing ? "refreshing" : ""}`}>
          {staleError && (
            <div className="notice" style={{ marginBottom: 16 }}>
              <span aria-hidden="true">!</span>
              <span>Showing the last successful read — the latest refresh failed ({staleError}).</span>
            </div>
          )}

          {view === "overview" && (
            <Overview d={d} meta={data?.meta} isAllTime={isAllTime}
              colorForCategory={colorForCategory} onNavCustomer={openCustomer}
              onNavRobot={openRobot} onNavFaults={() => go("faults")} onDrill={openDrill} />
          )}
          {view === "faults" && (
            <Faults d={d} onOpenRobot={openRobot} onDrill={openDrill} />
          )}
          {view === "trends" && <Trends d={d} colorForAgent={colorForAgent} />}
          {view === "agents" && !selAgent && (
            <AgentsPage d={d} colorForAgent={colorForAgent} onSelect={setSelAgent} />
          )}
          {view === "agents" && selAgent && (
            <AgentDetail name={selAgent} d={d} colorForAgent={colorForAgent}
              colorForCategory={colorForCategory} onBack={() => setSelAgent(null)} />
          )}
          {view === "unsolved" && (
            <Unsolved d={d} colorForCategory={colorForCategory}
              onNavCustomer={openCustomer} onDrill={openDrill} />
          )}
          {view === "customers" && !selCust && (
            <CustomerList d={d} colorForCategory={colorForCategory} onSelect={setSelCust} />
          )}
          {view === "customers" && selCust && !selRobot && (
            <CustomerDetail name={selCust} d={d} colorForCategory={colorForCategory}
              onRobot={setSelRobot} onBack={() => setSelCust(null)} onDrill={openDrill} />
          )}
          {view === "customers" && selRobot && (
            <RobotDetail robotId={selRobot} d={d} colorForCategory={colorForCategory}
              onBack={() => setSelRobot(null)} onDrill={openDrill} />
          )}
          {view === "anomalies" && (
            <Anomalies d={d} colorForCategory={colorForCategory} onOpenRobot={openRobot} />
          )}
        </main>
      </div>

      <TicketDrawer open={!!drill} title={drill?.title} sub={drill?.sub} rows={drill?.rows}
        colorFor={colorForCategory} onClose={() => setDrill(null)} />
    </div>
  );
}

export default function App({ session }) {
  return (
    <ThemeProvider>
      <Dashboard session={session} />
    </ThemeProvider>
  );
}
