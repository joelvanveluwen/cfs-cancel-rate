import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";

interface Row {
  month: string; // YYYY-MM
  scheduled: number;
  flown: number;
  cancelled: number;
  dep_on_time: number;
}
interface CfsRow extends Row {
  airline: string;
  direction: "arrivals" | "departures";
}
interface Dataset {
  source: string;
  source_url: string;
  fetched_at: string;
  latest_month: string;
  cfs: CfsRow[];
  national: Row[];
  compare: { pqq: Row[]; bnk: Row[] };
}

interface DisruptionLog {
  fetched_at: string | null;
  window_days: number;
  flights: {
    date: string;
    callsign: string;
    airline: string;
    kind: "departure" | "arrival";
    other_airport: string;
    scheduled_local: string;
    status: "cancelled" | "delayed";
    delay_min: number | null;
    source: string;
  }[];
}

const COMPARE_AIRPORTS = {
  pqq: { label: "Port Macquarie", color: "#2f5f9f" },
  bnk: { label: "Ballina", color: "#0f766e" },
} as const;
type CompareKey = keyof typeof COMPARE_AIRPORTS;
const RANGE_OPTIONS = [6, 12, 24] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];

const pct = (c: number, s: number, dp = 1) => (s > 0 ? `${((c / s) * 100).toFixed(dp)}%` : "--");
const rate = (c: number, s: number) => (s > 0 ? c / s : 0);

const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1)).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};
const monthShort = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1)).toLocaleDateString("en-AU", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
};

function sumByMonth(rows: Row[]): Map<string, { s: number; c: number; ot: number; f: number }> {
  const map = new Map<string, { s: number; c: number; ot: number; f: number }>();
  for (const r of rows) {
    const e = map.get(r.month) ?? { s: 0, c: 0, ot: 0, f: 0 };
    e.s += r.scheduled;
    e.c += r.cancelled;
    e.ot += r.dep_on_time;
    e.f += r.flown;
    map.set(r.month, e);
  }
  return map;
}

const heat = (r: number) => `rgba(114, 0, 28, ${Math.min(1, r / 0.08).toFixed(2)})`;

function totalFor(monthList: string[], map: Map<string, { s: number; c: number }>) {
  return monthList.reduce(
    (a, m) => {
      const e = map.get(m);
      return e ? { s: a.s + e.s, c: a.c + e.c } : a;
    },
    { s: 0, c: 0 }
  );
}

interface TrendSeries {
  label: string;
  color: string;
  width?: number;
  dash?: string;
  dots?: boolean;
  points: { month: string; rate: number }[];
}

