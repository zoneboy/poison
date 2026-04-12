# Auto-Sync from football-data.co.uk

## What Changed

### New file: `netlify/functions/sync.js`
A **Netlify Scheduled Function** that runs automatically every **Monday and Thursday at 06:00 UTC** (after weekend and midweek match rounds). It fetches CSV data from football-data.co.uk, computes all the stats your prediction model needs, and upserts everything into your Neon database.

### Updated file: `netlify/functions/api.js`
Three new actions added to your existing API:

| Action | Auth Required | Description |
|--------|--------------|-------------|
| `getSyncConfig` | No | Returns the list of configured leagues and their CSV URLs |
| `syncLeague` | Yes | Syncs a **single league** by code (e.g. `"E0"` for EPL) |
| `syncAll` | Yes | Syncs **all configured leagues** in one call |

### Updated file: `package.json`
Added `@netlify/functions` dependency (required for scheduled functions).

### `netlify.toml`
No changes needed — the schedule is defined inline in `sync.js` via `exports.config`.

---

## Configured Leagues

| Code | League | CSV Source |
|------|--------|-----------|
| E0 | English Premier League | `mmz4281/2526/E0.csv` |
| E1 | English Championship | `mmz4281/2526/E1.csv` |
| SP1 | Spanish La Liga | `mmz4281/2526/SP1.csv` |
| D1 | German Bundesliga | `mmz4281/2526/D1.csv` |
| I1 | Italian Serie A | `mmz4281/2526/I1.csv` |
| F1 | French Ligue 1 | `mmz4281/2526/F1.csv` |
| N1 | Dutch Eredivisie | `mmz4281/2526/N1.csv` |
| P1 | Portuguese Primeira Liga | `mmz4281/2526/P1.csv` |

To add/remove leagues, edit the `LEAGUE_CONFIG` object in **both** `sync.js` and `api.js`.

---

## How It Works

1. **Fetch** — Downloads the season CSV for each league from `football-data.co.uk`
2. **Parse** — Extracts match results (`HomeTeam`, `AwayTeam`, `FTHG`, `FTAG`, `FTR`)
3. **Compute** — Calculates:
   - **League averages**: avg home goals, avg away goals per match
   - **Team stats**: home/away goals for/against, games played
   - **Last 5 form**: most recent 5 matches per team with goals, result, home/away flag
4. **Upsert** — Writes to your existing `leagues`, `teams`, `match_history` tables
   - Existing leagues/teams are **updated** (matched by name)
   - New teams are **inserted**
   - Match history is **replaced** (deleted + re-inserted) each sync

---

## Deploy

1. Copy the files into your repo:
   ```
   netlify/functions/sync.js    (new)
   netlify/functions/api.js     (replace)
   package.json                 (replace)
   ```

2. Run `npm install` to pick up `@netlify/functions`

3. Push to your repo — Netlify will deploy automatically

4. After deploy, check the **Functions** tab in the Netlify dashboard. You should see `sync` with a "Scheduled" badge showing the next run time.

---

## Manual Sync from Admin Panel

You don't have to wait for the cron. Trigger syncs via your API:

**Sync a single league:**
```js
fetch('/.netlify/functions/api', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_ADMIN_API_KEY'
  },
  body: JSON.stringify({
    action: 'syncLeague',
    payload: { code: 'E0' }  // English Premier League
  })
})
```

**Sync all leagues:**
```js
fetch('/.netlify/functions/api', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_ADMIN_API_KEY'
  },
  body: JSON.stringify({
    action: 'syncAll',
    payload: {}
  })
})
```

**List available leagues:**
```js
fetch('/.netlify/functions/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'getSyncConfig' })
})
```

---

## Updating for Next Season

When the 2026/27 season starts, just update the `season` values in `LEAGUE_CONFIG`:

```js
const LEAGUE_CONFIG = {
    'E0':  { name: 'English Premier League', season: '2627' },
    // ...
};
```

The CSV URL pattern is: `https://www.football-data.co.uk/mmz4281/{season}/{code}.csv`

---

## Notes

- **football-data.co.uk updates twice weekly** (Sunday and Wednesday nights), so the Monday/Thursday schedule catches fresh data.
- The scheduled function has a **30-second timeout** (Netlify limit). With 8 leagues this should be fine, but if you add many more, consider splitting into batches.
- Your existing admin panel and manual data entry still work — synced data and manual data coexist. The sync matches leagues/teams **by name**, so manually-created entries with different names won't be overwritten.
- The `syncAll` API action may take 10-20 seconds for all 8 leagues. If you hit Netlify's 10s function timeout on the free tier, sync leagues one at a time using `syncLeague`.
