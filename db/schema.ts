import { pgTable, serial, text, real, integer } from 'drizzle-orm/pg-core';

export const leagues = pgTable('leagues', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  avg_home_goals: real('avg_home_goals').notNull(),
  avg_away_goals: real('avg_away_goals').notNull(),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  league_id: integer('league_id').references(() => leagues.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  
  // Home Stats
  home_goals_for: integer('home_goals_for').notNull(),
  home_goals_against: integer('home_goals_against').notNull(),
  home_games_played: integer('home_games_played').notNull(),

  // Away Stats
  away_goals_for: integer('away_goals_for').notNull(),
  away_goals_against: integer('away_goals_against').notNull(),
  away_games_played: integer('away_games_played').notNull(),
});

export type League = typeof leagues.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type NewLeague = typeof leagues.$inferInsert;
export type NewTeam = typeof teams.$inferInsert;