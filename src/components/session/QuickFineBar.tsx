import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Zap } from 'lucide-react';

interface Player {
  id: string;
  name: string;
}

interface QuickFineBarProps {
  players: Player[];
  onAddFine: (fine: { playerId: string; type: string; amount: number; note?: string }) => void;
}

const QUICK_FINES = [
  { type: 'eichle', label: 'Eichle!', amount: 5 },
  { type: 'match', label: 'Match!', amount: 10 },
  { type: 'weniger', label: 'Weniger!', amount: 5 },
  { type: 'charte', label: 'Charte!', amount: 5 },
] as const;

export function QuickFineBar({ players, onAddFine }: QuickFineBarProps) {
  const [selectedPlayer, setSelectedPlayer] = useState(players[0]?.id || '');

  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-0 z-40 border-t bg-card/95 backdrop-blur-sm p-3 lg:bottom-0 lg:left-64">
      <div className="mx-auto max-w-2xl lg:max-w-4xl">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
          <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {players.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_FINES.map(fine => (
            <Button
              key={fine.type}
              variant="outline"
              size="sm"
              className="h-10 text-xs font-semibold"
              onClick={() => {
                if (!selectedPlayer) return;
                onAddFine({
                  playerId: selectedPlayer,
                  type: fine.type,
                  amount: fine.amount,
                });
              }}
            >
              {fine.label}
              <span className="ml-1 text-muted-foreground">{fine.amount}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
