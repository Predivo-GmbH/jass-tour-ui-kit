import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Play, History, FileText, Trophy, Edit, Loader2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAppSettings, useUpdateNextDate } from '@/hooks/useAppSettings';
import { useIncompleteSession, useDeleteSession } from '@/hooks/useSessions';
import { useToast } from '@/hooks/use-toast';
import { JASS } from '@/lib/constants';

export default function Dashboard() {
  usePageTitle('Dashboard');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('20:00');
  
  const { data: settings, isLoading, error } = useAppSettings();
  const updateNextDate = useUpdateNextDate();
  const { data: incompleteSession } = useIncompleteSession();
  const deleteSession = useDeleteSession();

  const nextDate = settings?.next_date ? new Date(settings.next_date) : null;
  const countdown = nextDate ? getCountdown(nextDate) : { days: 0, hours: 0, minutes: 0 };

  const handleSaveDate = () => {
    if (!newDate) return;
    
    const [hours, minutes] = newTime.split(':').map(Number);
    const dateTime = new Date(newDate);
    dateTime.setHours(hours, minutes, 0, 0);
    
    updateNextDate.mutate(dateTime, {
      onSuccess: () => {
        toast({ title: 'Termin gespeichert!' });
        setEditOpen(false);
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Fehler beim Speichern' });
      },
    });
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive" role="alert">
        Daten konnten nicht geladen werden. Bitte versuche es erneut.
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Willkommen</h1>
        <p className="text-muted-foreground">Bereit für den nächsten Jass-Abend?</p>
      </div>

      {/* Incomplete Session Banner */}
      {incompleteSession && (
        <Card className="border-2 border-primary/50 bg-linear-to-r from-primary/5 to-primary/10">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <h2 className="font-semibold text-primary">Session in Arbeit</h2>
                <p className="text-sm text-muted-foreground">
                  {incompleteSession.completedMatches}/{JASS.MATCHES_PER_SESSION} Matches gespielt
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    deleteSession.mutate(incompleteSession.id, {
                      onSuccess: () => toast({ title: 'Session abgebrochen' }),
                    });
                  }}
                  disabled={deleteSession.isPending}
                >
                  Abbrechen
                </Button>
                <Button
                  size="sm"
                  className="flex-1 sm:flex-initial"
                  onClick={() => navigate('/session', { state: { resumeSessionId: incompleteSession.id } })}
                >
                  <Play className="h-4 w-4 mr-1" aria-hidden="true" />
                  Fortsetzen
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Date Card */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-primary/5 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
              Nächster Termin
            </CardTitle>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                  <Edit className="h-4 w-4" aria-hidden="true" />
                  Bearbeiten
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Termin bearbeiten</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label htmlFor="edit-date" className="text-sm font-medium">Datum</label>
                    <Input
                      id="edit-date"
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-time" className="text-sm font-medium">Zeit</label>
                    <Input
                      id="edit-time"
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleSaveDate}
                    disabled={!newDate || updateNextDate.isPending}
                  >
                    {updateNextDate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Speichern
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <span className="sr-only">Daten werden geladen…</span>
            </div>
          ) : nextDate ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-base font-medium sm:text-lg">
                <Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                {nextDate.toLocaleDateString('de-CH', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'long',
                  year: 'numeric'
                })} um {nextDate.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
              </div>
              
              {/* Countdown */}
              <div className="grid grid-cols-3 gap-3">
                <CountdownUnit value={countdown.days} label="Tage" />
                <CountdownUnit value={countdown.hours} label="Stunden" />
                <CountdownUnit value={countdown.minutes} label="Minuten" />
              </div>
            </>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              Noch kein Termin festgelegt
            </div>
          )}
        </CardContent>
      </Card>

      {/* Primary Actions */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          size="lg"
          className="h-14 gap-2 text-base font-semibold shadow-md"
          onClick={() => navigate('/session')}
        >
          <Play className="h-5 w-5" aria-hidden="true" />
          Neue Session starten
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-14 gap-2 text-base font-semibold"
          onClick={() => navigate('/lobby')}
        >
          <Users className="h-5 w-5" aria-hidden="true" />
          Gemeinsam spielen
        </Button>
      </div>

      {/* Secondary Actions */}
      <Button
        variant="outline"
        className="w-full gap-2 text-muted-foreground"
        onClick={() => navigate('/history')}
      >
        <History className="h-4 w-4" aria-hidden="true" />
        Vergangene Abende
      </Button>

      {/* Quick Access */}
      <div className="grid gap-3 sm:grid-cols-2">
        <QuickAccessCard 
          icon={FileText} 
          title="Statuten" 
          description="Regeln & Bussen"
          onClick={() => navigate('/statuten')}
        />
        <QuickAccessCard 
          icon={Trophy} 
          title="Ewige Rangliste" 
          description="Alle Zeiten"
          onClick={() => navigate('/rangliste')}
        />
      </div>
    </div>
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted p-3 text-center">
      <div className="text-3xl font-bold text-primary">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function QuickAccessCard({ 
  icon: Icon, 
  title, 
  description,
  onClick 
}: { 
  icon: React.ElementType; 
  title: string; 
  description: string;
  onClick: () => void;
}) {
  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getCountdown(targetDate: Date) {
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();
  
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { days, hours, minutes };
}
