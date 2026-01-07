'use server';

import { db } from '@/db';
import { leagues, teams, League, Team } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

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
  return pin === process.env.NEXT_PUBLIC_ADMIN_PIN;
}

export async function getLeagues() {
  const allLeagues = await db.select().from(leagues).orderBy(leagues.name);
  return allLeagues;
}

export async function getTeams(leagueId: number) {
  const leagueTeams = await db.select().from(teams).where(eq(teams.league_id, leagueId)).orderBy(teams.name);
  return leagueTeams;
}

export async function createLeague(data: { name: string; avgHome: number; avgAway: number }) {
  await db.insert(leagues).values({
    name: data.name,
    avg_home_goals: data.avgHome,
    avg_away_goals: data.avgAway,
  });
}

export async function updateLeague(data: { id: number; name: string; avgHome: number; avgAway: number }) {
  await db.update(leagues)
    .set({
      name: data.name,
      avg_home_goals: data.avgHome,
      avg_away_goals: data.avgAway,
    })
    .where(eq(leagues.id, data.id));
}

export async function createTeam(data: any) {
  await db.insert(teams).values({
    league_id: parseInt(data.league_id),
    name: data.name,
    home_goals_for: parseInt(data.home_goals_for),
    home_goals_against: parseInt(data.home_goals_against),
    home_games_played: parseInt(data.home_games_played),
    away_goals_for: parseInt(data.away_goals_for),
    away_goals_against: parseInt(data.away_goals_against),
    away_games_played: parseInt(data.away_games_played),
  });
}

export async function updateTeam(data: any) {
  await db.update(teams)
    .set({
        league_id: parseInt(data.league_id),
        name: data.name,
        home_goals_for: parseInt(data.home_goals_for),
        home_goals_against: parseInt(data.home_goals_against),
        home_games_played: parseInt(data.home_games_played),
        away_goals_for: parseInt(data.away_goals_for),
        away_goals_against: parseInt(data.away_goals_against),
        away_games_played: parseInt(data.away_games_played),
    })
    .where(eq(teams.id, data.id));
}

export async function deleteTeam(teamId: number) {
  await db.delete(teams).where(eq(teams.id, teamId));
}

// --- The Core Math Logic ---

export async function calculatePrediction(leagueId: number, homeTeamId: number, awayTeamId: number): Promise<PredictionResult> {
  // Fetch data directly from DB in parallel
  const [leagueData] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  const [homeTeam] = await db.select().from(teams).where(eq(teams.id, homeTeamId));
  const [awayTeam] = await db.select().from(teams).where(eq(teams.id, awayTeamId));

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
}