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
    was_home: integer('was_home').notNull(), // 1 for home, 0 for away
    points: integer('points').notNull(), // 3 for win, 1 for draw, 0 for loss
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

// --- BIVARIATE POISSON MODEL ---
// Models dependency between home and away goals using covariance parameter lambda3
const bivariatePoissonProbability = (homeGoals, awayGoals, lambda1, lambda2, lambda3) => {
    // lambda1 = independent home goals parameter
    // lambda2 = independent away goals parameter
    // lambda3 = covariance parameter (dependency between home and away)
    
    // Ensure lambda3 is non-negative and doesn't exceed min(lambda1, lambda2)
    const lambda3Safe = Math.max(0, Math.min(lambda3, lambda1, lambda2));
    
    // Adjusted parameters for independent components
    const lambda1Star = lambda1 - lambda3Safe;
    const lambda2Star = lambda2 - lambda3Safe;
    
    let probability = 0;
    
    // Sum over all possible values of the common component
    const minGoals = Math.min(homeGoals, awayGoals);
    
    for (let k = 0; k <= minGoals; k++) {
        const term1 = poisson(homeGoals - k, lambda1Star);
        const term2 = poisson(awayGoals - k, lambda2Star);
        const term3 = poisson(k, lambda3Safe);
        
        probability += term1 * term2 * term3;
    }
    
    return probability;
};

// --- ESTIMATE LAMBDA3 FROM LEAGUE DATA ---
// Covariance typically ranges from -0.1 to 0.3
// Negative covariance = anti-correlation (one team scoring reduces other's chances)
// Positive covariance = correlation (high-scoring games)
const estimateLambda3 = (homeExpGoals, awayExpGoals, leagueAvgHome, leagueAvgAway) => {
    // Default approach: slight positive covariance for attacking games
    // Typical football shows small positive correlation (0.05 to 0.15)
    
    const totalExpected = homeExpGoals + awayExpGoals;
    const leagueAvgTotal = leagueAvgHome + leagueAvgAway;
    
    // Higher scoring games tend to have more dependency
    if (totalExpected > leagueAvgTotal * 1.2) {
        // High-scoring game expected: moderate positive covariance
        return Math.min(0.15, homeExpGoals * 0.08, awayExpGoals * 0.08);
    } else if (totalExpected < leagueAvgTotal * 0.8) {
        // Low-scoring game expected: slight negative covariance
        return -0.05;
    } else {
        // Average game: small positive covariance
        return 0.10;
    }
};

