# ZRA CEC Dashboard

Live L1 support-operations dashboard for the Skild · Fetch fleet. Reads the
Zendesk ticket log published by an Apps Script web app and renders it as one
filterable view of volume, resolution, agents, customers, robots and alerts.

## How the data flows

```
Google Sheet  →  Apps Script web app  →  /api/data (serverless proxy)  →  React app
```

`api/data.js` proxies the Apps Script endpoint so the browser never hits a
cross-origin redirect. In development, `vite.config.js` proxies the same path.

Every number the UI shows is derived from the live `rows` array in `src/data.js`.
There is no snapshot or sample data anywhere in the app: change the date range
and every page — including Unsolved, Customers, Robots and Anomalies —
recalculates from the same filtered slice.

## Layout

| Path | Purpose |
|---|---|
| `src/data.js` | Fetching, date-range filtering, and every derived metric |
| `src/theme.jsx` | Design tokens, the validated chart palette, light/dark provider |
| `src/styles.css` | Base stylesheet — all colors come from tokens |
| `src/components.jsx` | Cards, stat tiles, tables, the date-range control |
| `src/charts.jsx` | Recharts wrappers with shared axis, tooltip and legend rules |
| `src/pages/` | One file per section |

## Design rules the charts follow

- One y-axis per plot — never a dual-axis chart.
- Categorical colors are assigned per entity, in a fixed order, so filtering the
  data never repaints the series that survive.
- The 8-slot palette is validated for colorblind separation and contrast against
  both the light and dark chart surfaces; anything past slot 8 falls back to a
  neutral.
- Status colors are reserved for alerts and always ship with a label, never
  color alone.
- Every plot has a hover tooltip, and every value is also reachable in a table.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run lint
```

Deployed from `main`.
