const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const { pgTable, serial, text, real, integer } = require('drizzle-orm/pg-core');
const { eq, and, asc } = require('drizzle-orm');

// --- SCHEMA (must match api.js) ---
const leagues = pgTable('leagues', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    avg_home_goals: real('avg_home_goals').notNull(),
    avg_away_goals: real('avg_away_goals').notNull(),
});

const teams = pgTable('teams', {
    id: serial('id').primaryKey(),
    league_id: integer('league_id').references(() => leagues.id).notNull(),
    name: text('name').notNull(),
    home_goals_for: integer('home_goals_for').notNull(),
    home_goals_against: integer('home_goals_against').notNull(),
    home_games_played: integer('home_games_played').notNull(),
    away_goals_for: integer('away_goals_for').notNull(),
    away_goals_against: integer('away_goals_against').notNull(),
    away_games_played: integer('away_games_played').notNull(),
});

const matchHistory = pgTable('match_history', {
    id: serial('id').primaryKey(),
    team_id: integer('team_id').references(() => teams.id).notNull(),
    match_number: integer('match_number').notNull(),
    goals_scored: integer('goals_scored').notNull(),
    goals_conceded: integer('goals_conceded').notNull(),
    was_home: integer('was_home').notNull(),
    points: integer('points').notNull(),
});

const schema = { leagues, teams, matchHistory };

// =====================================================================
// LEAGUE CONFIGURATION — ALL football-data.co.uk leagues
// type: 'main' = season-by-season files (mmz4281/SEASON/CODE.csv)
// type: 'extra' = all-seasons file (new/CODE.csv), filtered by Season column
// =====================================================================
const LEAGUE_CONFIG = {
    // --- ENGLAND ---
    'E0':  { name: 'English Premier League',       season: '2526', type: 'main' },
    'E1':  { name: 'English Championship',          season: '2526', type: 'main' },
    'E2':  { name: 'English League One',             season: '2526', type: 'main' },
    'E3':  { name: 'English League Two',             season: '2526', type: 'main' },
    'EC':  { name: 'English National League',        season: '2526', type: 'main' },
    // --- SCOTLAND ---
    'SC0': { name: 'Scottish Premiership',           season: '2526', type: 'main' },
    'SC1': { name: 'Scottish Championship',          season: '2526', type: 'main' },
    'SC2': { name: 'Scottish League One',            season: '2526', type: 'main' },
    'SC3': { name: 'Scottish League Two',            season: '2526', type: 'main' },
    // --- GERMANY ---
    'D1':  { name: 'German Bundesliga',              season: '2526', type: 'main' },
    'D2':  { name: 'German Bundesliga 2',            season: '2526', type: 'main' },
    // --- SPAIN ---
    'SP1': { name: 'Spanish La Liga',                season: '2526', type: 'main' },
    'SP2': { name: 'Spanish La Liga 2',              season: '2526', type: 'main' },
    // --- ITALY ---
    'I1':  { name: 'Italian Serie A',                season: '2526', type: 'main' },
    'I2':  { name: 'Italian Serie B',                season: '2526', type: 'main' },
    // --- FRANCE ---
    'F1':  { name: 'French Ligue 1',                 season: '2526', type: 'main' },
    'F2':  { name: 'French Ligue 2',                 season: '2526', type: 'main' },
    // --- OTHER EUROPEAN ---
    'N1':  { name: 'Dutch Eredivisie',               season: '2526', type: 'main' },
    'B1':  { name: 'Belgian Pro League',             season: '2526', type: 'main' },
    'P1':  { name: 'Portuguese Primeira Liga',       season: '2526', type: 'main' },
    'T1':  { name: 'Turkish Super Lig',              season: '2526', type: 'main' },
    'G1':  { name: 'Greek Super League',             season: '2526', type: 'main' },
    // --- EXTRA WORLDWIDE LEAGUES ---
    'ARG': { name: 'Argentine Primera Division',     season: '2025',       type: 'extra' },
    'AUT': { name: 'Austrian Bundesliga',            season: '2025/2026',  type: 'extra' },
    'BRA': { name: 'Brazilian Serie A',              season: '2025',       type: 'extra' },
    'CHN': { name: 'Chinese Super League',           season: '2025',       type: 'extra' },
    'DNK': { name: 'Danish Superliga',               season: '2025/2026',  type: 'extra' },
    'FIN': { name: 'Finnish Veikkausliiga',          season: '2025',       type: 'extra' },
    'IRL': { name: 'Irish Premier Division',         season: '2025',       type: 'extra' },
    'JPN': { name: 'Japanese J-League',              season: '2025',       type: 'extra' },
    'MEX': { name: 'Mexican Liga MX',               season: '2025/2026',  type: 'extra' },
    'NOR': { name: 'Norwegian Eliteserien',          season: '2025',       type: 'extra' },
    'POL': { name: 'Polish Ekstraklasa',             season: '2025/2026',  type: 'extra' },
    'ROU': { name: 'Romanian Liga 1',               season: '2025/2026',  type: 'extra' },
    'RUS': { name: 'Russian Premier League',         season: '2025/2026',  type: 'extra' },
    'SWE': { name: 'Swedish Allsvenskan',            season: '2025',       type: 'extra' },
    'SWZ': { name: 'Swiss Super League',             season: '2025/2026',  type: 'extra' },
    'USA': { name: 'American MLS',                   season: '2025',       type: 'extra' },
};

