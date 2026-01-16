/* --- FILE: netlify/functions/api.js [AUTO] --- */
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

const matchHistory = pgTable('match_history', {
    id: serial('id').primaryKey(),
    team_id: integer('team_id').references(() => teams.id).notNull(),
    match_number: integer('match_number').notNull(), // 1-5 for last 5 matches
    goals_scored: integer('goals_scored').notNull(),
    goals_conceded: integer('goals_conceded').notNull(),
    was_home: integer('was_home').notNull(), 
    points: integer('points').notNull(),
});

const schema = { leagues, teams, matchHistory };

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

const bivariatePoissonProbability = (homeGoals, awayGoals, lambda1, lambda2, lambda3) => {
    const lambda3Safe = Math.max(0, Math.min(lambda3, lambda1, lambda2));
    const lambda1Star = lambda1 - lambda3Safe;
    const lambda2Star = lambda2 - lambda3Safe;
    let probability = 0;
    const minGoals = Math.min(homeGoals, awayGoals);
    
    for (let k = 0; k <= minGoals; k++) {
        const term1 = poisson(homeGoals - k, lambda1Star);
        const term2 = poisson(awayGoals - k, lambda2Star);
        const term3 = poisson(k, lambda3Safe);
        probability += term1 * term2 * term3;
    }
    return probability;
};

const estimateLambda3 = (homeExpGoals, awayExpGoals, leagueAvgHome, leagueAvgAway) => {
    const totalExpected = homeExpGoals + awayExpGoals;
    const leagueAvgTotal = leagueAvgHome + leagueAvgAway;
    if (totalExpected > leagueAvgTotal * 1.2) {
        return Math.min(0.15, homeExpGoals * 0.08, awayExpGoals * 0.08);
    } else if (totalExpected < leagueAvgTotal * 0.8) {
        return -0.05;
    } else {
        return 0.10;
    }
};

