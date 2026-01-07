const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const { pgTable, serial, text, real, integer } = require('drizzle-orm/pg-core');
const { eq, asc } = require('drizzle-orm');

// --- SCHEMA DEFINITION ---
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

const schema = { leagues, teams };

// --- MATH HELPERS ---
const factorial = (n) => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
};

const poisson = (k, lambda) => {
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
};

// --- HANDLER ---
exports.handler = async (event, context) => {
    // 1. Initialize DB
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server Configuration Error: DATABASE_URL missing" }) };
    }
    
    const sql = neon(dbUrl);
    const db = drizzle(sql, { schema });

    // 2. Parse Request
    const body = event.body ? JSON.parse(event.body) : {};
    const { action, payload } = body;

    try {
        let result;

        switch (action) {
            case 'getLeagues':
                result = await db.select().from(leagues).orderBy(asc(leagues.name));
                break;

            case 'getTeams':
                result = await db.select().from(teams).where(eq(teams.league_id, payload.leagueId)).orderBy(asc(teams.name));
                break;

            case 'createLeague':
                await db.insert(leagues).values({
                    name: payload.name,
                    avg_home_goals: payload.avgHome,
                    avg_away_goals: payload.avgAway
                });
                result = { success: true };
                break;

            case 'updateLeague':
                await db.update(leagues).set({
                    name: payload.name,
                    avg_home_goals: payload.avgHome,
                    avg_away_goals: payload.avgAway
                }).where(eq(leagues.id, payload.id));
                result = { success: true };
                break;

            case 'createTeam':
                await db.insert(teams).values({
                    league_id: parseInt(payload.league_id),
                    name: payload.name,
                    home_goals_for: parseInt(payload.home_goals_for),
                    home_goals_against: parseInt(payload.home_goals_against),
                    home_games_played: parseInt(payload.home_games_played),
                    away_goals_for: parseInt(payload.away_goals_for),
                    away_goals_against: parseInt(payload.away_goals_against),
                    away_games_played: parseInt(payload.away_games_played)
                });
                result = { success: true };
                break;

            case 'updateTeam':
                await db.update(teams).set({
                    league_id: parseInt(payload.league_id),
                    name: payload.name,
                    home_goals_for: parseInt(payload.home_goals_for),
                    home_goals_against: parseInt(payload.home_goals_against),
                    home_games_played: parseInt(payload.home_games_played),
                    away_goals_for: parseInt(payload.away_goals_for),
                    away_goals_against: parseInt(payload.away_goals_against),
                    away_games_played: parseInt(payload.away_games_played)
                }).where(eq(teams.id, payload.id));
                result = { success: true };
                break;

            case 'deleteTeam':
                await db.delete(teams).where(eq(teams.id, payload.teamId));
                result = { success: true };
                break;

            case 'predict':
                const leagueData = await db.query.leagues.findFirst({ where: eq(leagues.id, payload.leagueId) });
                const homeTeam = await db.query.teams.findFirst({ where: eq(teams.id, payload.homeTeamId) });
                const awayTeam = await db.query.teams.findFirst({ where: eq(teams.id, payload.awayTeamId) });

                if (!leagueData || !homeTeam || !awayTeam) throw new Error("Invalid selection");

                const safeDiv = (num, den) => (den === 0 ? 0 : num / den);

                // Strengths
                const homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), leagueData.avg_home_goals);
                const awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), leagueData.avg_away_goals);
                const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), leagueData.avg_away_goals);
                const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), leagueData.avg_home_goals);

                // Expected Goals
                const homeExpGoals = homeAttackStr * awayDefenseStr * leagueData.avg_home_goals;
                const awayExpGoals = awayAttackStr * homeDefenseStr * leagueData.avg_away_goals;

                // Matrix
                const matrixSize = 6;
                const matrix = [];
                let homeWinProb = 0;
                let drawProb = 0;
                let awayWinProb = 0;

                for (let h = 0; h < matrixSize; h++) {
                    const row = [];
                    const probHome = poisson(h, homeExpGoals);
                    for (let a = 0; a < matrixSize; a++) {
                        const probAway = poisson(a, awayExpGoals);
                        const cellProb = probHome * probAway;
                        row.push({ h, a, prob: cellProb });
                        if (h > a) homeWinProb += cellProb;
                        else if (h === a) drawProb += cellProb;
                        else awayWinProb += cellProb;
                    }
                    matrix.push(row);
                }

                result = { homeExpGoals, awayExpGoals, homeWinProb, drawProb, awayWinProb, matrix };
                break;

            default:
                return { statusCode: 400, body: JSON.stringify({ error: "Invalid action" }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error("API Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || "Internal Server Error" })
        };
    }
};