// --- LINEAR REGRESSION FOR FORM ANALYSIS ---
const linearRegression = (xValues, yValues) => {
    const n = xValues.length;
    if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
    
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = yValues.reduce((sum, y) => sum + y * y, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    const meanY = sumY / n;
    const ssTotal = yValues.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const ssResidual = yValues.reduce((sum, y, i) => {
        const predicted = slope * xValues[i] + intercept;
        return sum + Math.pow(y - predicted, 2);
    }, 0);
    const r2 = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;
    
    return { slope, intercept, r2 };
};

// --- ANALYZE TEAM FORM FROM MATCH HISTORY ---
const analyzeTeamForm = (matchHistory) => {
    if (!matchHistory || matchHistory.length === 0) {
        return {
            slope: 0,
            intercept: 0,
            r2: 0,
            trend: 'neutral',
            formModifier: 1.0,
            avgGoalsScored: 0,
            avgGoalsConceded: 0,
            avgPoints: 0,
            matchData: []
        };
    }
    
    // Sort by match number (oldest first)
    const sorted = [...matchHistory].sort((a, b) => a.match_number - b.match_number);
    
    // X values: match numbers (1, 2, 3, 4, 5, 6)
    const xValues = sorted.map(m => m.match_number);
    
    // Y values: performance metric (goals scored)
    const goalsScored = sorted.map(m => m.goals_scored);
    const goalsConceded = sorted.map(m => m.goals_conceded);
    const points = sorted.map(m => m.points);
    
    // Calculate regression on goals scored
    const goalsRegression = linearRegression(xValues, goalsScored);
    
    // Calculate regression on points
    const pointsRegression = linearRegression(xValues, points);
    
    // Determine trend based on slope
    let trend = 'neutral';
    let formModifier = 1.0;
    
    if (goalsRegression.slope > 0.15) {
        trend = 'improving';
        formModifier = 1.0 + (goalsRegression.slope * 0.5); // Boost up to 1.15
    } else if (goalsRegression.slope < -0.15) {
        trend = 'declining';
        formModifier = 1.0 + (goalsRegression.slope * 0.5); // Reduce down to 0.85
    }
    
    // Cap the modifier to reasonable bounds
    formModifier = Math.max(0.85, Math.min(1.15, formModifier));
    
    return {
        slope: parseFloat(goalsRegression.slope.toFixed(3)),
        intercept: parseFloat(goalsRegression.intercept.toFixed(3)),
        r2: parseFloat(goalsRegression.r2.toFixed(3)),
        pointsSlope: parseFloat(pointsRegression.slope.toFixed(3)),
        trend,
        formModifier: parseFloat(formModifier.toFixed(3)),
        avgGoalsScored: parseFloat((goalsScored.reduce((a, b) => a + b, 0) / goalsScored.length).toFixed(2)),
        avgGoalsConceded: parseFloat((goalsConceded.reduce((a, b) => a + b, 0) / goalsConceded.length).toFixed(2)),
        avgPoints: parseFloat((points.reduce((a, b) => a + b, 0) / points.length).toFixed(2)),
        matchData: sorted.map(m => ({
            matchNumber: m.match_number,
            goalsScored: m.goals_scored,
            goalsConceded: m.goals_conceded,
            points: m.points,
            wasHome: m.was_home === 1,
            predicted: parseFloat((goalsRegression.slope * m.match_number + goalsRegression.intercept).toFixed(2))
        }))
    };
};

// --- DIXON-COLES CORRELATION FACTOR ---
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

// --- TRUE GOAL LINE (TGL) ANALYZER ---
const analyzeTGL = (totalExpectedGoals, bookieLine = 2.5) => {
    const margin = 0.20;
    
    let recommendation = "";
    let valueRating = "";
    let confidence = "";
    
    const difference = totalExpectedGoals - bookieLine;
    const absDiff = Math.abs(difference);
    
    if (totalExpectedGoals > bookieLine + margin) {
        recommendation = "OVER";
        if (absDiff > 0.5) {
            valueRating = "STRONG VALUE";
            confidence = "High";
        } else if (absDiff > 0.3) {
            valueRating = "GOOD VALUE";
            confidence = "Medium";
        } else {
            valueRating = "SLIGHT VALUE";
            confidence = "Low";
        }
    } else if (totalExpectedGoals < bookieLine - margin) {
        recommendation = "UNDER";
        if (absDiff > 0.5) {
            valueRating = "STRONG VALUE";
            confidence = "High";
        } else if (absDiff > 0.3) {
            valueRating = "GOOD VALUE";
            confidence = "Medium";
        } else {
            valueRating = "SLIGHT VALUE";
            confidence = "Low";
        }
    } else {
        recommendation = "NO BET";
        valueRating = "LINE IS ACCURATE";
        confidence = "N/A";
    }
    
    return {
        totalExpectedGoals: parseFloat(totalExpectedGoals.toFixed(2)),
        bookieLine,
        difference: parseFloat(difference.toFixed(2)),
        recommendation,
        valueRating,
        confidence
    };
};

// --- CALCULATE GOAL LINE PROBABILITIES ---
const calculateGoalLineProbabilities = (homeExpGoals, awayExpGoals, line = 2.5) => {
    const totalLambda = homeExpGoals + awayExpGoals;
    let overProb = 0;
    let underProb = 0;
    
    const maxGoals = 15;
    
    for (let total = 0; total <= maxGoals; total++) {
        let probTotal = 0;
        
        for (let h = 0; h <= total; h++) {
            const a = total - h;
            probTotal += poisson(h, homeExpGoals) * poisson(a, awayExpGoals);
        }
        
        if (total > line) {
            overProb += probTotal;
        } else {
            underProb += probTotal;
        }
    }
    
    return {
        overProbability: parseFloat((overProb * 100).toFixed(2)),
        underProbability: parseFloat((underProb * 100).toFixed(2)),
        impliedOverOdds: overProb > 0 ? parseFloat((1 / overProb).toFixed(2)) : null,
        impliedUnderOdds: underProb > 0 ? parseFloat((1 / underProb).toFixed(2)) : null
    };
};

// --- BTTS (BOTH TEAMS TO SCORE) ANALYZER ---
// Enhanced with Bivariate Poisson for more accurate dependency modeling
const analyzeBTTS = (homeExpGoals, awayExpGoals, lambda3, bookieBTTSOdds = 1.80) => {
    // METHOD 1: Standard Independent Poisson (for comparison)
    const probHomeZero_Indep = Math.exp(-homeExpGoals);
    const probAwayZero_Indep = Math.exp(-awayExpGoals);
    const probZeroZero_Indep = probHomeZero_Indep * probAwayZero_Indep;
    const probAtLeastOneZero_Indep = probHomeZero_Indep + probAwayZero_Indep - probZeroZero_Indep;
    const probBTTS_Yes_Indep = 1 - probAtLeastOneZero_Indep;
    const probBTTS_No_Indep = probAtLeastOneZero_Indep;
    
    // METHOD 2: Bivariate Poisson (accounts for dependency)
    // Calculate exact probabilities for key scorelines using bivariate model
    const prob_0_0_Biv = bivariatePoissonProbability(0, 0, homeExpGoals, awayExpGoals, lambda3);
    
    // P(Home = 0) = sum of all (0, k) for k >= 0
    let probHomeZero_Biv = 0;
    for (let k = 0; k <= 10; k++) {
        probHomeZero_Biv += bivariatePoissonProbability(0, k, homeExpGoals, awayExpGoals, lambda3);
    }
    
    // P(Away = 0) = sum of all (k, 0) for k >= 0
    let probAwayZero_Biv = 0;
    for (let k = 0; k <= 10; k++) {
        probAwayZero_Biv += bivariatePoissonProbability(k, 0, homeExpGoals, awayExpGoals, lambda3);
    }
    
    // P(At least one team doesn't score) = P(H=0) + P(A=0) - P(0-0)
    const probAtLeastOneZero_Biv = probHomeZero_Biv + probAwayZero_Biv - prob_0_0_Biv;
    
    // P(Both teams score)
    const probBTTS_Yes_Biv = 1 - probAtLeastOneZero_Biv;
    const probBTTS_No_Biv = probAtLeastOneZero_Biv;
    
    // Fair odds calculation (using Bivariate model)
    const fairOddsBTTS_Yes = probBTTS_Yes_Biv > 0 ? 1 / probBTTS_Yes_Biv : null;
    const fairOddsBTTS_No = probBTTS_No_Biv > 0 ? 1 / probBTTS_No_Biv : null;
    
    // Value analysis
    let recommendation = "NO BET";
    let valueRating = "NO CLEAR VALUE";
    let confidence = "N/A";
    let expectedValue = 0;
    
    if (bookieBTTSOdds && fairOddsBTTS_Yes) {
        const valueDiffYes = bookieBTTSOdds - fairOddsBTTS_Yes;
        
        if (valueDiffYes > 0.30) {
            recommendation = "BET BTTS YES";
            valueRating = "STRONG VALUE";
            confidence = "High";
            expectedValue = valueDiffYes;
        } else if (valueDiffYes > 0.15) {
            recommendation = "BET BTTS YES";
            valueRating = "GOOD VALUE";
            confidence = "Medium";
            expectedValue = valueDiffYes;
        } else if (valueDiffYes > 0.05) {
            recommendation = "BET BTTS YES";
            valueRating = "SLIGHT VALUE";
            confidence = "Low";
            expectedValue = valueDiffYes;
        } else if (valueDiffYes < -0.20) {
            recommendation = "CONSIDER BTTS NO";
            valueRating = "BOOKIE UNDERPRICING YES";
            confidence = "Medium";
            expectedValue = valueDiffYes;
        } else {
            recommendation = "NO BET";
            valueRating = "NO CLEAR VALUE";
            confidence = "N/A";
            expectedValue = valueDiffYes;
        }
    }
    
    return {
        // Bivariate Poisson results (primary)
        probHomeZero: parseFloat((probHomeZero_Biv * 100).toFixed(2)),
        probAwayZero: parseFloat((probAwayZero_Biv * 100).toFixed(2)),
        prob_0_0: parseFloat((prob_0_0_Biv * 100).toFixed(2)),
        probBTTS_Yes: parseFloat((probBTTS_Yes_Biv * 100).toFixed(2)),
        probBTTS_No: parseFloat((probBTTS_No_Biv * 100).toFixed(2)),
        
        // Independent Poisson comparison
        probBTTS_Yes_Independent: parseFloat((probBTTS_Yes_Indep * 100).toFixed(2)),
        probBTTS_No_Independent: parseFloat((probBTTS_No_Indep * 100).toFixed(2)),
        
        // Model parameters
        lambda3: parseFloat(lambda3.toFixed(3)),
        modelType: lambda3 !== 0 ? "Bivariate Poisson" : "Independent Poisson",
        
        // Fair odds and value
        fairOddsBTTS_Yes: fairOddsBTTS_Yes ? parseFloat(fairOddsBTTS_Yes.toFixed(2)) : null,
        fairOddsBTTS_No: fairOddsBTTS_No ? parseFloat(fairOddsBTTS_No.toFixed(2)) : null,
        bookieOddsYes: bookieBTTSOdds,
        expectedValue: parseFloat(expectedValue.toFixed(2)),
        recommendation,
        valueRating,
        confidence
    };
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

    if (event.httpMethod === 'OPTIONS') {
        return response(200, { message: 'OK' });
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error("DATABASE_URL is missing in environment variables.");
        return response(500, { error: "Server Configuration Error: DATABASE_URL missing. Check Netlify Site Settings." });
    }
    
    try {
        const sql = neon(dbUrl);
        const db = drizzle(sql, { schema });

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

            case 'getMatchHistory':
                if (!payload?.teamId) throw new Error("Missing teamId");
                result = await db.select().from(matchHistory)
                    .where(eq(matchHistory.team_id, payload.teamId))
                    .orderBy(asc(matchHistory.match_number));
                break;

            case 'saveMatchHistory':
                // Delete existing history for this team
                await db.delete(matchHistory).where(eq(matchHistory.team_id, payload.teamId));
                
                // Insert new history
                if (payload.matches && payload.matches.length > 0) {
                    await db.insert(matchHistory).values(
                        payload.matches.map(m => ({
                            team_id: payload.teamId,
                            match_number: m.match_number,
                            goals_scored: m.goals_scored,
                            goals_conceded: m.goals_conceded,
                            was_home: m.was_home,
                            points: m.points
                        }))
                    );
                }
                result = { success: true };
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

                // Fetch match history for form analysis
                const homeHistory = await db.select().from(matchHistory)
                    .where(eq(matchHistory.team_id, payload.homeTeamId))
                    .orderBy(asc(matchHistory.match_number));
                
                const awayHistory = await db.select().from(matchHistory)
                    .where(eq(matchHistory.team_id, payload.awayTeamId))
                    .orderBy(asc(matchHistory.match_number));

                // Analyze form
                const homeForm = analyzeTeamForm(homeHistory);
                const awayForm = analyzeTeamForm(awayHistory);

                const safeDiv = (num, den) => (den === 0 ? 0 : num / den);

                // Calculate attack and defense strengths
                let homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), leagueData.avg_home_goals);
                let awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), leagueData.avg_away_goals);
                const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), leagueData.avg_away_goals);
                const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), leagueData.avg_home_goals);

                // Apply form modifiers to attack strength
                homeAttackStr *= homeForm.formModifier;
                awayAttackStr *= awayForm.formModifier;

                // Expected goals (lambda parameters) - now adjusted for form
                const homeExpGoals = homeAttackStr * awayDefenseStr * leagueData.avg_home_goals;
                const awayExpGoals = awayAttackStr * homeDefenseStr * leagueData.avg_away_goals;
                const totalExpectedGoals = homeExpGoals + awayExpGoals;

                // Get optional parameters
                const rho = payload.rho !== undefined ? payload.rho : -0.13;
                const goalLine = payload.goalLine !== undefined ? payload.goalLine : 2.5;
                const bttsOdds = payload.bttsOdds !== undefined ? payload.bttsOdds : 1.80;
                
                // Estimate lambda3 for Bivariate Poisson (or use provided value)
                const lambda3 = payload.lambda3 !== undefined 
                    ? payload.lambda3 
                    : estimateLambda3(homeExpGoals, awayExpGoals, leagueData.avg_home_goals, leagueData.avg_away_goals);

                // Calculate probability matrices
                const matrixSize = 6;
                const poissonMatrix = [];
                const dixonColesMatrix = [];
                const bivariateMatrix = [];
                
                let poissonHomeWin = 0, poissonDraw = 0, poissonAwayWin = 0;
                let dcHomeWin = 0, dcDraw = 0, dcAwayWin = 0;
                let bivHomeWin = 0, bivDraw = 0, bivAwayWin = 0;

                for (let h = 0; h < matrixSize; h++) {
                    const poissonRow = [];
                    const dcRow = [];
                    const bivRow = [];
                    const probHome = poisson(h, homeExpGoals);
                    
                    for (let a = 0; a < matrixSize; a++) {
                        const probAway = poisson(a, awayExpGoals);
                        
                        // Standard Poisson
                        const poissonProb = probHome * probAway;
                        poissonRow.push({ h, a, prob: poissonProb });
                        
                        // Dixon-Coles
                        const adjustment = dixonColesAdjustment(h, a, homeExpGoals, awayExpGoals, rho);
                        const dcProb = poissonProb * adjustment;
                        dcRow.push({ h, a, prob: dcProb, adjustment });
                        
                        // Bivariate Poisson
                        const bivProb = bivariatePoissonProbability(h, a, homeExpGoals, awayExpGoals, lambda3);
                        bivRow.push({ h, a, prob: bivProb });
                        
                        // Accumulate probabilities
                        if (h > a) {
                            poissonHomeWin += poissonProb;
                            dcHomeWin += dcProb;
                            bivHomeWin += bivProb;
                        } else if (h === a) {
                            poissonDraw += poissonProb;
                            dcDraw += dcProb;
                            bivDraw += bivProb;
                        } else {
                            poissonAwayWin += poissonProb;
                            dcAwayWin += dcProb;
                            bivAwayWin += bivProb;
                        }
                    }
                    
                    poissonMatrix.push(poissonRow);
                    dixonColesMatrix.push(dcRow);
                    bivariateMatrix.push(bivRow);
                }

                // TRUE GOAL LINE ANALYSIS
                const tglAnalysis = analyzeTGL(totalExpectedGoals, goalLine);
                const goalLineProbabilities = calculateGoalLineProbabilities(homeExpGoals, awayExpGoals, goalLine);

                // BTTS ANALYSIS (using Bivariate Poisson)
                const bttsAnalysis = analyzeBTTS(homeExpGoals, awayExpGoals, lambda3, bttsOdds);

                result = {
                    homeExpGoals: parseFloat(homeExpGoals.toFixed(2)),
                    awayExpGoals: parseFloat(awayExpGoals.toFixed(2)),
                    totalExpectedGoals: parseFloat(totalExpectedGoals.toFixed(2)),
                    rho,
                    lambda3: parseFloat(lambda3.toFixed(3)),
                    homeForm,
                    awayForm,
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
                    bivariatePoisson: {
                        homeWinProb: bivHomeWin,
                        drawProb: bivDraw,
                        awayWinProb: bivAwayWin,
                        matrix: bivariateMatrix
                    },
                    trueGoalLine: {
                        ...tglAnalysis,
                        ...goalLineProbabilities
                    },
                    btts: bttsAnalysis,
                    // Backwards compatibility - use Dixon-Coles as default
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