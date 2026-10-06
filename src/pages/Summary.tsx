import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trophy, CreditCard, Gift, CheckCircle, Medal, GripVertical, ArrowUp, ArrowDown, MapPin, AlertCircle, Calendar, Loader2, FileDown } from 'lucide-react';
import { FINE_TYPES, formatCHF } from '@/lib/players';
import { JASS } from '@/lib/constants';
import { usePlayers } from '@/hooks/usePlayers';
import { useCompleteSession } from '@/hooks/useSessions';
import { useCreateKasseTransaction } from '@/hooks/useKasse';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { LuckyWheel } from '@/components/LuckyWheel';
import { format } from 'date-fns';
import { usePageTitle } from '@/hooks/usePageTitle';
import { de } from 'date-fns/locale';
import { exportSessionPdf } from '@/lib/exportPdf';
import type { Fine, RankingPlayer } from '@/types/jass';

interface HistorySession {
  id: string;
  date: string;
  location: string;
  players: {
    name: string;
    rank: number;
    wins: number;
    totalFines: number;
  }[];
  totalPot: number;
  matchCount: number;
}

interface LocationState {
  matchResults?: Array<{
    teamA: string[];
    teamB: string[];
    teamATotal: number;
    teamBTotal: number;
    winner: 'A' | 'B' | 'tie';
    fines: Fine[];
    location?: string;
    matchNumber?: number;
  }>;
  playerWins?: { [playerId: string]: number };
  sessionId?: string;
  fromHistory?: boolean;
  historySession?: HistorySession;
}

// Placeholder summary data for when no state is passed
const PLACEHOLDER_SUMMARY = {
  rankings: [
    { playerId: '1', name: 'Mötzi', wins: 3, rank: 1 },
    { playerId: '2', name: 'Poli', wins: 2, rank: 2 },
    { playerId: '3', name: 'Husi', wins: 2, rank: 3 },
    { playerId: '4', name: 'Rötschi', wins: 1, rank: 4 },
  ],
  matchResults: [
    { matchNumber: 1, location: 'Rechte Winkel', fines: [
      { id: '1', playerId: '1', type: 'eichle', amount: 5, note: 'Runde 3', matchNumber: 1, location: 'Rechte Winkel' },
      { id: '2', playerId: '2', type: 'match', amount: 10, note: 'Runde 5', matchNumber: 1, location: 'Rechte Winkel' },
    ]},
    { matchNumber: 2, location: 'Hürtel', fines: [
      { id: '3', playerId: '3', type: 'weniger', amount: 5, note: 'Runde 2', matchNumber: 2, location: 'Hürtel' },
    ]},
    { matchNumber: 3, location: 'Engel', fines: [
      { id: '4', playerId: '4', type: 'gliichi4', amount: 5, note: 'Runde 1', matchNumber: 3, location: 'Engel' },
      { id: '5', playerId: '1', type: 'charte', amount: 5, note: 'Runde 4', matchNumber: 3, location: 'Engel' },
    ]},
  ],
};