// Number of most recent matches to store for form analysis
const FORM_MATCHES = 5;

// =====================================================================
// CSV FETCHING & PARSING
// =====================================================================

const buildCsvUrl = (code, season, type) =>
    type === 'extra'
        ? `https://www.football-data.co.uk/new/${code}.csv`
        : `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;

const fetchCsv = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const text = await res.text();
    return text;
};

const parseCsv = (csvText) => {
    // Split into lines, handle \r\n and \n
    const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Remove BOM if present
    let headerLine = lines[0];
    if (headerLine.charCodeAt(0) === 0xFEFF) headerLine = headerLine.slice(1);

    const headers = headerLine.split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx]?.trim() ?? '';
        });
        rows.push(row);
    }
    return rows;
};

// =====================================================================
// DATA PROCESSING — Turn CSV rows into your DB schema
// =====================================================================

// Normalize column names: extra leagues use Home/Away/HG/AG/Res instead of HomeTeam/AwayTeam/FTHG/FTAG/FTR
const normalizeRow = (m) => ({
    ...m,
    HomeTeam: m.HomeTeam || m.Home || '',
    AwayTeam: m.AwayTeam || m.Away || '',
    FTHG: m.FTHG || m.HG || '',
    FTAG: m.FTAG || m.AG || '',
    FTR: m.FTR || m.Res || '',
});

const processLeagueData = (matches) => {
    // Normalize columns and filter to only completed matches
    const normalized = matches.map(normalizeRow);
    const completed = normalized.filter(m =>
        m.FTHG !== '' && m.FTAG !== '' && m.FTR !== '' && !isNaN(parseInt(m.FTHG)) && !isNaN(parseInt(m.FTAG))
    );

    if (completed.length === 0) return null;

    // --- League averages ---
    let totalHomeGoals = 0;
    let totalAwayGoals = 0;

    completed.forEach(m => {
        totalHomeGoals += parseInt(m.FTHG);
        totalAwayGoals += parseInt(m.FTAG);
    });

    const avgHomeGoals = parseFloat((totalHomeGoals / completed.length).toFixed(4));
    const avgAwayGoals = parseFloat((totalAwayGoals / completed.length).toFixed(4));

    // --- Per-team stats ---
    const teamStats = {};

    const ensureTeam = (name) => {
        if (!teamStats[name]) {
            teamStats[name] = {
                name,
                home_goals_for: 0, home_goals_against: 0, home_games_played: 0,
                away_goals_for: 0, away_goals_against: 0, away_games_played: 0,
                // Chronological match list for form
                allMatches: [],
            };
        }
    };

    completed.forEach((m, idx) => {
        const home = m.HomeTeam;
        const away = m.AwayTeam;
        const hg = parseInt(m.FTHG);
        const ag = parseInt(m.FTAG);
        const result = m.FTR; // H, D, A

        ensureTeam(home);
        ensureTeam(away);

        // Aggregate home stats
        teamStats[home].home_goals_for += hg;
        teamStats[home].home_goals_against += ag;
        teamStats[home].home_games_played += 1;

        // Aggregate away stats
        teamStats[away].away_goals_for += ag;
        teamStats[away].away_goals_against += hg;
        teamStats[away].away_games_played += 1;

        // Points: W=3, D=1, L=0
        let homePoints = result === 'H' ? 3 : result === 'D' ? 1 : 0;
        let awayPoints = result === 'A' ? 3 : result === 'D' ? 1 : 0;

        // Store match records with ordering index for chronology
        teamStats[home].allMatches.push({
            order: idx, goals_scored: hg, goals_conceded: ag, was_home: 1, points: homePoints
        });
        teamStats[away].allMatches.push({
            order: idx, goals_scored: ag, goals_conceded: hg, was_home: 0, points: awayPoints
        });
    });

    // Extract last N matches for each team (sorted chronologically)
    Object.values(teamStats).forEach(t => {
        t.allMatches.sort((a, b) => a.order - b.order);
        const recent = t.allMatches.slice(-FORM_MATCHES);
        t.formMatches = recent.map((m, i) => ({
            match_number: i + 1,
            goals_scored: m.goals_scored,
            goals_conceded: m.goals_conceded,
            was_home: m.was_home,
            points: m.points,
        }));
        delete t.allMatches; // clean up
    });

    return { avgHomeGoals, avgAwayGoals, teams: teamStats };
};

// =====================================================================
// DATABASE SYNC — Upsert league, teams, and match history
// =====================================================================

const syncLeague = async (db, leagueCode, leagueName, data) => {
    const { avgHomeGoals, avgAwayGoals, teams: teamData } = data;

    // --- Upsert league ---
    const existingLeagues = await db.select().from(leagues);
    let league = existingLeagues.find(l => l.name === leagueName);

    if (league) {
        await db.update(leagues).set({
            avg_home_goals: avgHomeGoals,
            avg_away_goals: avgAwayGoals,
        }).where(eq(leagues.id, league.id));
    } else {
        const inserted = await db.insert(leagues).values({
            name: leagueName,
            avg_home_goals: avgHomeGoals,
            avg_away_goals: avgAwayGoals,
        }).returning();
        league = inserted[0];
    }

    const leagueId = league.id;

    // --- Upsert teams ---
    const existingTeams = await db.select().from(teams).where(eq(teams.league_id, leagueId));
    const existingTeamMap = {};
    existingTeams.forEach(t => { existingTeamMap[t.name] = t; });

    for (const teamName of Object.keys(teamData)) {
        const t = teamData[teamName];
        const existing = existingTeamMap[teamName];

        let teamId;
        if (existing) {
            await db.update(teams).set({
                home_goals_for: t.home_goals_for,
                home_goals_against: t.home_goals_against,
                home_games_played: t.home_games_played,
                away_goals_for: t.away_goals_for,
                away_goals_against: t.away_goals_against,
                away_games_played: t.away_games_played,
            }).where(eq(teams.id, existing.id));
            teamId = existing.id;
        } else {
            const inserted = await db.insert(teams).values({
                league_id: leagueId,
                name: teamName,
                home_goals_for: t.home_goals_for,
                home_goals_against: t.home_goals_against,
                home_games_played: t.home_games_played,
                away_goals_for: t.away_goals_for,
                away_goals_against: t.away_goals_against,
                away_games_played: t.away_games_played,
            }).returning();
            teamId = inserted[0].id;
        }

        // --- Replace match history ---
        await db.delete(matchHistory).where(eq(matchHistory.team_id, teamId));
        if (t.formMatches && t.formMatches.length > 0) {
            await db.insert(matchHistory).values(
                t.formMatches.map(m => ({
                    team_id: teamId,
                    match_number: m.match_number,
                    goals_scored: m.goals_scored,
                    goals_conceded: m.goals_conceded,
                    was_home: m.was_home,
                    points: m.points,
                }))
            );
        }
    }

    return { leagueId, teamsCount: Object.keys(teamData).length };
};

// =====================================================================
// MAIN HANDLER
// =====================================================================

exports.handler = async (event, context) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL missing');
        return { statusCode: 500, body: JSON.stringify({ error: 'DATABASE_URL missing' }) };
    }

    const sql = neon(dbUrl);
    const db = drizzle(sql, { schema });

    const results = [];
    const errors = [];

    for (const [code, config] of Object.entries(LEAGUE_CONFIG)) {
        const url = buildCsvUrl(code, config.season, config.type);
        try {
            console.log(`[SYNC] Fetching ${config.name} from ${url}`);
            const csvText = await fetchCsv(url);
            let matches = parseCsv(csvText);

            // Extra leagues have all seasons in one file — filter to current season
            if (config.type === 'extra' && matches.length > 0 && matches[0].Season !== undefined) {
                matches = matches.filter(m => m.Season === config.season);
            }

            console.log(`[SYNC] Parsed ${matches.length} rows for ${config.name}`);

            const data = processLeagueData(matches);
            if (!data) {
                console.warn(`[SYNC] No completed matches for ${config.name}, skipping`);
                errors.push({ league: config.name, error: 'No completed matches' });
                continue;
            }

            const syncResult = await syncLeague(db, code, config.name, data);
            console.log(`[SYNC] ${config.name}: synced ${syncResult.teamsCount} teams (league ID: ${syncResult.leagueId})`);
            results.push({
                league: config.name,
                code,
                teamsCount: syncResult.teamsCount,
                avgHomeGoals: data.avgHomeGoals,
                avgAwayGoals: data.avgAwayGoals,
            });
        } catch (err) {
            console.error(`[SYNC] Error syncing ${config.name}:`, err.message);
            errors.push({ league: config.name, code, error: err.message });
        }
    }

    const summary = {
        syncedAt: new Date().toISOString(),
        leaguesSynced: results.length,
        errors: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
    };

    console.log('[SYNC] Complete:', JSON.stringify(summary, null, 2));

    return {
        statusCode: 200,
        body: JSON.stringify(summary),
    };
};

// --- Netlify Scheduled Function config ---
// Runs Monday & Thursday at 06:00 UTC (after weekend & midweek matches)
exports.config = {
    schedule: '0 6 * * 1,4',
};
