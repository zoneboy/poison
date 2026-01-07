// Plain Types matching the Database Schema
// We are no longer using Drizzle for schema definition, but we keep the types for the UI.
export interface League {
  id: number;
  name: string;
  avg_home_goals: number;
  avg_away_goals: number;
}
export interface Team {
  id: number;
  league_id: number;
  name: string;
  home_goals_for: number;
  home_goals_against: number;
  home_games_played: number;
  away_goals_for: number;
  away_goals_against: number;
  away_games_played: number;
}