export default function Summary() {
  usePageTitle('Zusammenfassung');
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const state = location.state as LocationState | undefined;
  const { data: players = [] } = usePlayers();
  const completeSession = useCompleteSession();
  const createKasseTransaction = useCreateKasseTransaction();
  const [leftFirst, setLeftFirst] = useState('');
  const [rankings, setRankings] = useState<RankingPlayer[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showTiebreaker, setShowTiebreaker] = useState(false);
  const [tieGroups, setTieGroups] = useState<Array<{
    wins: number;
    startRank: number;
    players: RankingPlayer[];
  }>>([]);
  const [sessionDate, setSessionDate] = useState<Date>(new Date());
  const [sessionLocation, setSessionLocation] = useState<string>('');

  // Initialize rankings from match wins OR history data
  useEffect(() => {
    let initialRankings: RankingPlayer[];
    
    if (state?.fromHistory && state.historySession) {
      // Data from History page - use as-is (already resolved)
      const historyPlayers = state.historySession.players;
      initialRankings = historyPlayers.map((p, idx) => ({
        playerId: String(idx + 1),
        name: p.name,
        wins: p.wins,
        rank: p.rank,
      }));
      setSessionDate(new Date(state.historySession.date));
      setSessionLocation(state.historySession.location);
      
      // For history sessions, check if there were ties that need to be shown
      // (only show tiebreaker if not already resolved in the stored data)
      // Find tie groups from original wins (before manual resolution)
      const winGroups: { [wins: number]: RankingPlayer[] } = {};
      initialRankings.forEach(player => {
        if (!winGroups[player.wins]) {
          winGroups[player.wins] = [];
        }
        winGroups[player.wins].push(player);
      });
      
      const groups: Array<{ wins: number; startRank: number; players: RankingPlayer[] }> = [];
      Object.entries(winGroups)
        .filter(([_, players]) => players.length > 1)
        .sort(([a], [b]) => Number(b) - Number(a))
        .forEach(([wins, players]) => {
          const startRank = Math.min(...players.map(p => p.rank));
          groups.push({
            wins: Number(wins),
            startRank,
            players: players.sort((a, b) => a.rank - b.rank),
          });
        });
      
      // Show tiebreaker for historical sessions with ties
      if (groups.length > 0) {
        setTieGroups(groups);
        setShowTiebreaker(true);
      }
      
    } else if (state?.playerWins && players.length > 0) {
      // Data from Session wizard
      initialRankings = players
        .map(player => ({
          playerId: player.id,
          name: player.name,
          wins: state.playerWins?.[player.id] || 0,
          rank: 0,
        }))
        .sort((a, b) => b.wins - a.wins)
        .map((player, index) => ({ ...player, rank: index + 1 }));
      
      // Find tie groups
      const winGroups: { [wins: number]: RankingPlayer[] } = {};
      initialRankings.forEach(player => {
        if (!winGroups[player.wins]) {
          winGroups[player.wins] = [];
        }
        winGroups[player.wins].push(player);
      });
      
      const groups: Array<{ wins: number; startRank: number; players: RankingPlayer[] }> = [];
      Object.entries(winGroups)
        .filter(([_, players]) => players.length > 1)
        .sort(([a], [b]) => Number(b) - Number(a))
        .forEach(([wins, players]) => {
          const startRank = Math.min(...players.map(p => p.rank));
          groups.push({
            wins: Number(wins),
            startRank,
            players: players.sort((a, b) => a.rank - b.rank),
          });
        });
      
      if (groups.length > 0) {
        setTieGroups(groups);
        setShowTiebreaker(true);
      }
    } else {
      // Fallback placeholder
      initialRankings = PLACEHOLDER_SUMMARY.rankings;
    }
    
    setRankings(initialRankings);
  }, [state, players]);

  // Collect all fines from match results with location info
  const allFines: Fine[] = state?.matchResults
    ? state.matchResults.flatMap(match => match.fines.map(f => ({
        ...f,
        matchNumber: match.matchNumber || 0,
        location: match.location || 'Unbekannt',
      })))
    : PLACEHOLDER_SUMMARY.matchResults.flatMap(m => m.fines);

  // Group fines by player
  const finesByPlayer = players.reduce((acc, player) => {
    acc[player.id] = allFines.filter(f => f.playerId === player.id);
    return acc;
  }, {} as { [key: string]: Fine[] });

  // Calculate total fines per player
  const playerFines = players.reduce((acc, player) => {
    acc[player.id] = finesByPlayer[player.id]?.reduce((sum, f) => sum + f.amount, 0) || 0;
    return acc;
  }, {} as { [key: string]: number });

  // Calculate payments with rank fines based on wins
  const payments = rankings.map(player => {
    const finesAmount = playerFines[player.playerId] || 0;
    const rankFine = JASS.RANK_FINES[player.rank] || 0;
    const playerFinesList = finesByPlayer[player.playerId] || [];
    return {
      playerId: player.playerId,
      name: player.name,
      buyIn: JASS.BUY_IN,
      fines: finesAmount,
      finesList: playerFinesList,
      rankFine,
      total: JASS.BUY_IN + finesAmount + rankFine,
    };
  });

  // Handle wheel completion
  const handleWheelComplete = (finalRankings: RankingPlayer[]) => {
    setRankings(finalRankings);
    setShowTiebreaker(false);
    setTieGroups([]);
  };

  // Move player up in ranking
  const moveUp = (index: number) => {
    if (index === 0) return;
    setRankings(prev => {
      const newRankings = [...prev];
      // Swap ranks
      const tempRank = newRankings[index].rank;
      newRankings[index].rank = newRankings[index - 1].rank;
      newRankings[index - 1].rank = tempRank;
      // Swap positions
      [newRankings[index], newRankings[index - 1]] = [newRankings[index - 1], newRankings[index]];
      return newRankings;
    });
  };

  // Move player down in ranking
  const moveDown = (index: number) => {
    if (index === rankings.length - 1) return;
    setRankings(prev => {
      const newRankings = [...prev];
      // Swap ranks
      const tempRank = newRankings[index].rank;
      newRankings[index].rank = newRankings[index + 1].rank;
      newRankings[index + 1].rank = tempRank;
      // Swap positions
      [newRankings[index], newRankings[index + 1]] = [newRankings[index + 1], newRankings[index]];
      return newRankings;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Zusammenfassung</h1>
        <div className="flex flex-col gap-y-1 text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          <span>Übersicht des Jass-Abends</span>
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            {format(sessionDate, "EEEE, d. MMMM yyyy", { locale: de })}
          </span>
          {sessionLocation && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {sessionLocation}
            </span>
          )}
        </div>
      </div>

      {/* Lucky Wheel Tiebreaker */}
      {showTiebreaker && tieGroups.length > 0 && (
        <Card className="border-2 border-primary/50 bg-linear-to-br from-primary/5 to-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
              Gleichstand! Glücksrad entscheidet
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {tieGroups.reduce((sum, g) => sum + g.players.length, 0)} Spieler in {tieGroups.length} Gleichstand-Gruppe{tieGroups.length > 1 ? 'n' : ''} – das Glücksrad entscheidet die Reihenfolge!
            </p>
          </CardHeader>
          <CardContent>
            <LuckyWheel
              tieGroups={tieGroups}
              onComplete={handleWheelComplete}
              allPlayers={rankings}
            />
          </CardContent>
        </Card>
      )}

      {/* Rankings - based on match wins */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
            Schlussrangliste
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            1 Punkt pro gewonnenes Match – Rangliste kann manuell angepasst werden
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {rankings.map((player, index) => {
            const isInTieGroup = tieGroups.some(g => g.players.some(p => p.playerId === player.playerId));
            return (
            <div
              key={player.playerId}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-all",
                isInTieGroup && showTiebreaker && "border-primary/30 bg-primary/5"
              )}
            >
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  aria-label={`${player.name} nach oben verschieben`}
                >
                  <ArrowUp className="h-3 w-3" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveDown(index)}
                  disabled={index === rankings.length - 1}
                  aria-label={`${player.name} nach unten verschieben`}
                >
                  <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold ${
                player.rank === 1
                  ? 'bg-rank-gold text-rank-gold-foreground'
                  : player.rank === 2
                  ? 'bg-rank-silver text-rank-silver-foreground'
                  : player.rank === 3
                  ? 'bg-rank-bronze text-rank-bronze-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {player.rank}
              </div>
              <div className="flex-1">
                <div className="font-medium">{player.name}</div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Medal className="h-3 w-3" aria-hidden="true" />
                  {player.wins} {player.wins === 1 ? 'Sieg' : 'Siege'}
                </div>
              </div>
              <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Payment Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" aria-hidden="true" />
            Zahlungsübersicht
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Detaillierte Auflistung aller Zahlungen mit Bussen
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {payments.map((player) => (
            <div
              key={player.playerId}
              className="rounded-lg border bg-muted/30 p-3 sm:p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-lg font-semibold">{player.name}</span>
                <span className="text-lg font-bold text-primary">{formatCHF(player.total)}</span>
              </div>
              
              {/* Summary Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm mb-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Buy-In:</span>
                  <span>{formatCHF(player.buyIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bussen:</span>
                  <span>{formatCHF(player.fines)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rang-Busse:</span>
                  <span>{formatCHF(player.rankFine)}</span>
                </div>
              </div>

              {/* Detailed Fines List */}
              {player.finesList.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Bussen Details
                  </div>
                  <div className="space-y-1">
                    {player.finesList.map((fine, idx) => {
                      const fineType = FINE_TYPES.find(f => f.id === fine.type);
                      return (
                        <div
                          key={fine.id || idx}
                          className="flex items-start sm:items-center justify-between text-sm rounded bg-card p-2 gap-2"
                        >
                          <div className="flex flex-wrap items-center gap-1 sm:gap-2 min-w-0">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {fine.location}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Match {fine.matchNumber}
                            </span>
                            <span className="text-muted-foreground hidden sm:inline">•</span>
                            <span>{fineType?.label || fine.type}</span>
                            {fine.note && (
                              <span className="text-xs text-muted-foreground">
                                ({fine.note})
                              </span>
                            )}
                          </div>
                          <span className="font-medium shrink-0">{formatCHF(fine.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Rank Fine Legend */}
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="mb-1 font-medium">Rang-Bussen:</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted-foreground">
              {Object.entries(JASS.RANK_FINES).map(([rank, fine]) => (
                <span key={rank}>{rank}. {formatCHF(fine)}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lösli */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" aria-hidden="true" />
            Lösli
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="losli-player" className="text-sm font-medium">Wer ging zuerst nach Hause?</label>
            <Select value={leftFirst} onValueChange={setLeftFirst}>
              <SelectTrigger id="losli-player">
                <SelectValue placeholder="Spieler wählen" />
              </SelectTrigger>
              <SelectContent>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {leftFirst && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm">
              <span className="font-medium text-primary">
                {players.find(p => p.id === leftFirst)?.name}
              </span>{' '}
              muss nächstes Mal Lösli kaufen.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export */}
      <Button
        variant="outline"
        size="lg"
        className="w-full gap-2"
        onClick={() => {
          const dateStr = format(sessionDate, "d. MMMM yyyy", { locale: de });
          exportSessionPdf({
            date: dateStr,
            location: sessionLocation,
            rankings,
            payments: payments.map(p => ({
              name: p.name,
              buyIn: p.buyIn,
              fines: p.fines,
              rankFine: p.rankFine,
              total: p.total,
            })),
            losliPlayerName: leftFirst ? players.find(p => p.id === leftFirst)?.name : undefined,
          });
        }}
      >
        <FileDown className="h-5 w-5" aria-hidden="true" />
        PDF exportieren
      </Button>

      {/* Actions */}
      <Button
        size="lg"
        className="w-full gap-2"
        disabled={isCompleting || showTiebreaker}
        onClick={async () => {
          const sid = state?.sessionId;
          if (!sid) {
            // No session ID (placeholder or history view) — just navigate
            navigate('/dashboard');
            return;
          }

          setIsCompleting(true);
          try {
            const totalPot = payments.reduce((sum, p) => sum + p.total, 0);
            await completeSession.mutateAsync({
              sessionId: sid,
              rankings: rankings.map(r => ({
                playerId: r.playerId,
                finalRank: r.rank,
                totalWins: r.wins,
                totalFines: playerFines[r.playerId] || 0,
              })),
              totalPot,
              losliPlayerId: leftFirst || undefined,
            });
            // Auto-insert kasse transactions for each player's payment
            for (const p of payments) {
              try {
                await createKasseTransaction.mutateAsync({
                  sessionId: sid,
                  playerId: p.playerId,
                  transactionType: 'session_pot',
                  amount: p.total,
                  note: `Session ${format(sessionDate, 'd.M.yyyy')}`,
                });
              } catch {
                // Non-critical — continue with other players
              }
            }
            toast({ title: 'Session gespeichert!' });
            navigate('/dashboard');
          } catch {
            toast({ variant: 'destructive', title: 'Session konnte nicht abgeschlossen werden.' });
            setIsCompleting(false);
          }
        }}
      >
        {isCompleting ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle className="h-5 w-5" aria-hidden="true" />
        )}
        {isCompleting ? 'Speichern...' : 'Session abschliessen'}
      </Button>
    </div>
  );
}
