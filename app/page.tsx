'use client';

import { useState, useEffect } from 'react';
import { getLeagues, getTeams, calculatePrediction, type League, type Team, type PredictionResult } from './actions';
import { clsx } from 'clsx';
import { Loader2, Calculator, AlertTriangle } from 'lucide-react';

export default function Home() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");
  
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load Leagues on Mount
  useEffect(() => {
    getLeagues()
      .then(setLeagues)
      .catch(err => {
        console.error("Failed to load leagues:", err);
        setError("Could not connect to the database. Please check your DATABASE_URL environment variable.");
      });
  }, []);

  // Load Teams when League changes
  useEffect(() => {
    if (selectedLeague) {
      setLoading(true);
      getTeams(parseInt(selectedLeague))
        .then(setTeams)
        .catch(err => {
          console.error(err);
          setError("Failed to load teams.");
        })
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
      const result = await calculatePrediction(
        parseInt(selectedLeague),
        parseInt(selectedHome),
        parseInt(selectedAway)
      );
      setPrediction(result);
    } catch (e) {
      console.error(e);
      setError("Failed to calculate prediction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Helper to find highest probability in matrix for highlighting
  const maxProb = prediction 
    ? Math.max(...prediction.matrix.flat().map(c => c.prob)) 
    : 0;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 text-center px-4">
        <AlertTriangle className="w-16 h-16 text-red-500" />
        <h2 className="text-2xl font-bold text-white">Connection Error</h2>
        <p className="text-slate-400 max-w-md">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-12 py-10">
      
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter">
          MATCH <span className="text-neon-400">PREDICTOR</span>
        </h1>
        <p className="text-slate-400 max-w-lg mx-auto">
          Select a league and two teams to generate a probability matrix using Poisson distribution analysis.
        </p>
      </div>

      {/* Controls */}
      <div className="grid md:grid-cols-4 gap-4 p-6 bg-slate-900/50 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">League</label>
          <select 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500 transition-colors"
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
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500 transition-colors disabled:opacity-50"
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
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-neon-500 transition-colors disabled:opacity-50"
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

      {/* Results */}
      {prediction && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">
          
          {/* Top Level Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
              label="Home Win" 
              value={(prediction.homeWinProb * 100).toFixed(1) + "%"} 
              sub={`xG: ${prediction.homeExpGoals.toFixed(2)}`}
              color="text-neon-400"
            />
             <StatCard 
              label="Draw" 
              value={(prediction.drawProb * 100).toFixed(1) + "%"} 
              sub="Neutral Outcome"
              color="text-slate-200"
            />
             <StatCard 
              label="Away Win" 
              value={(prediction.awayWinProb * 100).toFixed(1) + "%"} 
              sub={`xG: ${prediction.awayExpGoals.toFixed(2)}`}
              color="text-red-400"
            />
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px] bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-4">Scoreline Probability Matrix (%)</h3>
              
              <div className="grid grid-cols-[auto_repeat(6,1fr)] gap-1">
                {/* Header Row */}
                <div className="flex items-center justify-center font-bold text-slate-500 text-xs p-2">
                  H \ A
                </div>
                {[0,1,2,3,4,5].map(g => (
                  <div key={`head-${g}`} className="flex items-center justify-center font-bold text-slate-400 bg-slate-950/50 p-2 rounded">
                    {g}
                  </div>
                ))}

                {/* Data Rows */}
                {prediction.matrix.map((row, hIdx) => (
                  <>
                    <div key={`row-head-${hIdx}`} className="flex items-center justify-center font-bold text-slate-400 bg-slate-950/50 p-2 rounded">
                      {hIdx}
                    </div>
                    {row.map((cell, aIdx) => (
                      <div 
                        key={`${hIdx}-${aIdx}`}
                        className={clsx(
                          "flex flex-col items-center justify-center p-3 rounded transition-all",
                          cell.prob === maxProb 
                            ? "bg-neon-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(74,222,128,0.3)] scale-105 z-10" 
                            : "bg-slate-950 hover:bg-slate-800 text-slate-300"
                        )}
                      >
                        <span className="text-sm">{(cell.prob * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </>
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
      <span className={clsx("text-4xl font-black mb-2", color)}>{value}</span>
      <span className="text-xs text-slate-600 font-mono bg-slate-950 px-2 py-1 rounded">{sub}</span>
    </div>
  );
}