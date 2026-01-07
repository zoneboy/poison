import { sql } from '../db/index';
import { League, Team } from '../db/schema';
// Re-export types for consumers
export type { League, Team };
export type PredictionResult = {
  homeExpGoals: number;
  awayExpGoals: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  matrix: { h: number; a: number; prob: number }[][]; // 6x6 grid
};
// --- Math Helpers ---
const factorial = (n: number): number => {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
};
const poisson = (k: number, lambda: number): number => {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
};
// --- API / CRUD ---
export async function verifyPin(pin: string) {
  // Check both process.env and localstorage for the pin to facilitate testing in browser
  const envPin = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_ADMIN_PIN : null;
  const storedPin = typeof window !== 'undefined' ? localStorage.getItem('NEXT_PUBLIC_ADMIN_PIN') : null;
  const validPin = envPin || storedPin || '1234'; // Fallback for demo
  return pin === validPin;
}
export async function getLeagues(): Promise<League[]> {
  try {
    const rows = await sql`SELECT * FROM leagues ORDER BY name ASC`;
    return rows as League[];
  } catch (error) {
    console.error("Error fetching leagues:", error);
    throw error;
  }
}
export async function getTeams(leagueId: number): Promise<Team[]> {
  try {
    const rows = await sql`SELECT * FROM teams WHERE league_id = ${leagueId} ORDER BY name ASC`;
    return rows as Team[];
  } catch (error) {
    console.error("Error fetching teams:", error);
    throw error;
  }
}
export async function createLeague(data: { name: string; avgHome: number; avgAway: number }) {
  try {
    await sql`
      INSERT INTO leagues (name, avg_home_goals, avg_away_goals) 
      VALUES (${data.name}, ${data.avgHome}, ${data.avgAway})
    `;
  } catch (error) {
    console.error("Error creating league:", error);
    throw error;
  }
}
export async function updateLeague(data: { id: number; name: string; avgHome: number; avgAway: number }) {
  try {
    await sql`
      UPDATE leagues 
      SET name = ${data.name}, avg_home_goals = ${data.avgHome}, avg_away_goals = ${data.avgAway}
      WHERE id = ${data.id}
    `;
  } catch (error) {
    console.error("Error updating league:", error);
    throw error;
  }
}
export async function createTeam(data: any) {
  try {
    await sql`
      INSERT INTO teams (
        league_id, name, 
        home_goals_for, home_goals_against, home_games_played,
        away_goals_for, away_goals_against, away_games_played
      ) VALUES (
        ${parseInt(data.league_id)}, ${data.name},
        ${parseInt(data.home_goals_for)}, ${parseInt(data.home_goals_against)}, ${parseInt(data.home_games_played)},
        ${parseInt(data.away_goals_for)}, ${parseInt(data.away_goals_against)}, ${parseInt(data.away_games_played)}
      )
    `;
  } catch (error) {
    console.error("Error creating team:", error);
    throw error;
  }
}
export async function updateTeam(data: any) {
  try {
    await sql`
      UPDATE teams SET
        league_id = ${parseInt(data.league_id)},
        name = ${data.name},
        home_goals_for = ${parseInt(data.home_goals_for)},
        home_goals_against = ${parseInt(data.home_goals_against)},
        home_games_played = ${parseInt(data.home_games_played)},
        away_goals_for = ${parseInt(data.away_goals_for)},
        away_goals_against = ${parseInt(data.away_goals_against)},
        away_games_played = ${parseInt(data.away_games_played)}
      WHERE id = ${data.id}
    `;
  } catch (error) {
    console.error("Error updating team:", error);
    throw error;
  }
}
export async function deleteTeam(teamId: number) {
  try {
    await sql`DELETE FROM teams WHERE id = ${teamId}`;
  } catch (error) {
    console.error("Error deleting team:", error);
    throw error;
  }
}
// --- The Core Math Logic ---
export async function calculatePrediction(leagueId: number, homeTeamId: number, awayTeamId: number): Promise<PredictionResult> {
  try {
    // Fetch data directly from DB in parallel using raw SQL
    const leaguePromise = sql`SELECT * FROM leagues WHERE id = ${leagueId}`;
    const homePromise = sql`SELECT * FROM teams WHERE id = ${homeTeamId}`;
    const awayPromise = sql`SELECT * FROM teams WHERE id = ${awayTeamId}`;
    const [leagueResult, homeResult, awayResult] = await Promise.all([leaguePromise, homePromise, awayPromise]);
    const leagueData = leagueResult[0] as League;
    const homeTeam = homeResult[0] as Team;
    const awayTeam = awayResult[0] as Team;
    if (!leagueData || !homeTeam || !awayTeam) {
      throw new Error("Invalid selection");
    }
    // Avoid division by zero
    const safeDiv = (num: number, den: number) => (den === 0 ? 0 : num / den);
    // Step 1: Calculate Strengths
    const homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), leagueData.avg_home_goals);
    const awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), leagueData.avg_away_goals);
    
    const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), leagueData.avg_away_goals);
    const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), leagueData.avg_home_goals);
    // Step 2: Calculate Expected Goals (Lambda)
    const homeExpGoals = homeAttackStr * awayDefenseStr * leagueData.avg_home_goals;
    const awayExpGoals = awayAttackStr * homeDefenseStr * leagueData.avg_away_goals;
    // Step 3: Generate Matrix (0-5 goals)
    const matrixSize = 6;
    const matrix: { h: number; a: number; prob: number }[][] = [];
    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;
    for (let h = 0; h < matrixSize; h++) {
      const row: { h: number; a: number; prob: number }[] = [];
      const probHome = poisson(h, homeExpGoals);
      for (let a = 0; a < matrixSize; a++) {
        const probAway = poisson(a, awayExpGoals);
        const cellProb = probHome * probAway; // Joint probability
        
        row.push({ h, a, prob: cellProb });
        if (h > a) homeWinProb += cellProb;
        else if (h === a) drawProb += cellProb;
        else awayWinProb += cellProb;
      }
      matrix.push(row);
    }
    return {
      homeExpGoals,
      awayExpGoals,
      homeWinProb,
      drawProb,
      awayWinProb,
      matrix,
    };
  } catch (error) {
    console.error("Error calculating prediction:", error);
    throw error;
  }
}