import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet, Plus, ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react';
import { usePlayers } from '@/hooks/usePlayers';
import { useKasseTransactions, useKasseBalance, useCreateKasseTransaction } from '@/hooks/useKasse';
import { useToast } from '@/hooks/use-toast';
import { formatCHF } from '@/lib/players';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function Kasse() {
  usePageTitle('Kasse');
  const { toast } = useToast();
  const { data: players = [] } = usePlayers();
  const { data: transactions = [], isLoading, error } = useKasseTransactions();
  const { data: balance = 0 } = useKasseBalance();
  const createTransaction = useCreateKasseTransaction();

  const [type, setType] = useState<string>('payout');
  const [amount, setAmount] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast({ variant: 'destructive', title: 'Betrag muss grösser als 0 sein' });
      return;
    }

    const finalAmount = type === 'payout' ? -numAmount : numAmount;

    createTransaction.mutate(
      {
        playerId: playerId || undefined,
        transactionType: type,
        amount: finalAmount,
        note: note || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: 'Transaktion gespeichert' });
          setAmount('');
          setPlayerId('');
          setNote('');
        },
        onError: () => {
          toast({ variant: 'destructive', title: 'Fehler beim Speichern' });
        },
      }
    );
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive" role="alert">
        Daten konnten nicht geladen werden. Bitte versuche es erneut.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Daten werden geladen…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Kasse</h1>
        <p className="text-muted-foreground">Saldo und Transaktionen</p>
      </div>

      {/* Balance */}
      <Card className="bg-linear-to-r from-primary/5 to-primary/10">
        <CardContent className="p-4 text-center sm:p-6">
          <Wallet className="h-8 w-8 text-primary mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aktueller Saldo</p>
          <p className={`text-3xl font-bold ${balance >= 0 ? 'text-primary' : 'text-destructive'}`}>
            {formatCHF(balance)}
          </p>
        </CardContent>
      </Card>

      {/* Add Transaction */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" aria-hidden="true" />
            Neue Transaktion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="kasse-typ" className="text-sm font-medium">Typ</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="kasse-typ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="payout">Auszahlung</SelectItem>
                  <SelectItem value="adjustment">Einzahlung</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="kasse-betrag" className="text-sm font-medium">Betrag (CHF)</label>
              <Input
                id="kasse-betrag"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="kasse-spieler" className="text-sm font-medium">Spieler (optional)</label>
            <Select value={playerId} onValueChange={setPlayerId}>
              <SelectTrigger id="kasse-spieler">
                <SelectValue placeholder="Kein Spieler" />
              </SelectTrigger>
              <SelectContent>
                {players.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="kasse-notiz" className="text-sm font-medium">Notiz (optional)</label>
            <Input
              id="kasse-notiz"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z.B. Auszahlung an Mötzi"
            />
          </div>
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!amount || createTransaction.isPending}
          >
            {createTransaction.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />}
            Speichern
          </Button>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transaktionen</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Noch keine Transaktionen</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {t.amount >= 0 ? (
                      <ArrowDownRight className="h-5 w-5 text-success" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="h-5 w-5 text-destructive" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {t.transaction_type === 'session_pot' ? 'Session-Einzahlung' :
                         t.transaction_type === 'payout' ? 'Auszahlung' : 'Einzahlung'}
                        {t.players?.name && <span className="text-muted-foreground"> – {t.players.name}</span>}
                      </div>
                      {t.note && (
                        <p className="text-xs text-muted-foreground">{t.note}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString('de-CH')}
                      </p>
                    </div>
                  </div>
                  <span className={`font-semibold ${t.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {t.amount >= 0 ? '+' : ''}{formatCHF(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
