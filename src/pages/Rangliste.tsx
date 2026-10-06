import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, Info, Loader2, TrendingUp, Calendar, Medal, Flame, Target, Frown, Crown, Snowflake, Award, Star, Sparkles, FileDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { exportRankingsCsv } from '@/lib/exportCsv';
import { usePageTitle } from '@/hooks/usePageTitle';

interface PlayerStats {
  playerId: string;
  name: string;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  totalSessions: number;
  note?: string;
}

interface SessionDetail {
  id: string;
  date: string;
  location: string;
  totalPot: number;
  rankings: {
    playerId: string;
    playerName: string;
    rank: number;
  }[];
}

// Player notes
const PLAYER_NOTES: { [key: string]: string } = {
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890': '(nur 2015–2020)',
  '07743f48-0e1e-440c-8706-5d96587748a1': '(ab 2021)',
};

export default function Rangliste() {
  usePageTitle('Rangliste');
  // Fetch all-time rankings with rank distribution
  const { data: rankings = [], isLoading: rankingsLoading, error: rankingsError } = useQuery({
    queryKey: ['all-time-rankings-detailed'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('session_rankings')
        .select('player_id, final_rank, players(name)');
      
      if (error) throw error;
      
      // Aggregate stats per player
      const statsMap: { [key: string]: PlayerStats } = {};
      
      (data || []).forEach((ranking: { player_id: string; final_rank: number; players: { name: string } | null }) => {
        const playerId = ranking.player_id;
        if (!statsMap[playerId]) {
          statsMap[playerId] = {
            playerId,
            name: ranking.players?.name || 'Unknown',
            rank1: 0,
            rank2: 0,
            rank3: 0,
            rank4: 0,
            totalSessions: 0,
            note: PLAYER_NOTES[playerId],
          };
        }
        statsMap[playerId].totalSessions += 1;
        
        if (ranking.final_rank === 1) statsMap[playerId].rank1 += 1;
        else if (ranking.final_rank === 2) statsMap[playerId].rank2 += 1;
        else if (ranking.final_rank === 3) statsMap[playerId].rank3 += 1;
        else if (ranking.final_rank === 4) statsMap[playerId].rank4 += 1;
      });
      
      return Object.values(statsMap).sort((a, b) => b.rank1 - a.rank1);
    },
  });

  // Fetch individual sessions since 2021 (exclude historical entries)
  const { data: sessions = [], isLoading: sessionsLoading, error: sessionsError } = useQuery({
    queryKey: ['session-details-since-2021'],
    queryFn: async () => {
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('sessions')
        .select('id, date, location, total_pot')
        .gte('date', '2021-01-01')
        .eq('location', 'Jass-Abend')
        .eq('is_completed', true)
        .order('date', { ascending: false });
      
      if (sessionsError) throw sessionsError;
      
      const sessionIds = sessionsData?.map(s => s.id) || [];
      const { data: rankingsData, error: rankingsError } = await supabase
        .from('session_rankings')
        .select('session_id, player_id, final_rank, players(name)')
        .in('session_id', sessionIds);
      
      if (rankingsError) throw rankingsError;
      
      const result: SessionDetail[] = (sessionsData || []).map(session => ({
        id: session.id,
        date: session.date,
        location: session.location,
        totalPot: session.total_pot,
        rankings: (rankingsData || [])
          .filter((r: { session_id: string; player_id: string; final_rank: number; players: { name: string } | null }) => r.session_id === session.id)
          .map((r) => ({
            playerId: r.player_id,
            playerName: r.players?.name || 'Unknown',
            rank: r.final_rank,
          }))
          .sort((a, b) => a.rank - b.rank),
      }));
      
      return result;
    },
  });

  const isLoading = rankingsLoading || sessionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Daten werden geladen…</span>
      </div>
    );
  }

  if (rankingsError || sessionsError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive" role="alert">
        Daten konnten nicht geladen werden. Bitte versuche es erneut.
      </div>
    );
  }

  // Calculate fun statistics
  const funStats = calculateFunStats(rankings);
  const totalSessions2021 = sessions.length;
  const totalSessionsHistorical = 17;
  const totalSessionsAll = totalSessions2021 + totalSessionsHistorical;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Ewige Rangliste</h1>
          <p className="text-muted-foreground">2015–2026 • {totalSessionsAll} Abende</p>
        </div>
        {rankings.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => exportRankingsCsv(rankings.map(r => ({
              name: r.name,
              sessions: r.totalSessions,
              wins: r.rank1,
              avgRank: r.totalSessions > 0
                ? (r.rank1 * 1 + r.rank2 * 2 + r.rank3 * 3 + r.rank4 * 4) / r.totalSessions
                : 0,
              totalFines: 0,
            })))}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            CSV
          </Button>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{totalSessionsHistorical}</div>
            <div className="text-xs text-muted-foreground">2015–2020</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{totalSessions2021}</div>
            <div className="text-xs text-muted-foreground">Ab 2021</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-lg font-bold text-primary truncate sm:text-2xl">{rankings[0]?.name || '-'}</div>
            <div className="text-xs text-muted-foreground">Leader</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{rankings[0]?.rank1 || 0}</div>
            <div className="text-xs text-muted-foreground">Siege (Leader)</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rangliste" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="rangliste" className="gap-1.5">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Rangliste</span>
            <span className="sr-only sm:hidden">Rangliste</span>
          </TabsTrigger>
          <TabsTrigger value="statistiken" className="gap-1.5">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Statistiken</span>
            <span className="sr-only sm:hidden">Statistiken</span>
          </TabsTrigger>
          <TabsTrigger value="einzelabende" className="gap-1.5">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Einzelabende</span>
            <span className="sr-only sm:hidden">Einzelabende</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab: Rangliste */}
        <TabsContent value="rangliste" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
                Ewige Rangliste 2015–2026
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rankings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Noch keine Daten vorhanden.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Rang</TableHead>
                      <TableHead>Spieler</TableHead>
                      <TableHead className="text-right">1.</TableHead>
                      <TableHead className="text-right">2.</TableHead>
                      <TableHead className="text-right">3.</TableHead>
                      <TableHead className="text-right">4.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankings.map((player, index) => (
                      <TableRow key={player.playerId}>
                        <TableCell>
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold ${
                            index === 0
                              ? 'bg-rank-gold text-rank-gold-foreground'
                              : index === 1
                              ? 'bg-rank-silver text-rank-silver-foreground'
                              : index === 2
                              ? 'bg-rank-bronze text-rank-bronze-foreground'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{player.name}</div>
                          {player.note && (
                            <div className="text-xs text-muted-foreground">{player.note}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          {player.rank1}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {player.rank2}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {player.rank3}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {player.rank4}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-medium">Datenqualität</h2>
                <p className="text-sm text-muted-foreground">
                  2015–2020: 17 Abende. Ab 2021: {totalSessions2021} Abende. Jassreisen nicht enthalten.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Statistiken */}
        <TabsContent value="statistiken" className="space-y-4">
          {/* Fun Awards - max 2 mentions per player */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Medal className="h-5 w-5 text-primary" aria-hidden="true" />
                Spezial-Awards 🏆
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {funStats.awards.map((award, index) => (
                <AwardCard 
                  key={index}
                  icon={award.icon} 
                  title={award.title} 
                  winner={award.winner}
                  description={award.description}
                  color={award.color}
                />
              ))}
            </CardContent>
          </Card>
          
          {/* Fun Comparisons */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
                Kuriose Statistiken 🤔
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {funStats.funComparisons.map((comp, index) => (
                <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl">{comp.emoji}</div>
                  <div>
                    <div className="font-medium">{comp.title}</div>
                    <div className="text-sm text-muted-foreground">{comp.description}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Player Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
                Spieler-Analyse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {rankings.map((player, index) => {
                const total = player.rank1 + player.rank2 + player.rank3 + player.rank4;
                const winRate = total > 0 ? ((player.rank1 / total) * 100).toFixed(1) : '0';
                const avgRank = total > 0 
                  ? ((player.rank1 * 1 + player.rank2 * 2 + player.rank3 * 3 + player.rank4 * 4) / total).toFixed(2)
                  : '-';
                const podiumRate = total > 0 
                  ? (((player.rank1 + player.rank2 + player.rank3) / total) * 100).toFixed(0) 
                  : '0';
                
                return (
                  <div key={player.playerId} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold ${
                          index === 0
                            ? 'bg-rank-gold text-rank-gold-foreground'
                            : index === 1
                            ? 'bg-rank-silver text-rank-silver-foreground'
                            : index === 2
                            ? 'bg-rank-bronze text-rank-bronze-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <span className="font-medium">{player.name}</span>
                          {player.note && (
                            <span className="ml-1 text-xs text-muted-foreground">{player.note}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-primary font-semibold">{winRate}%</span>
                        <span className="text-muted-foreground"> Siege</span>
                      </div>
                    </div>
                    
                    {/* Visual bar chart */}
                    <div className="flex h-6 overflow-hidden rounded-md">
                      {player.rank1 > 0 && (
                        <div 
                          className="bg-yellow-400 flex items-center justify-center text-xs font-medium text-yellow-900 min-w-5"
                          style={{ width: `${(player.rank1 / total) * 100}%` }}
                        >
                          {player.rank1}
                        </div>
                      )}
                      {player.rank2 > 0 && (
                        <div 
                          className="bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-700 min-w-5"
                          style={{ width: `${(player.rank2 / total) * 100}%` }}
                        >
                          {player.rank2}
                        </div>
                      )}
                      {player.rank3 > 0 && (
                        <div 
                          className="bg-orange-300 flex items-center justify-center text-xs font-medium text-orange-800 min-w-5"
                          style={{ width: `${(player.rank3 / total) * 100}%` }}
                        >
                          {player.rank3}
                        </div>
                      )}
                      {player.rank4 > 0 && (
                        <div 
                          className="bg-red-200 flex items-center justify-center text-xs font-medium text-red-700 min-w-5"
                          style={{ width: `${(player.rank4 / total) * 100}%` }}
                        >
                          {player.rank4}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{total} Abende • Ø {avgRank}</span>
                      <span>Podium: {podiumRate}%</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Fun Facts */}
          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-4 space-y-3">
              <h2 className="font-medium flex items-center gap-2">
                Fun Facts
              </h2>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>🎲 <strong>Zufall?</strong> Die Wahrscheinlichkeit, 13x zu gewinnen bei 34 Abenden liegt bei nur ~2.4%</li>
                <li>📊 <strong>Statistik:</strong> Rötschi gewinnt durchschnittlich jeden 2.6. Abend</li>
                <li>🏆 <strong>Rekord:</strong> Der höchste Kassenstand war CHF 2'300 am 30.06.2023</li>
                <li>📅 <strong>Jubiläum:</strong> {totalSessionsAll} Jass-Abende seit 2015 – das ist echt beeindruckend!</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Einzelabende */}
        <TabsContent value="einzelabende" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
                Einzelabende ab 2021
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Keine Abende gefunden.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Datum</TableHead>
                        <TableHead className="text-center">1.</TableHead>
                        <TableHead className="text-center">2.</TableHead>
                        <TableHead className="text-center">3.</TableHead>
                        <TableHead className="text-center">4.</TableHead>
                        <TableHead className="text-right">Kasse</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => {
                        const getRankPlayer = (rank: number) => 
                          session.rankings.find(r => r.rank === rank)?.playerName || '-';
                        
                        // Calculate running total from this session onwards (sessions are sorted desc)
                        const sessionDate = new Date(session.date);
                        const cutoffDate = new Date('2026-01-16');
                        const showKasse = sessionDate >= cutoffDate;
                        
                        // Calculate total: sum of all sessions from this one to the latest
                        const runningTotal = showKasse 
                          ? sessions
                              .filter(s => new Date(s.date) >= cutoffDate)
                              .slice(0, sessions.findIndex(s => s.id === session.id) + 1)
                              .reduce((sum, s) => sum + s.totalPot, 0)
                          : 0;
                        
                        return (
                          <TableRow key={session.id}>
                            <TableCell className="font-medium whitespace-nowrap">
                              {sessionDate.toLocaleDateString('de-CH', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric'
                              })}
                            </TableCell>
                            <TableCell className="text-center text-primary font-medium">
                              {getRankPlayer(1)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getRankPlayer(2)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getRankPlayer(3)}
                            </TableCell>
                            <TableCell className="text-center text-muted-foreground">
                              {getRankPlayer(4)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-xs">
                              {showKasse ? (
                                <div>
                                  <div>CHF {session.totalPot}</div>
                                  <div className="font-medium text-foreground">Total: {runningTotal}</div>
                                </div>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AwardCard({ 
  icon: Icon, 
  title, 
  winner, 
  description, 
  color 
}: { 
  icon: React.ElementType; 
  title: string; 
  winner: string; 
  description: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-muted ${color}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="font-semibold truncate">{winner}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function calculateFunStats(rankings: PlayerStats[]) {
  if (rankings.length === 0) {
    return { awards: [], funComparisons: [] };
  }

  // Track mentions per player (max 2)
  const mentions: { [key: string]: number } = {};
  const canMention = (name: string) => (mentions[name] || 0) < 2;
  const addMention = (name: string) => { mentions[name] = (mentions[name] || 0) + 1; };

  // Calculate all stats
  const statsWithCalc = rankings.map(p => {
    const total = p.rank1 + p.rank2 + p.rank3 + p.rank4;
    const avg = total > 0 ? (p.rank1 * 1 + p.rank2 * 2 + p.rank3 * 3 + p.rank4 * 4) / total : 10;
    const winRate = total > 0 ? (p.rank1 / total) * 100 : 0;
    const podiumRate = total > 0 ? ((p.rank1 + p.rank2 + p.rank3) / total) * 100 : 0;
    const lastPlaceRate = total > 0 ? (p.rank4 / total) * 100 : 0;
    return { ...p, avg, winRate, podiumRate, lastPlaceRate, total };
  });

  const awards: Array<{icon: React.ElementType; title: string; winner: string; description: string; color: string}> = [];

  // 1. Jass-König (most wins)
  const king = statsWithCalc.reduce((best, p) => p.rank1 > best.rank1 ? p : best);
  if (canMention(king.name)) {
    awards.push({ icon: Crown, title: '👑 Jass-König', winner: king.name, description: `${king.rank1} Siege total`, color: 'text-yellow-600' });
    addMention(king.name);
  }

  // 2. Pechvogel (most 4th places)
  const unlucky = statsWithCalc.reduce((best, p) => p.rank4 > best.rank4 ? p : best);
  if (canMention(unlucky.name)) {
    awards.push({ icon: Frown, title: '😢 Pechvogel', winner: unlucky.name, description: `${unlucky.rank4}x letzter Platz`, color: 'text-red-500' });
    addMention(unlucky.name);
  }

  // 3. Silber-Sammler (most 2nd places)
  const silverCollector = statsWithCalc.reduce((best, p) => p.rank2 > best.rank2 ? p : best);
  if (canMention(silverCollector.name)) {
    awards.push({ icon: Award, title: '🥈 Silber-Sammler', winner: silverCollector.name, description: `${silverCollector.rank2}x zweiter Platz`, color: 'text-gray-500' });
    addMention(silverCollector.name);
  }

  // 4. Bronzener Held (most 3rd places)
  const bronzeHero = statsWithCalc.reduce((best, p) => p.rank3 > best.rank3 ? p : best);
  if (canMention(bronzeHero.name)) {
    awards.push({ icon: Medal, title: '🥉 Bronze-Held', winner: bronzeHero.name, description: `${bronzeHero.rank3}x dritter Platz`, color: 'text-orange-600' });
    addMention(bronzeHero.name);
  }

  // 5. Heisse Phase (consecutive wins) - Rötschi had 3 in 2023
  const hotStreak = statsWithCalc.find(p => p.name === 'Rötschi');
  if (hotStreak && canMention(hotStreak.name)) {
    awards.push({ icon: Flame, title: '🔥 Heisse Phase', winner: hotStreak.name, description: '3 Siege in Folge (2023)', color: 'text-orange-600' });
    addMention(hotStreak.name);
  }

  // 6. Newcomer Award - Mötzi (started 2021, already 3 wins)
  const newcomer = statsWithCalc.find(p => p.name === 'Mötzi');
  if (newcomer && canMention(newcomer.name)) {
    awards.push({ icon: Star, title: '⭐ Newcomer', winner: newcomer.name, description: `${newcomer.rank1} Siege seit 2021`, color: 'text-purple-600' });
    addMention(newcomer.name);
  }

  // 7. Eiskalter Killer (best win rate among active)
  const coldKiller = statsWithCalc.filter(p => p.total >= 10).reduce((best, p) => p.winRate > best.winRate ? p : best, statsWithCalc[0]);
  if (canMention(coldKiller.name)) {
    awards.push({ icon: Snowflake, title: '🧊 Eiskalt', winner: coldKiller.name, description: `${coldKiller.winRate.toFixed(0)}% Siegquote`, color: 'text-blue-500' });
    addMention(coldKiller.name);
  }

  // 8. Podiums-Garant (best podium rate)
  const podiumKing = statsWithCalc.filter(p => p.total >= 10).reduce((best, p) => p.podiumRate > best.podiumRate ? p : best, statsWithCalc[0]);
  if (canMention(podiumKing.name)) {
    awards.push({ icon: Target, title: '🎯 Podiums-Garant', winner: podiumKing.name, description: `${podiumKing.podiumRate.toFixed(0)}% auf Podium`, color: 'text-green-600' });
    addMention(podiumKing.name);
  }

  // Fun comparisons
  const funComparisons = [
    {
      emoji: '🎲',
      title: 'Wahrscheinlichkeit von Rötschis Dominanz',
      description: `Bei reinem Zufall hätte Rötschi 8.5 Siege erwartet – er hat ${king.rank1}. Das ist statistisch signifikant!`
    },
    {
      emoji: '📊',
      title: 'Polis Extreme',
      description: `${unlucky.rank4}x letzter, aber auch ${unlucky.rank1}x erster – grosse Bandbreite!`
    },
    {
      emoji: '⚡',
      title: 'Mötzi vs. Michi',
      description: 'Beide haben 17 Abende gespielt – nur in verschiedenen Ären (2015-20 vs. 2021+)'
    },
    {
      emoji: '🏆',
      title: 'Rötschi = 38% aller Siege',
      description: `${king.rank1} von 34 Abenden gewonnen – fast 4 von 10!`
    },
    {
      emoji: '🎰',
      title: 'Wer gewinnt öfter nach einem 4. Platz?',
      description: 'Husi schafft es am häufigsten, nach einem letzten Platz zurückzuschlagen'
    },
    {
      emoji: '📅',
      title: '10+ Jahre Jass-Geschichte',
      description: 'Von Februar 2015 bis Januar 2026 – über ein Jahrzehnt Tradition!'
    }
  ];

  return { awards, funComparisons };
}
