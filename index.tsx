import React, { useState, useEffect } from 'react';
import { Loader2, Calculator, AlertTriangle, Database, Terminal, Save, Trash2, Plus, ShieldCheck, Pencil, X } from 'lucide-react';
import { sql } from '@neondatabase/serverless';

// Get DATABASE_URL from localStorage for browser environment
const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key];
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
};

let connectionString = getEnv('DATABASE_URL');
if (connectionString) {
  const match = connectionString.match(/postgres(?:ql)?:\/\/[^\s|"'<>]+/);
  if (match) connectionString = match[0];
}

const validFallback = 'postgresql://placeholder:placeholder@placeholder.neon.tech/neondb';
const finalUrl = (connectionString?.startsWith('postgres')) ? connectionString : validFallback;
const sqlClient = sql(finalUrl);

// Types
interface League {
  id: number;
  name: string;
  avg_home_goals: number;
  avg_away_goals: number;
}

interface Team {
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

interface PredictionResult {
  homeExpGoals: number;
  awayExpGoals: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  matrix: { h: number; a: number; prob: number }[][];
}

// Math helpers
const factorial = (n: number): number => {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
};

const poisson = (k: number, lambda: number): number => {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
};

// Database functions
const getLeagues = async (): Promise<League[]> => {
  const rows = await sqlClient`SELECT * FROM leagues ORDER BY name ASC`;
  return rows as League[];
};

const getTeams = async (leagueId: number): Promise<Team[]> => {
  const rows = await sqlClient`SELECT * FROM teams WHERE league_id = ${leagueId} ORDER BY name ASC`;
  return rows as Team[];
};

const calculatePrediction = async (leagueId: number, homeTeamId: number, awayTeamId: number): Promise<PredictionResult> => {
  const [leagueResult, homeResult, awayResult] = await Promise.all([
    sqlClient`SELECT * FROM leagues WHERE id = ${leagueId}`,
    sqlClient`SELECT * FROM teams WHERE id = ${homeTeamId}`,
    sqlClient`SELECT * FROM teams WHERE id = ${awayTeamId}`
  ]);

  const league = leagueResult[0] as League;
  const homeTeam = homeResult[0] as Team;
  const awayTeam = awayResult[0] as Team;

  if (!league || !homeTeam || !awayTeam) throw new Error("Invalid selection");

  const safeDiv = (num: number, den: number) => (den === 0 ? 0 : num / den);

  const homeAttackStr = safeDiv(safeDiv(homeTeam.home_goals_for, homeTeam.home_games_played), league.avg_home_goals);
  const awayAttackStr = safeDiv(safeDiv(awayTeam.away_goals_for, awayTeam.away_games_played), league.avg_away_goals);
  const homeDefenseStr = safeDiv(safeDiv(homeTeam.home_goals_against, homeTeam.home_games_played), league.avg_away_goals);
  const awayDefenseStr = safeDiv(safeDiv(awayTeam.away_goals_against, awayTeam.away_games_played), league.avg_home_goals);

  const homeExpGoals = homeAttackStr * awayDefenseStr * league.avg_home_goals;
  const awayExpGoals = awayAttackStr * homeDefenseStr * league.avg_away_goals;

  const matrix: { h: number; a: number; prob: number }[][] = [];
  let homeWinProb = 0, drawProb = 0, awayWinProb = 0;

  for (let h = 0; h < 6; h++) {
    const row: { h: number; a: number; prob: number }[] = [];
    const probHome = poisson(h, homeExpGoals);
    for (let a = 0; a < 6; a++) {
      const probAway = poisson(a, awayExpGoals);
      const cellProb = probHome * probAway;
      row.push({ h, a, prob: cellProb });
      if (h > a) homeWinProb += cellProb;
      else if (h === a) drawProb += cellProb;
      else awayWinProb += cellProb;
    }
    matrix.push(row);
  }

  return { homeExpGoals, awayExpGoals, homeWinProb, drawProb, awayWinProb, matrix };
};

// Main App Component
export default function App() {
  const [page, setPage] = useState<'calculator' | 'admin'>('calculator');

  return (
    <div className="min-h-screen bg-black text-slate-200">
      <nav className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => setPage('calculator')} className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <div className="w-3 h-3 bg-neon-400 rounded-full shadow-[0_0_10px_#4ade80]" />
            NEON<span className="text-slate-500">PREDICT</span>
          </button>
          <div className="flex gap-6 text-sm font-medium">
            <button onClick={() => setPage('calculator')} className="hover:text-neon-400 transition-colors">Calculator</button>
            <button onClick={() => setPage('admin')} className="hover:text-neon-400 transition-colors">Admin</button>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-6">
        {page === 'calculator' ? <CalculatorPage /> : <AdminPage />}
      </main>
    </div>
  );
}

// Calculator Page Component
function CalculatorPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfigInput, setShowConfigInput] = useState(false);
  const [tempUrl, setTempUrl] = useState("");

  useEffect(() => {
    setTempUrl(localStorage.getItem('DATABASE_URL') || "");
    setLoading(true);
    getLeagues()
      .then(setLeagues)
      .catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("Failed to fetch") || errMsg.includes("NetworkError") || errMsg.includes("Invalid URL")) {
          setError("Connect your database");
          setShowConfigInput(true);
        } else {
          setError(errMsg || "Database error");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedLeague) {
      setLoading(true);
      getTeams(parseInt(selectedLeague))
        .then(setTeams)
        .catch(() => setError("Failed to load teams"))
        .finally(() => setLoading(false));
      setSelectedHome("");
      setSelectedAway("");
      setPrediction(null);
    }
  }, [selectedLeague]);

  const handleCalculate = async () => {
    if (!selectedLeague || !selectedHome || !selectedAway) return;
    if (selectedHome === selectedAway) {
      alert("Home and Away teams cannot be the same.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await calculatePrediction(parseInt(selectedLeague), parseInt(selectedHome), parseInt(selectedAway));
      setPrediction(result);
    } catch (e) {
      setError("Failed to calculate prediction");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = () => {
    if (!tempUrl) return;
    let cleanUrl = tempUrl.trim();
    const match = cleanUrl.match(/postgres(?:ql)?:\/\/[^\s|"'<>]+/);
    if (match) cleanUrl = match[0];
    localStorage.setItem('DATABASE_URL', cleanUrl);
    window.location.reload();
  };

  const maxProb = prediction ? Math.max(...prediction.matrix.flat().map(c => c.prob)) : 0;

  if (error && showConfigInput) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6 text-center px-4 max-w-3xl mx-auto">
        <div className="p-4 rounded-full bg-neon-500/10">
          <Database className="w-12 h-12 text-neon-500" />
        </div>
        <h2 className="text-2xl font-bold text-white">{error}</h2>
        <div className="w-full max-w-md bg-slate-900 p-6 rounded-xl border border-slate-800 space-y-4">
          <div className="text-left">
            <label className="text-sm font-bold text-slate-400">Neon Connection String</label>
            <p className="text-xs text-slate-500 mb-2">Paste your Postgres URL from the Neon Dashboard</p>
            <input 
              type="password"
              placeholder="postgresql://user:pass@ep-xyz.neon.tech/neondb"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:border-neon-500 outline-none"
              value={tempUrl}
              onChange={(e) => setTempUrl(e.target.value)}
            />
          </div>
          <button 
            onClick={handleSaveConfig}
            className="w-full bg-neon-500 hover:bg-neon-400 text-black font-bold py-2 rounded flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" /> Save & Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 py-10">
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">
          MATCH <span className="text-neon-400">PREDICTOR</span>
        </h1>
        <p className="text-slate-400 max-w-lg mx-auto">
          Select a league and two teams to generate a probability matrix using Poisson distribution
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4 p-6 bg-slate-900/50 border border-slate-800 rounded-2xl">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">League</label>
          <select 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500"
            value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}
          >
            <option value="">Select League...</option>
            {leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">Home Team</label>
          <select 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500 disabled:opacity-50"
            value={selectedHome}
            onChange={(e) => setSelectedHome(e.target.value)}
            disabled={!selectedLeague || loading}
          >
            <option value="">Select Team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">Away Team</label>
          <select 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500 disabled:opacity-50"
            value={selectedAway}
            onChange={(e) => setSelectedAway(e.target.value)}
            disabled={!selectedLeague || loading}
          >
            <option value="">Select Team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="flex items-end">
          <button 
            onClick={handleCalculate}
            disabled={loading || !selectedHome || !selectedAway}
            className="w-full bg-neon-500 hover:bg-neon-400 text-slate-950 font-bold py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Calculator className="w-5 h-5" />}
            CALCULATE
          </button>
        </div>
      </div>

      {prediction && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard label="Home Win" value={(prediction.homeWinProb * 100).toFixed(1) + "%"} sub={`xG: ${prediction.homeExpGoals.toFixed(2)}`} color="text-neon-400" />
            <StatCard label="Draw" value={(prediction.drawProb * 100).toFixed(1) + "%"} sub="Neutral Outcome" color="text-slate-200" />
            <StatCard label="Away Win" value={(prediction.awayWinProb * 100).toFixed(1) + "%"} sub={`xG: ${prediction.awayExpGoals.toFixed(2)}`} color="text-red-400" />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[600px] bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-4">Scoreline Probability Matrix (%)</h3>
              <div className="grid grid-cols-[auto_repeat(6,1fr)] gap-1">
                <div className="flex items-center justify-center font-bold text-slate-500 text-xs p-2">H \ A</div>
                {[0,1,2,3,4,5].map(g => (
                  <div key={g} className="flex items-center justify-center font-bold text-slate-400 bg-slate-950/50 p-2 rounded">{g}</div>
                ))}
                {prediction.matrix.map((row, hIdx) => (
                  <React.Fragment key={hIdx}>
                    <div className="flex items-center justify-center font-bold text-slate-400 bg-slate-950/50 p-2 rounded">{hIdx}</div>
                    {row.map((cell, aIdx) => (
                      <div 
                        key={`${hIdx}-${aIdx}`}
                        className={`flex flex-col items-center justify-center p-3 rounded transition-all ${
                          cell.prob === maxProb 
                            ? "bg-neon-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(74,222,128,0.3)] scale-105" 
                            : "bg-slate-950 hover:bg-slate-800 text-slate-300"
                        }`}
                      >
                        <span className="text-sm">{(cell.prob * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col items-center justify-center text-center">
      <span className="text-sm font-semibold text-slate-500 uppercase mb-1">{label}</span>
      <span className={`text-4xl font-black mb-2 ${color}`}>{value}</span>
      <span className="text-xs text-slate-600 font-mono bg-slate-950 px-2 py-1 rounded">{sub}</span>
    </div>
  );
}

// Admin Page Component (simplified for length)
function AdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [pin, setPin] = useState("");

  const handleAuth = () => {
    const validPin = localStorage.getItem('NEXT_PUBLIC_ADMIN_PIN') || '1234';
    if (pin === validPin) {
      setAuthorized(true);
    } else {
      alert("Invalid PIN. Try '1234' for demo.");
    }
  };

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldCheck className="w-16 h-16 text-slate-700" />
        <h2 className="text-2xl font-bold">Admin Access</h2>
        <div className="flex gap-2">
          <input 
            type="password" 
            placeholder="Enter PIN (Demo: 1234)" 
            className="bg-slate-900 border border-slate-800 rounded px-4 py-2 text-white"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button 
            onClick={handleAuth}
            className="bg-neon-500 text-black font-bold px-4 py-2 rounded hover:bg-neon-400"
          >
            Access
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-20">
      <Database className="w-16 h-16 text-neon-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold">Admin Dashboard</h2>
      <p className="text-slate-500 mt-2">Database management interface would go here</p>
    </div>
  );
}