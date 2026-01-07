'use client';
import { useState, useEffect } from 'react';
import { verifyPin, createLeague, updateLeague, createTeam, updateTeam, getLeagues, getTeams, deleteTeam, type League, type Team } from '../actions';
import { Trash2, Plus, Database, ShieldCheck, Pencil, X, Save } from 'lucide-react';
export default function AdminPage() {
  const [pin, setPin] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState<'leagues' | 'teams'>('leagues');
  
  // Data State
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  // Forms
  const [editingLeagueId, setEditingLeagueId] = useState<number | null>(null);
  const [leagueForm, setLeagueForm] = useState({ name: '', avgHome: 1.5, avgAway: 1.2 });
  
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState({
    league_id: '',
    name: '',
    home_goals_for: 0, home_goals_against: 0, home_games_played: 0,
    away_goals_for: 0, away_goals_against: 0, away_games_played: 0
  });
  // Auth Handler
  const handleAuth = async () => {
    const isValid = await verifyPin(pin);
    if (isValid) {
      setAuthorized(true);
      refreshData();
    } else {
      alert("Invalid PIN. Try '1234' for demo.");
    }
  };
  const refreshData = async () => {
    try {
        const l = await getLeagues();
        setLeagues(l);
        if (l.length > 0 && !teamForm.league_id) {
           setTeamForm(prev => ({ ...prev, league_id: l[0].id.toString() }));
        }
    } catch (error) {
        console.error("Error loading admin data:", error);
        // Fallback for demo if DB isn't connected
        if (leagues.length === 0) {
            setLeagues([]); 
        }
    }
  };
  // Effect to fetch teams when league dropdown changes in team form
  useEffect(() => {
    if (authorized && teamForm.league_id) {
      getTeams(parseInt(teamForm.league_id)).then(setTeams).catch(console.error);
    }
  }, [authorized, teamForm.league_id]);
  // Submit Handlers
  const submitLeague = async () => {
    if (editingLeagueId) {
      await updateLeague({ id: editingLeagueId, ...leagueForm });
      setEditingLeagueId(null);
    } else {
      await createLeague(leagueForm);
    }
    setLeagueForm({ name: '', avgHome: 1.5, avgAway: 1.2 });
    refreshData();
  };
  const startEditLeague = (l: League) => {
    setLeagueForm({
      name: l.name,
      avgHome: l.avg_home_goals,
      avgAway: l.avg_away_goals
    });
    setEditingLeagueId(l.id);
  };
  const cancelEdit = () => {
    setLeagueForm({ name: '', avgHome: 1.5, avgAway: 1.2 });
    setEditingLeagueId(null);
  };
  // Team Logic
  const startEditTeam = (t: Team) => {
    setTeamForm({
        league_id: t.league_id.toString(),
        name: t.name,
        home_goals_for: t.home_goals_for,
        home_goals_against: t.home_goals_against,
        home_games_played: t.home_games_played,
        away_goals_for: t.away_goals_for,
        away_goals_against: t.away_goals_against,
        away_games_played: t.away_games_played
    });
    setEditingTeamId(t.id);
  };
  const cancelEditTeam = () => {
    // Reset form but keep current league if possible
    setTeamForm(prev => ({
        ...prev,
        name: '',
        home_goals_for: 0, home_goals_against: 0, home_games_played: 0,
        away_goals_for: 0, away_goals_against: 0, away_games_played: 0
    }));
    setEditingTeamId(null);
  };
  const submitTeam = async () => {
    if (editingTeamId) {
        await updateTeam({
            id: editingTeamId,
            ...teamForm
        });
        setEditingTeamId(null);
    } else {
        await createTeam({
            ...teamForm,
            league_id: parseInt(teamForm.league_id)
        });
    }
    // Reset but keep league selected
    setTeamForm(prev => ({
        ...prev,
        name: '',
        home_goals_for: 0, home_goals_against: 0, home_games_played: 0,
        away_goals_for: 0, away_goals_against: 0, away_games_played: 0
    }));
    getTeams(parseInt(teamForm.league_id)).then(setTeams);
  };
  const handleDeleteTeam = async (id: number) => {
    if(confirm('Are you sure you want to delete this team?')) {
        await deleteTeam(id);
        getTeams(parseInt(teamForm.league_id)).then(setTeams);
        // If we were editing this team, cancel edit
        if (editingTeamId === id) {
            cancelEditTeam();
        }
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
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="text-neon-500" /> 
            Database Management
        </h1>
        <div className="flex bg-slate-900 p-1 rounded-lg">
            <button 
                onClick={() => setActiveTab('leagues')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'leagues' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white'}`}
            >
                Leagues
            </button>
            <button 
                onClick={() => setActiveTab('teams')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'teams' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white'}`}
            >
                Teams
            </button>
        </div>
      </div>
      {/* LEAGUE MANAGEMENT */}
      {activeTab === 'leagues' && (
        <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4 h-fit">
                <h3 className="text-xl font-bold text-white mb-4">
                  {editingLeagueId ? 'Edit League' : 'Add League'}
                </h3>
                <div className="space-y-3">
                    <input 
                        placeholder="League Name (e.g. Premier League)"
                        className="w-full bg-slate-950 border border-slate-700 p-3 rounded text-white"
                        value={leagueForm.name}
                        onChange={(e) => setLeagueForm({...leagueForm, name: e.target.value})}
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Avg Home Goals</label>
                            <input 
                                type="number" step="0.01"
                                className="w-full bg-slate-950 border border-slate-700 p-3 rounded text-white"
                                value={leagueForm.avgHome}
                                onChange={(e) => setLeagueForm({...leagueForm, avgHome: parseFloat(e.target.value)})}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Avg Away Goals</label>
                            <input 
                                type="number" step="0.01"
                                className="w-full bg-slate-950 border border-slate-700 p-3 rounded text-white"
                                value={leagueForm.avgAway}
                                onChange={(e) => setLeagueForm({...leagueForm, avgAway: parseFloat(e.target.value)})}
                            />
                        </div>
                    </div>
                    
                    <div className="flex gap-2 mt-2">
                      <button 
                          onClick={submitLeague}
                          className="flex-1 bg-neon-500 text-black font-bold py-3 rounded hover:bg-neon-400"
                      >
                          {editingLeagueId ? 'Update League' : 'Create League'}
                      </button>
                      {editingLeagueId && (
                        <button 
                          onClick={cancelEdit}
                          className="px-4 py-3 bg-slate-800 text-white rounded hover:bg-slate-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-950 text-slate-500 text-xs uppercase">
                        <tr>
                            <th className="p-4">ID</th>
                            <th className="p-4">Name</th>
                            <th className="p-4 text-right">Avg Home</th>
                            <th className="p-4 text-right">Avg Away</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {leagues.map(l => (
                            <tr key={l.id} className="text-sm">
                                <td className="p-4 text-slate-500">{l.id}</td>
                                <td className="p-4 font-medium">{l.name}</td>
                                <td className="p-4 text-right font-mono">{l.avg_home_goals}</td>
                                <td className="p-4 text-right font-mono">{l.avg_away_goals}</td>
                                <td className="p-4 text-right">
                                    <button 
                                        onClick={() => startEditLeague(l)}
                                        className="text-neon-500 hover:text-neon-400 p-2"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
      {/* TEAM MANAGEMENT */}
      {activeTab === 'teams' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Team Form */}
             <div className="lg:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4 h-fit sticky top-20">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">
                        {editingTeamId ? 'Edit Team' : 'Add Team'}
                    </h3>
                    {editingTeamId && (
                        <button onClick={cancelEditTeam} className="text-slate-500 hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>
                
                <div className="space-y-3">
                    <select 
                        className="w-full bg-slate-950 border border-slate-700 p-3 rounded text-white"
                        value={teamForm.league_id}
                        onChange={(e) => setTeamForm({...teamForm, league_id: e.target.value})}
                    >
                        {leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <input 
                        placeholder="Team Name"
                        className="w-full bg-slate-950 border border-slate-700 p-3 rounded text-white"
                        value={teamForm.name}
                        onChange={(e) => setTeamForm({...teamForm, name: e.target.value})}
                    />
                    <div className="pt-2 border-t border-slate-800">
                        <label className="text-xs font-bold text-neon-500 uppercase mb-2 block">Home Stats</label>
                        <div className="grid grid-cols-3 gap-2">
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Goals For</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.home_goals_for} onChange={(e) => setTeamForm({...teamForm, home_goals_for: parseInt(e.target.value) || 0})} />
                             </div>
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Goals Ag</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.home_goals_against} onChange={(e) => setTeamForm({...teamForm, home_goals_against: parseInt(e.target.value) || 0})} />
                             </div>
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Games</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.home_games_played} onChange={(e) => setTeamForm({...teamForm, home_games_played: parseInt(e.target.value) || 0})} />
                             </div>
                        </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800">
                        <label className="text-xs font-bold text-red-400 uppercase mb-2 block">Away Stats</label>
                        <div className="grid grid-cols-3 gap-2">
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Goals For</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.away_goals_for} onChange={(e) => setTeamForm({...teamForm, away_goals_for: parseInt(e.target.value) || 0})} />
                             </div>
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Goals Ag</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.away_goals_against} onChange={(e) => setTeamForm({...teamForm, away_goals_against: parseInt(e.target.value) || 0})} />
                             </div>
                             <div className="space-y-1">
                                <span className="text-[10px] text-slate-500">Games</span>
                                <input type="number" className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm" 
                                    value={teamForm.away_games_played} onChange={(e) => setTeamForm({...teamForm, away_games_played: parseInt(e.target.value) || 0})} />
                             </div>
                        </div>
                    </div>
                    <button 
                        onClick={submitTeam}
                        className={editingTeamId 
                            ? "w-full bg-white text-black font-bold py-3 rounded hover:bg-slate-200 mt-4" 
                            : "w-full bg-neon-500 text-black font-bold py-3 rounded hover:bg-neon-400 mt-4"}
                    >
                        <div className="flex items-center justify-center gap-2">
                             {editingTeamId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                             {editingTeamId ? 'Update Team' : 'Add Team'}
                        </div>
                    </button>
                    
                    {editingTeamId && (
                        <button 
                            onClick={cancelEditTeam}
                            className="w-full bg-slate-800 text-white font-medium py-2 rounded hover:bg-slate-700 mt-2"
                        >
                            Cancel
                        </button>
                    )}
                </div>
             </div>
             {/* Team List */}
             <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-fit">
                <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-950 text-slate-500 text-xs uppercase sticky top-0">
                            <tr>
                                <th className="p-4">Team Name</th>
                                <th className="p-4 text-center">Home (G/GA/P)</th>
                                <th className="p-4 text-center">Away (G/GA/P)</th>
                                <th className="p-4 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {teams.map(t => (
                                <tr key={t.id} className={`text-sm hover:bg-slate-800/50 ${editingTeamId === t.id ? 'bg-slate-800 border-l-2 border-neon-500' : ''}`}>
                                    <td className="p-4 font-bold text-white">{t.name}</td>
                                    <td className="p-4 text-center font-mono text-slate-400">
                                        {t.home_goals_for}/{t.home_goals_against}/{t.home_games_played}
                                    </td>
                                    <td className="p-4 text-center font-mono text-slate-400">
                                        {t.away_goals_for}/{t.away_goals_against}/{t.away_games_played}
                                    </td>
                                    <td className="p-4 text-right whitespace-nowrap">
                                        <button 
                                            onClick={() => startEditTeam(t)}
                                            className="text-neon-500 hover:text-neon-400 p-2 inline-block mr-1"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteTeam(t.id)}
                                            className="text-red-500 hover:text-red-400 p-2 inline-block"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {teams.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-500">No teams found for this league.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
             </div>
        </div>
      )}
    </div>
  );
}