const linearRegression = (xValues, yValues) => {
    const n = xValues.length;
    if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
    
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
    
    // Check for division by zero (if all x are same)
    const denominator = (n * sumX2 - sumX * sumX);
    if (denominator === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    
    const meanY = sumY / n;
    const ssTotal = yValues.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const ssResidual = yValues.reduce((sum, y, i) => {
        const predicted = slope * xValues[i] + intercept;
        return sum + Math.pow(y - predicted, 2);
    }, 0);
    const r2 = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;
    
    return { slope, intercept, r2 };
};

// --- ANALYZE TEAM FORM (Enhanced with Goal Difference Regression) ---
const analyzeTeamForm = (matchHistory) => {
    if (!matchHistory || matchHistory.length === 0) {
        return {
            slope: 0, intercept: 0, r2: 0,
            trend: 'neutral', formModifier: 1.0,
            avgGoalsScored: 0, avgGoalsConceded: 0, avgPoints: 0,
            matchData: [], gdSlope: 0, predictedGD: 0
        };
    }
    
    const sorted = [...matchHistory].sort((a, b) => a.match_number - b.match_number);
    const xValues = sorted.map(m => m.match_number);
    const goalsScored = sorted.map(m => m.goals_scored);
    const goalsConceded = sorted.map(m => m.goals_conceded);
    const points = sorted.map(m => m.points);
    
    // NEW: Goal Difference Array
    const goalDiffs = sorted.map(m => m.goals_scored - m.goals_conceded);
    
    // 1. Regression on Goals Scored (for basic form modifier)
    const goalsRegression = linearRegression(xValues, goalsScored);
    
    // 2. Regression on Goal Difference (for advanced trend analysis)
    const gdRegression = linearRegression(xValues, goalDiffs);
    
    // Predict next match Goal Difference (x = length + 1)
    const nextMatchX = xValues.length + 1;
    const predictedGD = gdRegression.slope * nextMatchX + gdRegression.intercept;

    // Determine trend based on Goal Difference Slope
    let trend = 'neutral';
    let formModifier = 1.0;
    
    // Use GD slope for a more robust form check
    if (gdRegression.slope > 0.25) {
        trend = 'improving';
        formModifier = 1.0 + (gdRegression.slope * 0.4); // Boost
    } else if (gdRegression.slope < -0.25) {
        trend = 'declining';
        formModifier = 1.0 + (gdRegression.slope * 0.4); // Penalize
    }
    
    formModifier = Math.max(0.80, Math.min(1.20, formModifier));
    
    return {
        // Basic Stats
        avgGoalsScored: parseFloat((goalsScored.reduce((a, b) => a + b, 0) / goalsScored.length).toFixed(2)),
        avgGoalsConceded: parseFloat((goalsConceded.reduce((a, b) => a + b, 0) / goalsConceded.length).toFixed(2)),
        avgPoints: parseFloat((points.reduce((a, b) => a + b, 0) / points.length).toFixed(2)),
        
        // Goals Regression
        slope: parseFloat(goalsRegression.slope.toFixed(3)),
        
        // GD Regression (New)
        gdSlope: parseFloat(gdRegression.slope.toFixed(3)),
        gdIntercept: parseFloat(gdRegression.intercept.toFixed(3)),
        predictedGD: parseFloat(predictedGD.toFixed(2)),
        
        // Derived
        trend,
        formModifier: parseFloat(formModifier.toFixed(3)),
        
        // Data for Frontend
        matchData: sorted.map(m => ({
            matchNumber: m.match_number,
            goalsScored: m.goals_scored,
            goalsConceded: m.goals_conceded,
            goalDiff: m.goals_scored - m.goals_conceded,
            points: m.points,
            wasHome: m.was_home === 1
        }))
    };
};

const dixonColesAdjustment = (homeGoals, awayGoals, lambdaHome, lambdaAway, rho = -0.13) => {
    if (homeGoals > 1 || awayGoals > 1) return 1;
    const adjustments = {
        '0,0': 1 - lambdaHome * lambdaAway * rho,
        '0,1': 1 + lambdaHome * rho,
        '1,0': 1 + lambdaAway * rho,
        '1,1': 1 - rho
    };
    return adjustments[`${homeGoals},${awayGoals}`] || 1;
};

const analyzeTGL = (totalExpectedGoals, bookieLine = 2.5) => {
    const margin = 0.20;
    let recommendation = "", valueRating = "", confidence = "";
    const difference = totalExpectedGoals - bookieLine;
    const absDiff = Math.abs(difference);
    
    if (totalExpectedGoals > bookieLine + margin) {
        recommendation = "OVER";
        valueRating = absDiff > 0.5 ? "STRONG VALUE" : absDiff > 0.3 ? "GOOD VALUE" : "SLIGHT VALUE";
        confidence = absDiff > 0.5 ? "High" : "Medium";
    } else if (totalExpectedGoals < bookieLine - margin) {
        recommendation = "UNDER";
        valueRating = absDiff > 0.5 ? "STRONG VALUE" : absDiff > 0.3 ? "GOOD VALUE" : "SLIGHT VALUE";
        confidence = absDiff > 0.5 ? "High" : "Medium";
    } else {
        recommendation = "NO BET";
        valueRating = "LINE IS ACCURATE";
        confidence = "N/A";
    }
    
    return { totalExpectedGoals: parseFloat(totalExpectedGoals.toFixed(2)), bookieLine, difference: parseFloat(difference.toFixed(2)), recommendation, valueRating, confidence };
};

const calculateGoalLineProbabilities = (homeExpGoals, awayExpGoals, line = 2.5) => {
    const totalLambda = homeExpGoals + awayExpGoals;
    let overProb = 0, underProb = 0;
    for (let total = 0; total <= 15; total++) {
        let probTotal = 0;
        for (let h = 0; h <= total; h++) {
            const a = total - h;
            probTotal += poisson(h, homeExpGoals) * poisson(a, awayExpGoals);
        }
        if (total > line) overProb += probTotal;
        else underProb += probTotal;
    }
    return { overProbability: parseFloat((overProb * 100).toFixed(2)), underProbability: parseFloat((underProb * 100).toFixed(2)), impliedOverOdds: overProb > 0 ? parseFloat((1 / overProb).toFixed(2)) : null, impliedUnderOdds: underProb > 0 ? parseFloat((1 / underProb).toFixed(2)) : null };
};

const analyzeBTTS = (homeExpGoals, awayExpGoals, lambda3, bookieBTTSOdds = 1.80) => {
    const prob_0_0_Biv = bivariatePoissonProbability(0, 0, homeExpGoals, awayExpGoals, lambda3);
    let probHomeZero_Biv = 0;
    for (let k = 0; k <= 10; k++) probHomeZero_Biv += bivariatePoissonProbability(0, k, homeExpGoals, awayExpGoals, lambda3);
    let probAwayZero_Biv = 0;
    for (let k = 0; k <= 10; k++) probAwayZero_Biv += bivariatePoissonProbability(k, 0, homeExpGoals, awayExpGoals, lambda3);
    
    const probAtLeastOneZero_Biv = probHomeZero_Biv + probAwayZero_Biv - prob_0_0_Biv;
    const probBTTS_Yes_Biv = 1 - probAtLeastOneZero_Biv;
    const probBTTS_No_Biv = probAtLeastOneZero_Biv;
    const fairOddsBTTS_Yes = probBTTS_Yes_Biv > 0 ? 1 / probBTTS_Yes_Biv : null;
    
    let recommendation = "NO BET", valueRating = "NO CLEAR VALUE", confidence = "N/A", expectedValue = 0;
    if (bookieBTTSOdds && fairOddsBTTS_Yes) {
        const valueDiffYes = bookieBTTSOdds - fairOddsBTTS_Yes;
        expectedValue = valueDiffYes;
        if (valueDiffYes > 0.15) { recommendation = "BET BTTS YES"; valueRating = "GOOD VALUE"; confidence = "Medium"; }
        else if (valueDiffYes < -0.20) { recommendation = "CONSIDER BTTS NO"; valueRating = "UNDERPRICED YES"; }
    }
    
    return { probBTTS_Yes: parseFloat((probBTTS_Yes_Biv * 100).toFixed(2)), probBTTS_No: parseFloat((probBTTS_No_Biv * 100).toFixed(2)), probHomeZero: parseFloat((probHomeZero_Biv * 100).toFixed(2)), probAwayZero: parseFloat((probAwayZero_Biv * 100).toFixed(2)), lambda3: parseFloat(lambda3.toFixed(3)), modelType: lambda3 !== 0 ? "Bivariate Poisson" : "Independent Poisson", fairOddsBTTS_Yes: fairOddsBTTS_Yes ? parseFloat(fairOddsBTTS_Yes.toFixed(2)) : null, bookieOddsYes: bookieBTTSOdds, expectedValue: parseFloat(expectedValue.toFixed(2)), recommendation, valueRating, confidence };
};

const response = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    body: JSON.stringify(body)
});

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') return response(200, { message: 'OK' });

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return response(500, { error: "DATABASE_URL missing" });
    
    try {
        const sql = neon(dbUrl);
        const db = drizzle(sql, { schema });
        let body = {};
        try { body = event.body ? JSON.parse(event.body) : {}; } catch { return response(400, { error: "Invalid JSON body" }); }
        
        const { action, payload } = body;
        
        // --- SECURITY CHECK (Basic API Key for Writes) ---
        const WRITE_ACTIONS = ['createLeague', 'updateLeague', 'createTeam', 'updateTeam', 'deleteTeam', 'saveMatchHistory'];
        if (WRITE_ACTIONS.includes(action)) {
            const authHeader = event.headers['authorization'] || event.headers['Authorization'];
            // In a real app, use: process.env.ADMIN_API_KEY
            // For this prototype, we'll allow a specific header or check the PIN from the payload if passed
            // Simplification: If you are copying this, assume the frontend sends the key if needed.
            // For now, we will proceed to allow testing unless you set ADMIN_API_KEY env var.
            if (process.env.ADMIN_API_KEY && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
                return response(401, { error: "Unauthorized" });
            }
        }

        let result;
        switch (action) {
            case 'health':
                await db.select().from(leagues).limit(1);
                result = { status: "ok" };
                break;
            case 'getLeagues':
                result = await db.select().from(leagues).orderBy(asc(leagues.name));
                break;
            case 'getTeams':
                if (!payload?.leagueId) throw new Error("Missing leagueId");
                result = await db.select().from(teams).where(eq(teams.league_id, payload.leagueId)).orderBy(asc(teams.name));
                break;
            case 'getMatchHistory':
                if (!payload?.teamId) throw new Error("Missing teamId");
                result = await db.select().from(matchHistory).where(eq(matchHistory.team_id, payload.teamId)).orderBy(asc(matchHistory.match_number));
                break;
            case 'saveMatchHistory':
                await db.delete(matchHistory).where(eq(matchHistory.team_id, payload.teamId));
                if (payload.matches?.length > 0) {
                    await db.insert(matchHistory).values(payload.matches.map(m => ({
                        team_id: payload.teamId, match_number: m.match_number, goals_scored: m.goals_scored, goals_conceded: m.goals_conceded, was_home: m.was_home, points: m.points
                    })));
                }
                result = { success: true };
                break;
            case 'createLeague':
                await db.insert(leagues).values({ name: payload.name, avg_home_goals: payload.avgHome, avg_away_goals: payload.avgAway });
                result = { success: true };
                break;
            case 'updateLeague':
                await db.update(leagues).set({ name: payload.name, avg_home_goals: payload.avgHome, avg_away_goals: payload.avgAway }).where(eq(leagues.id, payload.id));
                result = { success: true };
                break;
            case 'createTeam':
                await db.insert(teams).values({ league_id: parseInt(payload.league_id), name: payload.name, home_goals_for: parseInt(payload.home_goals_for), home_goals_against: parseInt(payload.home_goals_against), home_games_played: parseInt(payload.home_games_played), away_goals_for: parseInt(payload.away_goals_for), away_goals_against: parseInt(payload.away_goals_against), away_games_played: parseInt(payload.away_games_played) });
                result = { success: true };
                break;
            case 'updateTeam':
                await db.update(teams).set({ league_id: parseInt(payload.league_id), name: payload.name, home_goals_for: parseInt(payload.home_goals_for), home_goals_against: parseInt(payload.home_goals_against), home_games_played: parseInt(payload.home_games_played), away_goals_for: parseInt(payload.away_goals_for), away_goals_against: parseInt(payload.away_goals_against), away_games_played: parseInt(payload.away_games_played) }).where(eq(teams.id, payload.id));
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

                const homeHistory = await db.select().from(matchHistory).where(eq(matchHistory.team_id, payload.homeTeamId)).orderBy(asc(matchHistory.match_number));
                const awayHistory = await db.select().from(matchHistory).where(eq(matchHistory.team_id, payload.awayTeamId)).orderBy(asc(matchHistory.match_number));

                const homeForm = analyzeTeamForm(homeHistory);
                const awayForm = analyzeTeamForm(awayHistory);
                
                // --- LINEAR REGRESSION ADJUSTMENT ---
                // Dampen the effect: (Home Predicted GD - Away Predicted GD) / 2
                // e.g. Home (+1.5) - Away (-0.5) = +2.0 diff -> +1.0 Goals adjustment total
                const regressionAdjustment = (homeForm.predictedGD - awayForm.predictedGD) / 4; // Conservative divisor

                const safeDiv = (num, den) => (den === 0 ? 0 : num / den);
                let homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), leagueData.avg_home_goals);
                let awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), leagueData.avg_away_goals);
                const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), leagueData.avg_away_goals);
                const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), leagueData.avg_home_goals);

                homeAttackStr *= homeForm.formModifier;
                awayAttackStr *= awayForm.formModifier;

                let homeExpGoals = homeAttackStr * awayDefenseStr * leagueData.avg_home_goals;
                let awayExpGoals = awayAttackStr * homeDefenseStr * leagueData.avg_away_goals;
                
                // Apply the GD Regression Prediction
                // We add/subtract a small factor based on the predicted next match goal diff
                homeExpGoals += regressionAdjustment;
                awayExpGoals -= regressionAdjustment;
                
                // Safety clamps
                homeExpGoals = Math.max(0.1, homeExpGoals);
                awayExpGoals = Math.max(0.1, awayExpGoals);

                const totalExpectedGoals = homeExpGoals + awayExpGoals;
                const rho = payload.rho !== undefined ? payload.rho : -0.13;
                const goalLine = payload.goalLine !== undefined ? payload.goalLine : 2.5;
                const bttsOdds = payload.bttsOdds !== undefined ? payload.bttsOdds : 1.80;
                const lambda3 = payload.lambda3 !== undefined ? payload.lambda3 : estimateLambda3(homeExpGoals, awayExpGoals, leagueData.avg_home_goals, leagueData.avg_away_goals);

                const matrixSize = 6;
                const dixonColesMatrix = [];
                let dcHomeWin = 0, dcDraw = 0, dcAwayWin = 0;

                for (let h = 0; h < matrixSize; h++) {
                    const row = [];
                    const probHome = poisson(h, homeExpGoals);
                    for (let a = 0; a < matrixSize; a++) {
                        const probAway = poisson(a, awayExpGoals);
                        const adjustment = dixonColesAdjustment(h, a, homeExpGoals, awayExpGoals, rho);
                        const prob = probHome * probAway * adjustment;
                        row.push({ h, a, prob });
                        if (h > a) dcHomeWin += prob; else if (h === a) dcDraw += prob; else dcAwayWin += prob;
                    }
                    dixonColesMatrix.push(row);
                }

                const tglAnalysis = analyzeTGL(totalExpectedGoals, goalLine);
                const goalLineProbabilities = calculateGoalLineProbabilities(homeExpGoals, awayExpGoals, goalLine);
                const bttsAnalysis = analyzeBTTS(homeExpGoals, awayExpGoals, lambda3, bttsOdds);

                result = {
                    homeExpGoals: parseFloat(homeExpGoals.toFixed(2)), awayExpGoals: parseFloat(awayExpGoals.toFixed(2)), totalExpectedGoals: parseFloat(totalExpectedGoals.toFixed(2)), rho, lambda3,
                    homeForm, awayForm, regressionAdjustment: parseFloat(regressionAdjustment.toFixed(2)),
                    homeWinProb: dcHomeWin, drawProb: dcDraw, awayWinProb: dcAwayWin, matrix: dixonColesMatrix,
                    trueGoalLine: { ...tglAnalysis, ...goalLineProbabilities }, btts: bttsAnalysis
                };
                break;
            default: return response(400, { error: "Invalid action" });
        }
        return response(200, result);
    } catch (error) {
        console.error("API Execution Error:", error);
        return response(500, { error: error.message || "Internal Server Error" });
    }
};