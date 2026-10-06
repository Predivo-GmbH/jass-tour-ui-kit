import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Copy, Play, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCreateSession } from '@/hooks/useSessions';
import { usePlayers } from '@/hooks/usePlayers';
import { useToast } from '@/hooks/use-toast';
import { generateJoinCode, createSessionChannel, onSessionEvent, broadcastEvent } from '@/lib/realtime';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function SessionLobby() {
  usePageTitle('Lobby');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: _players = [] } = usePlayers();
  const createSession = useCreateSession();
  const [mode, setMode] = useState<'choose' | 'host' | 'join'>('choose');
  const [joinCode, setJoinCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const [copied, setCopied] = useState(false);

  // Create a new session as host
  const handleHost = async () => {
    setIsCreating(true);
    const code = generateJoinCode();

    try {
      const session = await createSession.mutateAsync({
        date: new Date().toISOString().split('T')[0],
        location: 'TBD',
        totalPot: 0,
      });

      // Save join code
      await supabase
        .from('sessions')
        .update({ join_code: code })
        .eq('id', session.id);

      setSessionId(session.id);
      setJoinCode(code);
      setMode('host');

      // Subscribe to realtime
      const ch = createSessionChannel(session.id);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Track presence
          ch.track({ player: 'host' });
        }
      });

      // Listen for join events
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const names = Object.values(state).flat().map((p: { player?: string }) => p.player || 'Unknown');
        setParticipants(names.filter(n => n !== 'host'));
      });

      setChannel(ch);
    } catch {
      toast({ variant: 'destructive', title: 'Session konnte nicht erstellt werden' });
    }
    setIsCreating(false);
  };

  // Join an existing session
  const handleJoin = async () => {
    if (!inputCode.trim()) return;
    setIsCreating(true);

    const { data, error } = await supabase
      .from('sessions')
      .select('id')
      .eq('join_code', inputCode.toUpperCase())
      .eq('is_completed', false)
      .single();

    if (error || !data) {
      toast({ variant: 'destructive', title: 'Session nicht gefunden' });
      setIsCreating(false);
      return;
    }

    setSessionId(data.id);
    setJoinCode(inputCode.toUpperCase());

    const ch = createSessionChannel(data.id);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.track({ player: 'guest' });
      }
    });

    onSessionEvent(ch, (event) => {
      if (event.type === 'session:start') {
        navigate('/session', { state: { resumeSessionId: data.id, collaborative: true } });
      }
    });

    setChannel(ch);
    setMode('join');
    setIsCreating(false);
  };

  // Start the session (host only)
  const handleStart = () => {
    if (channel) {
      broadcastEvent(channel, { type: 'session:start' });
    }
    navigate('/session', { state: { resumeSessionId: sessionId, collaborative: true } });
  };

  // Cleanup channel on unmount
  useEffect(() => {
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [channel]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (mode === 'choose') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Gemeinsam spielen</h1>
          <p className="text-muted-foreground">Starte oder tritt einer Session bei</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={handleHost}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHost(); } }}
          >
            <CardContent className="flex flex-col items-center justify-center p-4 text-center sm:p-8">
              {isCreating ? (
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" aria-hidden="true" />
              ) : (
                <Play className="h-12 w-12 text-primary mb-4" aria-hidden="true" />
              )}
              <h2 className="text-lg font-semibold">Session erstellen</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Erstelle eine Session und teile den Code
              </p>
            </CardContent>
          </Card>

          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex flex-col items-center justify-center p-4 text-center sm:p-8">
              <Users className="h-12 w-12 text-primary mb-4" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Session beitreten</h2>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Gib den Code ein, um beizutreten
              </p>
              <div className="flex gap-2 w-full max-w-xs">
                <Input
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  aria-label="Session-Code"
                  className="text-center font-mono text-lg tracking-widest"
                  maxLength={6}
                />
                <Button onClick={handleJoin} disabled={isCreating || !inputCode.trim()}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Beitreten'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (mode === 'host') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Session Lobby</h1>
          <p className="text-muted-foreground">Warte auf Mitspieler</p>
        </div>

        {/* Join Code */}
        <Card className="bg-linear-to-r from-primary/5 to-primary/10">
          <CardContent className="p-4 text-center sm:p-8">
            <p className="text-sm text-muted-foreground mb-2">Session Code:</p>
            <div className="flex items-center justify-center gap-4">
              <span className="text-3xl font-mono font-bold tracking-[0.3em] text-primary sm:text-5xl">
                {joinCode}
              </span>
              <Button variant="ghost" size="icon" onClick={copyCode} aria-label="Code kopieren">
                {copied ? <CheckCircle className="h-5 w-5 text-success" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Participants */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
              Mitspieler ({participants.length + 1}/4)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-primary/5">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                Du
              </div>
              <span className="font-medium">Host</span>
            </div>
            {participants.map((name, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                  {i + 2}
                </div>
                <span className="font-medium">{name}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button size="lg" className="w-full gap-2" onClick={handleStart}>
          <Play className="h-5 w-5" aria-hidden="true" />
          Session starten
        </Button>
      </div>
    );
  }

  // Join mode — waiting for host to start
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Session beigetreten</h1>
        <p className="text-muted-foreground">Code: {joinCode}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center p-4 text-center sm:p-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold" role="status" aria-live="polite">Warte auf Host...</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Die Session wird gleich gestartet
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
