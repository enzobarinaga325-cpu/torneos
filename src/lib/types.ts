export type TournamentStatus = "armando" | "en_curso" | "finalizado";

export type SiteSettings = {
  id: number;
  background_url: string | null;
};

export type Tournament = {
  id: string;
  name: string;
  slug: string;
  start_date: string | null;
  end_date: string | null;
  default_start_time: string | null; // "HH:MM:SS", hora en que arranca el primer turno de partidos
  default_match_minutes: number; // duración estándar de un partido, para armar los horarios en cadena
  status: TournamentStatus;
  published: boolean;
  created_at: string;
};

export type Court = {
  id: string;
  tournament_id: string;
  name: string;
  created_at: string;
};

export type Category = {
  id: string;
  tournament_id: string;
  name: string;
  created_at: string;
};

export type Team = {
  id: string;
  category_id: string;
  name: string;
  zone_id: string | null;
  created_at: string;
};

export type Zone = {
  id: string;
  category_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type MatchStage = "zona" | "fixture";

export type Match = {
  id: string;
  category_id: string;
  stage: MatchStage;
  zone_id: string | null;
  round_name: string | null;
  round_order: number | null;
  position: number;
  team1_id: string | null;
  team2_id: string | null;
  court_id: string | null;
  scheduled_at: string | null;
  set1_team1: number | null;
  set1_team2: number | null;
  set2_team1: number | null;
  set2_team2: number | null;
  set3_team1: number | null;
  set3_team2: number | null;
  winner_id: string | null;
  next_match_id: string | null;
  next_match_slot: 1 | 2 | null;
  created_at: string;
};

export type ZoneStanding = {
  team_id: string;
  played: number;
  won: number;
  lost: number;
  sets_won: number;
  sets_lost: number;
  sets_diff: number;
  games_won: number;
  games_lost: number;
  games_diff: number;
};