function Section({
  label,
  title,
  note,
  children,
  className = "",
}: {
  label: string;
  title?: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-rule ${className}`}>
      <aside className="section-label">
        <span />
        <p>{label}</p>
      </aside>
      <div className="min-w-0">
        {title && <h2 className="section-title">{title}</h2>}
        {note && <div className="section-note">{note}</div>}
        {children}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  accent = false,
  children,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail && <div className="stat-detail">{detail}</div>}
      {children}
    </div>
  );
}

function TrendChart({ series }: { series: TrendSeries[] }) {
  const W = 760;
  const H = 250;
  const pad = { l: 40, r: 44, t: 14, b: 28 };
  const months = series[0].points.map((p) => p.month);
  const maxY = Math.max(0.04, ...series.flatMap((s) => s.points.map((p) => p.rate))) * 1.12;
  const x = (m: string) => pad.l + (months.indexOf(m) / Math.max(1, months.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const line = (pts: { month: string; rate: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.month).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label="Monthly cancellation rate trend">
      <rect x="0" y="0" width={W} height={H} fill="transparent" />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = maxY * t;
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
            <text x={pad.l - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--color-soft)" fontFamily="var(--font-mono)">
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      {months.map((m, i) =>
        i % Math.ceil(months.length / 8) === 0 ? (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-soft)" fontFamily="var(--font-mono)">
            {monthShort(m)}
          </text>
        ) : null
      )}
      {series.map((s) => {
        const pts = s.points.filter((p) => months.includes(p.month));
        return (
          <g key={s.label}>
            <path d={line(pts)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash} strokeLinecap="square" />
            {s.dots &&
              pts.map((p) => (
                <circle key={p.month} cx={x(p.month)} cy={y(p.rate)} r="2.8" fill="var(--color-paper)" stroke={s.color} strokeWidth="1.5">
                  <title>{`${s.label} ${monthShort(p.month)}: ${(p.rate * 100).toFixed(1)}%`}</title>
                </circle>
              ))}
          </g>
        );
      })}
    </svg>
  );
}

function CancellationVector({ points }: { points: { month: string; rate: number; cancelled: number }[] }) {
  const W = 1180;
  const H = 330;
  const pad = 44;
  const maxRate = Math.max(0.055, ...points.map((p) => p.rate));
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / maxRate) * (H - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const contours = Array.from({ length: 42 }, (_, i) => {
    const offset = (i - 6) * 5.5;
    return { offset, opacity: Math.max(0.035, 0.24 - i * 0.004) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vector-graph" role="img" aria-label="CFS cancellation contour graph">
      <defs>
        <pattern id="grid" width="58" height="58" patternUnits="userSpaceOnUse">
          <path d="M 58 0 L 0 0 0 58" fill="none" stroke="var(--color-grid)" strokeWidth="1" />
        </pattern>
        <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill="var(--color-ink)" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      <path d={`${path} L ${W - pad},${H - pad} L ${pad},${H - pad} Z`} fill="url(#dots)" opacity="0.1" />
      {contours.map(({ offset, opacity }) => (
        <path
          key={offset}
          d={path}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1"
          opacity={opacity}
          transform={`translate(0 ${offset.toFixed(1)})`}
        />
      ))}
      <path d={path} fill="none" stroke="var(--color-alert)" strokeWidth="3" strokeLinecap="square" />
    </svg>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ compare?: string; range?: string }> }) {
  const params = await searchParams;
  const data: Dataset = JSON.parse(await readFile(path.join(process.cwd(), "data", "cfs.json"), "utf-8"));
  const recent: DisruptionLog = JSON.parse(await readFile(path.join(process.cwd(), "data", "recent.json"), "utf-8"));

  const range = RANGE_OPTIONS.includes(Number(params.range) as RangeOption) ? (Number(params.range) as RangeOption) : 6;
  const compareOn = (params.compare ?? "")
    .split(",")
    .filter((k): k is CompareKey => k in COMPARE_AIRPORTS);
  const queryHref = (nextCompare = compareOn, nextRange = range) => {
    const query = new URLSearchParams();
    if (nextCompare.length) query.set("compare", nextCompare.join(","));
    if (nextRange !== 6) query.set("range", String(nextRange));
    const qs = query.toString();
    return qs ? `/?${qs}` : "/";
  };
  const compareHref = (k: CompareKey) => {
    const next = compareOn.includes(k) ? compareOn.filter((x) => x !== k) : [...compareOn, k];
    return queryHref(next, range);
  };
  const rangeHref = (nextRange: RangeOption) => queryHref(compareOn, nextRange);

  const all = data.cfs.filter((r) => r.airline === "All Airlines");
  const byMonth = sumByMonth(all);
  const natByMonth = sumByMonth(data.national);
  const months = [...byMonth.keys()].sort();
  const latest = months[months.length - 1];
  const last12 = months.slice(-12);
  const last6 = months.slice(-6);
  const frameMonths = last6;

  const lm = byMonth.get(latest)!;
  const lmNat = natByMonth.get(latest);
  const t12 = totalFor(last12, byMonth);
  const t12Nat = totalFor(last12, natByMonth);
  const t6 = totalFor(last6, byMonth);
  const t6Nat = totalFor(last6, natByMonth);
  const gap12 = rate(t12Nat.c, t12Nat.s) > 0 ? rate(t12.c, t12.s) / rate(t12Nat.c, t12Nat.s) : 0;
  const gap6 = rate(t6Nat.c, t6Nat.s) > 0 ? rate(t6.c, t6.s) / rate(t6Nat.c, t6Nat.s) : 0;
  const worstFrame = frameMonths.reduce((w, m) => {
    const e = byMonth.get(m)!;
    return rate(e.c, e.s) > rate(byMonth.get(w)!.c, byMonth.get(w)!.s) ? m : w;
  }, frameMonths[0]);

  const trendMonths = months.slice(-range);
  const trendCfs = trendMonths.map((m) => ({ month: m, rate: rate(byMonth.get(m)!.c, byMonth.get(m)!.s) }));
  const trendNat = trendMonths
    .filter((m) => natByMonth.has(m))
    .map((m) => ({ month: m, rate: rate(natByMonth.get(m)!.c, natByMonth.get(m)!.s) }));

  const compareByMonth = Object.fromEntries(
    (Object.keys(COMPARE_AIRPORTS) as CompareKey[]).map((k) => [k, sumByMonth(data.compare[k])])
  ) as Record<CompareKey, ReturnType<typeof sumByMonth>>;
  const trendSeries: TrendSeries[] = [
    { label: "All domestic routes", color: "#8b817d", dash: "4 4", points: trendNat },
    ...compareOn.map((k) => ({
      label: COMPARE_AIRPORTS[k].label,
      color: COMPARE_AIRPORTS[k].color,
      width: 1.5,
      points: trendMonths
        .filter((m) => compareByMonth[k].has(m))
        .map((m) => ({ month: m, rate: rate(compareByMonth[k].get(m)!.c, compareByMonth[k].get(m)!.s) })),
    })),
    { label: "Coffs ↔ Sydney", color: "#72001c", width: 2.8, dots: true, points: trendCfs },
  ];

  const compareRows = compareOn.map((k) => {
    const t = totalFor(trendMonths, compareByMonth[k]);
    return { label: `${COMPARE_AIRPORTS[k].label} ↔ Sydney`, color: COMPARE_AIRPORTS[k].color, ...t };
  });

  const gridYears = [...new Set(months.map((m) => m.slice(0, 4)))].sort().slice(-4);

  const dirSplit = (["arrivals", "departures"] as const).map((d) => {
    const rows = all.filter((r) => r.direction === d && frameMonths.includes(r.month));
    const s = rows.reduce((a, r) => a + r.scheduled, 0);
    const c = rows.reduce((a, r) => a + r.cancelled, 0);
    return { label: d === "arrivals" ? "Into Coffs (SYD -> CFS)" : "Out of Coffs (CFS -> SYD)", s, c };
  });
  const airlines = [...new Set(data.cfs.filter((r) => frameMonths.includes(r.month) && r.airline !== "All Airlines").map((r) => r.airline))].sort();
  const airlineSplit = airlines
    .map((a) => {
      const rows = data.cfs.filter((r) => r.airline === a && frameMonths.includes(r.month));
      const s = rows.reduce((x, r) => x + r.scheduled, 0);
      const c = rows.reduce((x, r) => x + r.cancelled, 0);
      return { label: a, s, c };
    })
    .filter((a) => a.s >= 30);
  const maxSplit = Math.max(...dirSplit.map((d) => rate(d.c, d.s)), ...airlineSplit.map((d) => rate(d.c, d.s)), 0.001);
  const vectorPoints = last12.map((m) => {
    const e = byMonth.get(m)!;
    return { month: m, rate: rate(e.c, e.s), cancelled: e.c };
  });

  const Bar = ({ label, s, c }: { label: string; s: number; c: number }) => (
    <div className="bar-row">
      <span>{label}</span>
      <div>
        <i style={{ width: `${(rate(c, s) / maxSplit) * 100}%` }} />
      </div>
      <strong>
        {pct(c, s)} <em>({c})</em>
      </strong>
    </div>
  );

  return (
    <div className="space-y-14">
      <header className="hero-grid">
        <div className="hero-meta">
          <span />
          <p>CFS / SYD</p>
        </div>
        <h1 className="hero-title" aria-label="COFFS HARBOUR FLIGHT CANCELLATIONS">
          <span className="hero-title-layer hero-title-base" aria-hidden="true">
            <span>COFFS</span>
            <span>HARBOUR</span>
            <span>FLIGHT</span>
            <span>CANCELLATIONS</span>
          </span>
          <span className="hero-title-layer hero-title-photo" aria-hidden="true">
            <span>COFFS</span>
            <span>HARBOUR</span>
            <span>FLIGHT</span>
            <span>CANCELLATIONS</span>
          </span>
        </h1>
        <div className="hero-copy">
          <p>
            In {monthName(latest)}, <strong>{lm.c} of {lm.s}</strong> scheduled flights between Coffs Harbour and
            Sydney were cancelled, a <strong>{pct(lm.c, lm.s)}</strong> cancellation rate
            {lmNat && <> compared with {pct(lmNat.c, lmNat.s)} nationally</>}.
          </p>
          <p className="hero-small">Monthly BITRE route data with a recent flight-level disruption log for Coffs Harbour.</p>
        </div>
      </header>

      <section className="stats-grid">
        <MetricCard label={`${monthShort(latest)} rate`} value={pct(lm.c, lm.s)} accent detail={`${lm.c} cancellations from ${lm.s} scheduled flights`} />
        <MetricCard label="Cancelled, last 6 mo" value={t6.c} detail={`of ${t6.s.toLocaleString()} scheduled flights`} />
        <MetricCard label="vs national" value={`${gap6.toFixed(1)}x`}>
          <div className="stat-split">
            <span>6 mo</span>
            <strong>{gap6.toFixed(1)}x</strong>
            <span>12 mo</span>
            <strong>{gap12.toFixed(1)}x</strong>
          </div>
        </MetricCard>
        <MetricCard
          label="Worst month, 6 mo"
          value={monthShort(worstFrame)}
          detail={`${pct(byMonth.get(worstFrame)!.c, byMonth.get(worstFrame)!.s)} cancelled`}
        />
      </section>

      <Section
        label="trend"
        title="Monthly cancellation rate"
        note={
          <>
            <span className="legend-alert">Coffs ↔ Sydney</span>
            {compareOn.map((k) => (
              <span key={k}>{COMPARE_AIRPORTS[k].label} ↔ Sydney</span>
            ))}
            <span>all domestic routes</span>
          </>
        }
      >
        <div className="compare-row">
          <span>Range</span>
          {RANGE_OPTIONS.map((option) => (
            <Link key={option} href={rangeHref(option)} className={range === option ? "toggle-on" : ""}>
              {option} months
            </Link>
          ))}
          <span>Compare</span>
          {(Object.keys(COMPARE_AIRPORTS) as CompareKey[]).map((k) => {
            const on = compareOn.includes(k);
            return (
              <Link key={k} href={compareHref(k)} className={on ? "toggle-on" : ""} style={on ? { backgroundColor: COMPARE_AIRPORTS[k].color } : undefined}>
                {COMPARE_AIRPORTS[k].label}
              </Link>
            );
          })}
        </div>
        <TrendChart series={trendSeries} />
        {compareRows.length > 0 && (
          <table className="data mt-5">
            <thead>
              <tr>
                <th>Route, last {range} months</th>
                <th className="text-right">Scheduled</th>
                <th className="text-right">Cancelled</th>
                <th className="text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {[{ label: "Coffs Harbour ↔ Sydney", color: "#72001c", ...totalFor(trendMonths, byMonth) }, ...compareRows].map((r) => (
                <tr key={r.label}>
                  <td className="font-medium" style={{ color: r.color }}>
                    {r.label}
                  </td>
                  <td className="text-right font-mono text-xs">{r.s.toLocaleString()}</td>
                  <td className="text-right font-mono text-xs">{r.c}</td>
                  <td className="text-right font-mono text-xs font-semibold" style={{ color: r.color }}>
                    {pct(r.c, r.s)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section label="months" title="Every month at a glance" note="Darker cells indicate a higher cancellation rate for that month.">
        <div className="overflow-x-auto">
          <table className="month-grid" style={{ borderSpacing: 4 }}>
            <thead>
              <tr>
                <th />
                {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => (
                  <th key={i}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridYears.map((y) => (
                <tr key={y}>
                  <td>{y}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const e = byMonth.get(m);
                    if (!e) return <td key={i} className="empty" />;
                    const r = rate(e.c, e.s);
                    return (
                      <td
                        key={i}
                        style={{ backgroundColor: heat(r), color: r > 0.045 ? "var(--color-paper)" : "var(--color-soft)" }}
                        title={`${monthName(m)}: ${e.c} of ${e.s} cancelled (${pct(e.c, e.s)})`}
                      >
                        {e.c}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">Number shown is flights cancelled that month.</p>
      </Section>

      <Section label="split" title="Who and which way" note="Cancellation rate by direction and airline over the last 6 months.">
        <div className="space-y-2">{dirSplit.map((d) => <Bar key={d.label} {...d} />)}</div>
        <div className="mt-5 space-y-2 border-t border-line pt-5">{airlineSplit.map((d) => <Bar key={d.label} {...d} />)}</div>
      </Section>

      <Section label="detail" title="Last 6 months in detail" note="Rows are shaded when the Coffs route is at least 1.5x the national cancellation rate that month.">
        <table className="data">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">Scheduled</th>
              <th className="text-right">Cancelled</th>
              <th className="text-right">Rate</th>
              <th className="text-right">National</th>
              <th className="text-right">On-time dep.</th>
            </tr>
          </thead>
          <tbody>
            {[...frameMonths].reverse().map((m) => {
              const e = byMonth.get(m)!;
              const n = natByMonth.get(m);
              const r = rate(e.c, e.s);
              const nr = n ? rate(n.c, n.s) : 0;
              return (
                <tr key={m} className={r >= nr * 1.5 && e.c > 2 ? "bg-alert-soft" : undefined}>
                  <td className="font-medium">{monthShort(m)}</td>
                  <td className="text-right font-mono text-xs">{e.s}</td>
                  <td className={`text-right font-mono text-xs ${e.c > 0 ? "font-semibold text-alert" : ""}`}>{e.c}</td>
                  <td className={`text-right font-mono text-xs ${r >= nr ? "font-semibold text-alert" : ""}`}>{pct(e.c, e.s)}</td>
                  <td className="text-right font-mono text-xs text-soft">{n ? pct(n.c, n.s) : "--"}</td>
                  <td className="text-right font-mono text-xs">{pct(e.ot, e.f, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section label="recent" title={`Disruption log, last ${recent.window_days} days`} note="Specific Coffs Harbour flights recorded as cancelled or delayed by 60 minutes or more.">
        {recent.flights.length === 0 ? (
          <div className="empty-state">
            <p>
              No recent flight-level entries are available yet. Monthly BITRE data will still update the historical
              charts when the next route report is published.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Flight</th>
                  <th>Airline</th>
                  <th>Route</th>
                  <th>Sched.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.flights.map((f) => (
                  <tr key={`${f.date}-${f.callsign}-${f.kind}`} className={f.status === "cancelled" ? "bg-alert-soft" : undefined}>
                    <td className="font-mono text-xs">{f.date}</td>
                    <td className="font-mono text-xs font-semibold">{f.callsign}</td>
                    <td className="text-xs">{f.airline}</td>
                    <td className="font-mono text-xs">{f.kind === "departure" ? `CFS -> ${f.other_airport}` : `${f.other_airport} -> CFS`}</td>
                    <td className="font-mono text-xs">{f.scheduled_local}</td>
                    <td>
                      {f.status === "cancelled" ? (
                        <span className="pill-fill">CANCELLED</span>
                      ) : (
                        <span className="pill-outline">
                          DELAYED {Math.floor((f.delay_min ?? 0) / 60)}h {(f.delay_min ?? 0) % 60}m
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="caption">Source: AeroDataBox. Last updated {recent.fetched_at?.slice(0, 16).replace("T", " ")} UTC.</p>
          </div>
        )}
      </Section>

      <Section label="source" title="About the data">
        <div className="copy-block">
          <p>
            The monthly route data comes from BITRE&apos;s{" "}
            <a href={data.source_url}>Domestic Airlines On Time Performance</a> series, published by the Australian
            Government on data.gov.au under CC-BY 3.0 AU.
          </p>
          <p>
            BITRE reports scheduled sectors, cancellations and punctuality by route, airline and direction. The
            publication is monthly and usually appears several weeks after the end of the reporting month.
          </p>
          <p>
            The recent disruption table uses flight-level AeroDataBox records for Coffs Harbour Airport. It is separate
            from the BITRE monthly series and is included to show individual recent flights where available.
          </p>
        </div>
      </Section>

      <section className="vector-wrap">
        <CancellationVector points={vectorPoints} />
      </section>

      <footer>
        Data through {monthName(latest)} / fetched {data.fetched_at} / BITRE, CC-BY 3.0 AU / built in Coffs Harbour by{" "}
        <a href="https://vanveluwen.dev">vanveluwen.dev</a>
      </footer>
    </div>
  );
}
