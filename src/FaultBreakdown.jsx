import { useMemo } from "react";
import { Card, RankRow, Empty } from "./components";
import { useTheme } from "./theme";
import { summariseFaults, FAMILIES } from "./faults";
import { pct } from "./data";

const FAMILY_ORDER = ["navigation", "docking", "payload", "motor", "battery", "sensor", "other"];

/**
 * The faults inside a given set of tickets — the answer to "what kinds of
 * error did this robot actually get", which the Generic Error category hides.
 */
export default function FaultBreakdown({ rows, title = "Fault breakdown", sub, onDrill, max = 12 }) {
  const t = useTheme();
  const f = useMemo(() => summariseFaults(rows), [rows]);
  const familyColor = id => {
    const i = FAMILY_ORDER.indexOf(id);
    return i >= 0 && i < t.series.length ? t.series[i] : t.seriesOther;
  };

  if (!f.signatures.length) {
    return (
      <Card title={title} sub={sub}>
        <Empty icon="—" title="No machine faults here"
          body="These tickets were raised by people, not by the alert system." />
      </Card>
    );
  }

  const shown = f.signatures.slice(0, max);
  const rest = f.signatures.length - shown.length;

  return (
    <Card title={title}
      sub={sub || `${f.classified} of ${f.total} tickets carry a machine fault · ${f.signatures.length} distinct`}>
      <div className="stack" style={{ gap: 2, marginTop: 4 }}>
        {shown.map(s => (
          <RankRow key={s.id} label={s.label} color={familyColor(s.family)}
            value={s.count} max={f.signatures[0].count} pct={pct(s.count, f.classified)}
            nameWidth={330}
            onClick={onDrill ? () => onDrill({
              title: s.label,
              sub: `${FAMILIES[s.family] || s.family} · ${s.count} tickets`,
              rows: s.rows.slice().reverse(),
            }) : undefined} />
        ))}
      </div>
      {rest > 0 && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 10 }}>
          + {rest} more fault{rest === 1 ? "" : "s"} with fewer occurrences
        </div>
      )}
    </Card>
  );
}
