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

// --- DIXON-COLES CORRELATION FACTOR ---
// The rho parameter adjusts probabilities for low-scoring games
// Typical values range from -0.15 to 0.15
// Negative values increase correlation (more realistic for football)
const dixonColesAdjustment = (homeGoals, awayGoals, lambdaHome, lambdaAway, rho = -0.13) => {
    // Only apply adjustment to low-scoring outcomes
    if (homeGoals > 1 || awayGoals > 1) return 1;
    
    const adjustments = {
        '0,0': 1 - lambdaHome * lambdaAway * rho,
        '0,1': 1 + lambdaHome * rho,
        '1,0': 1 + lambdaAway * rho,
        '1,1': 1 - rho
    };
    
    return adjustments[`${homeGoals},${awayGoals}`] || 1;
};

// --- RESPONSE HELPER ---
const response = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
});

// --- HANDLER ---
exports.handler = async (event, context) => {
    console.log("Function invoked:", event.httpMethod, event.path);

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }

    // 1. Initialize DB
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error("DATABASE_URL is missing in environment variables.");
        return response(500, { error: "Server Configuration Error: DATABASE_URL missing. Check Netlify Site Settings." });
    }
    
    try {
        const sql = neon(dbUrl);
        const db = drizzle(sql, { schema });

        // 2. Parse Request
        let body = {};
        try {
            body = event.body ? JSON.parse(event.body) : {};
        } catch (e) {
            console.error("Failed to parse request body:", event.body);
            return response(400, { error: "Invalid JSON body" });
        }
        
        const { action, payload } = body;
        console.log("Action:", action);

        let result;

        switch (action) {
            case 'health':
                await db.select().from(leagues).limit(1);
                result = { status: "ok", message: "Database connected" };
                break;

            case 'getLeagues':
                result = await db.select().from(leagues).orderBy(asc(leagues.name));
                break;

            case 'getTeams':
                if (!payload?.leagueId) throw new Error("Missing leagueId");
                result = await db.select().from(teams)
                    .where(eq(teams.league_id, payload.leagueId))
                    .orderBy(asc(teams.name));
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
                const [leagueData] = await db.select().from(leagues).where(eq(leagues.id, payload.leagueId)).limit(1);
                const [homeTeam] = await db.select().from(teams).where(eq(teams.id, payload.homeTeamId)).limit(1);
                const [awayTeam] = await db.select().from(teams).where(eq(teams.id, payload.awayTeamId)).limit(1);

                if (!leagueData || !homeTeam || !awayTeam) throw new Error("Invalid selection - Data not found");

                const safeDiv = (num, den) => (den === 0 ? 0 : num / den);

                // Calculate attack and defense strengths
                const homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), leagueData.avg_home_goals);
                const awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), leagueData.avg_away_goals);
                const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), leagueData.avg_away_goals);
                const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), leagueData.avg_home_goals);

                // Expected goals (lambda parameters)
                const homeExpGoals = homeAttackStr * awayDefenseStr * leagueData.avg_home_goals;
                const awayExpGoals = awayAttackStr * homeDefenseStr * leagueData.avg_away_goals;

                // Get rho parameter from payload or use default
                const rho = payload.rho !== undefined ? payload.rho : -0.13;

                // Calculate probability matrices - both basic Poisson and Dixon-Coles
                const matrixSize = 6;
                const poissonMatrix = [];
                const dixonColesMatrix = [];
                
                let poissonHomeWin = 0, poissonDraw = 0, poissonAwayWin = 0;
                let dcHomeWin = 0, dcDraw = 0, dcAwayWin = 0;

                for (let h = 0; h < matrixSize; h++) {
                    const poissonRow = [];
                    const dcRow = [];
                    const probHome = poisson(h, homeExpGoals);
                    
                    for (let a = 0; a < matrixSize; a++) {
                        const probAway = poisson(a, awayExpGoals);
                        
                        // Basic Poisson probability
                        const poissonProb = probHome * probAway;
                        poissonRow.push({ h, a, prob: poissonProb });
                        
                        // Dixon-Coles adjusted probability
                        const adjustment = dixonColesAdjustment(h, a, homeExpGoals, awayExpGoals, rho);
                        const dcProb = poissonProb * adjustment;
                        dcRow.push({ h, a, prob: dcProb, adjustment });
                        
                        // Accumulate outcome probabilities
                        if (h > a) {
                            poissonHomeWin += poissonProb;
                            dcHomeWin += dcProb;
                        } else if (h === a) {
                            poissonDraw += poissonProb;
                            dcDraw += dcProb;
                        } else {
                            poissonAwayWin += poissonProb;
                            dcAwayWin += dcProb;
                        }
                    }
                    
                    poissonMatrix.push(poissonRow);
                    dixonColesMatrix.push(dcRow);
                }

                result = {
                    homeExpGoals,
                    awayExpGoals,
                    rho,
                    poisson: {
                        homeWinProb: poissonHomeWin,
                        drawProb: poissonDraw,
                        awayWinProb: poissonAwayWin,
                        matrix: poissonMatrix
                    },
                    dixonColes: {
                        homeWinProb: dcHomeWin,
                        drawProb: dcDraw,
                        awayWinProb: dcAwayWin,
                        matrix: dixonColesMatrix
                    },
                    // For backwards compatibility, use Dixon-Coles as default
                    homeWinProb: dcHomeWin,
                    drawProb: dcDraw,
                    awayWinProb: dcAwayWin,
                    matrix: dixonColesMatrix
                };
                break;

            default:
                return response(400, { error: "Invalid action" });
        }

        return response(200, result);

    } catch (error) {
        console.error("API Execution Error:", error);
        return response(500, { error: error.message || "Internal Server Error" });
    }
};