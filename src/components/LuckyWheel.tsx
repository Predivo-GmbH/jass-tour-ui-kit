import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Trophy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Player {
  playerId: string;
  name: string;
  wins: number;
  rank: number;
}

interface TieGroup {
  wins: number;
  startRank: number;
  players: Player[];
}

interface LuckyWheelProps {
  tieGroups: TieGroup[];
  onComplete: (finalRankings: Player[]) => void;
  allPlayers: Player[];
}

const WHEEL_COLORS = [
  'hsl(0, 84%, 55%)',      // Red
  'hsl(45, 93%, 47%)',     // Orange/Yellow
  'hsl(142, 71%, 40%)',    // Green
  'hsl(217, 91%, 55%)',    // Blue
];

// Create SVG arc path for a pie segment
function createArcPath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const startRad = (startAngle - 90) * (Math.PI / 180);
  const endRad = (endAngle - 90) * (Math.PI / 180);
  
  const x1 = centerX + radius * Math.cos(startRad);
  const y1 = centerY + radius * Math.sin(startRad);
  const x2 = centerX + radius * Math.cos(endRad);
  const y2 = centerY + radius * Math.sin(endRad);
  
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  
  return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
}

// Get text position for a segment
function getTextPosition(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
): { x: number; y: number; rotation: number } {
  const midAngle = (startAngle + endAngle) / 2;
  const rad = (midAngle - 90) * (Math.PI / 180);
  const textRadius = radius * 0.6;
  
  return {
    x: centerX + textRadius * Math.cos(rad),
    y: centerY + textRadius * Math.sin(rad),
    rotation: midAngle,
  };
}

export function LuckyWheel({ tieGroups, onComplete, allPlayers }: LuckyWheelProps) {
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [remainingInGroup, setRemainingInGroup] = useState<Player[]>([]);
  const [resolvedPlayers, setResolvedPlayers] = useState<Player[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [winner, setWinner] = useState<Player | null>(null);
  const [currentRankInGroup, setCurrentRankInGroup] = useState(0);

  const wheelSize = 240;
  const center = wheelSize / 2;
  const radius = wheelSize / 2 - 12;

  // Initialize first group
  useEffect(() => {
    if (tieGroups.length > 0 && remainingInGroup.length === 0) {
      setRemainingInGroup([...tieGroups[0].players]);
      setCurrentRankInGroup(tieGroups[0].startRank);
    }
  }, [tieGroups, remainingInGroup.length]);

  const currentGroup = tieGroups[currentGroupIndex];
  const segmentAngle = remainingInGroup.length > 0 ? 360 / remainingInGroup.length : 360;

  const spinWheel = () => {
    if (isSpinning || remainingInGroup.length === 0) return;

    setIsSpinning(true);
    setShowResult(false);

    // Random rotations
    const fullRotations = 4 + Math.random() * 3;
    const randomAngle = Math.random() * 360;
    const targetRotation = rotation + (fullRotations * 360) + randomAngle;

    setRotation(targetRotation);

    setTimeout(() => {
      setIsSpinning(false);
      
      // Calculate winner
      const normalizedRotation = ((targetRotation % 360) + 360) % 360;
      const pointerAngle = (360 - normalizedRotation + 360) % 360;
      const winnerIndex = Math.floor(pointerAngle / segmentAngle) % remainingInGroup.length;
      const selectedPlayer = remainingInGroup[winnerIndex];
      
      // Assign rank to winner
      const rankedPlayer = { ...selectedPlayer, rank: currentRankInGroup };
      
      setWinner(rankedPlayer);
      setShowResult(true);
      setResolvedPlayers(prev => [...prev, rankedPlayer]);
      
      const newRemaining = remainingInGroup.filter(p => p.playerId !== selectedPlayer.playerId);
      
      setTimeout(() => {
        if (newRemaining.length === 1) {
          // Last player in group gets the remaining rank
          const lastPlayer = { ...newRemaining[0], rank: currentRankInGroup + 1 };
          const allResolved = [...resolvedPlayers, rankedPlayer, lastPlayer];
          setResolvedPlayers(allResolved);
          
          // Move to next group or finish
          const nextGroupIndex = currentGroupIndex + 1;
          if (nextGroupIndex < tieGroups.length) {
            setTimeout(() => {
              setCurrentGroupIndex(nextGroupIndex);
              setRemainingInGroup([...tieGroups[nextGroupIndex].players]);
              setCurrentRankInGroup(tieGroups[nextGroupIndex].startRank);
              setShowResult(false);
              setWinner(null);
            }, 1000);
          } else {
            // All done - merge with non-tied players and complete
            const nonTiedPlayers = allPlayers.filter(
              p => !tieGroups.some(g => g.players.some(gp => gp.playerId === p.playerId))
            );
            const finalRankings = [...allResolved, ...nonTiedPlayers].sort((a, b) => a.rank - b.rank);
            setTimeout(() => onComplete(finalRankings), 500);
          }
        } else if (newRemaining.length > 1) {
          setRemainingInGroup(newRemaining);
          setCurrentRankInGroup(currentRankInGroup + 1);
          setShowResult(false);
          setWinner(null);
        } else {
          // Only one player was in the group - shouldn't happen but handle it
          const nextGroupIndex = currentGroupIndex + 1;
          if (nextGroupIndex < tieGroups.length) {
            setCurrentGroupIndex(nextGroupIndex);
            setRemainingInGroup([...tieGroups[nextGroupIndex].players]);
            setCurrentRankInGroup(tieGroups[nextGroupIndex].startRank);
          } else {
            const nonTiedPlayers = allPlayers.filter(
              p => !tieGroups.some(g => g.players.some(gp => gp.playerId === p.playerId))
            );
            const finalRankings = [...resolvedPlayers, rankedPlayer, ...nonTiedPlayers].sort((a, b) => a.rank - b.rank);
            onComplete(finalRankings);
          }
        }
      }, 1500);
    }, 3500);
  };

  // Calculate already resolved groups
  const resolvedGroups = tieGroups.slice(0, currentGroupIndex);
  const pendingGroups = tieGroups.slice(currentGroupIndex + 1);

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      {/* Progress Overview */}
      <div className="w-full space-y-3">
        {/* Resolved tie groups */}
        {resolvedGroups.map((group, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-2">
            <Check className="h-4 w-4 text-success" aria-hidden="true" />
            <span>Gleichstand bei {group.wins} {group.wins === 1 ? 'Sieg' : 'Siegen'} aufgelöst</span>
          </div>
        ))}

        {/* Current group indicator */}
        {currentGroup && (
          <div className="flex items-center gap-2 text-sm font-medium bg-primary/10 rounded-lg p-3">
            <Sparkles className="h-4 w-4 text-primary animate-pulse" aria-hidden="true" />
            <span>
              Gleichstand bei {currentGroup.wins} {currentGroup.wins === 1 ? 'Sieg' : 'Siegen'}: 
              Plätze {currentGroup.startRank}–{currentGroup.startRank + currentGroup.players.length - 1}
            </span>
          </div>
        )}

        {/* Pending groups */}
        {pendingGroups.map((group, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-2">
            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
            <span>Danach: {group.wins} {group.wins === 1 ? 'Sieg' : 'Siegen'} ({group.players.length} Spieler)</span>
          </div>
        ))}
      </div>

      {/* Already assigned ranks in current group */}
      {resolvedPlayers.filter(p => 
        currentGroup && currentGroup.players.some(gp => gp.playerId === p.playerId)
      ).length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {resolvedPlayers
            .filter(p => currentGroup && currentGroup.players.some(gp => gp.playerId === p.playerId))
            .map((player) => (
              <div
                key={player.playerId}
                className="flex items-center gap-2 rounded-full bg-green-100 text-green-800 px-3 py-1 text-sm font-medium"
              >
                <Trophy className="h-3 w-3" aria-hidden="true" />
                <span>{player.rank}. {player.name}</span>
              </div>
            ))}
        </div>
      )}

      {/* Wheel */}
      {remainingInGroup.length > 0 && (
        <div className="relative">
          {/* Pointer */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10">
            <div className="w-0 h-0 border-l-14 border-r-14 border-t-24 border-l-transparent border-r-transparent border-t-primary drop-shadow-lg" />
          </div>

          {/* SVG Wheel */}
          <svg
            width={wheelSize}
            height={wheelSize}
            className="drop-shadow-xl"
            aria-hidden="true"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: isSpinning ? 'transform 3.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none',
            }}
          >
            {/* Outer ring */}
            <circle
              cx={center}
              cy={center}
              r={radius + 8}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="4"
            />
            
            {/* Segments */}
            {remainingInGroup.map((player, index) => {
              const startAngle = index * segmentAngle;
              const endAngle = (index + 1) * segmentAngle;
              const path = createArcPath(center, center, radius, startAngle, endAngle);
              const textPos = getTextPosition(center, center, radius, startAngle, endAngle);
              const color = WHEEL_COLORS[index % WHEEL_COLORS.length];
              
              return (
                <g key={player.playerId}>
                  <path
                    d={path}
                    fill={color}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <text
                    x={textPos.x}
                    y={textPos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="text-sm font-bold"
                    fill="white"
                    textLength={radius * 0.7}
                    lengthAdjust="spacingAndGlyphs"
                    style={{
                      transform: `rotate(${textPos.rotation}deg)`,
                      transformOrigin: `${textPos.x}px ${textPos.y}px`,
                    }}
                  >
                    {player.name.length > 8 ? player.name.slice(0, 8) + '\u2026' : player.name}
                  </text>
                </g>
              );
            })}
            
            {/* Center circle */}
            <circle
              cx={center}
              cy={center}
              r={22}
              fill="white"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
            />
            <text
              x={center}
              y={center}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs font-bold fill-primary"
            >
              {currentRankInGroup}.
            </text>
          </svg>
        </div>
      )}

      {/* Result announcement */}
      {showResult && winner && (
        <div className="animate-scale-in text-center space-y-1 bg-green-50 rounded-lg p-4 border border-green-200">
          <p className="text-xl font-bold text-green-700">🎉 {winner.name}!</p>
          <p className="text-sm text-green-600">
            bekommt Platz {winner.rank}
          </p>
        </div>
      )}

      {/* Spin button */}
      {remainingInGroup.length > 0 && !showResult && (
        <Button
          onClick={spinWheel}
          disabled={isSpinning}
          size="lg"
          className={cn(
            "gap-2 min-w-[220px]",
            isSpinning && "animate-pulse"
          )}
        >
          <Sparkles className={cn("h-5 w-5", isSpinning && "animate-spin")} aria-hidden="true" />
          {isSpinning 
            ? 'Dreht...' 
            : `Platz ${currentRankInGroup} auslosen!`
          }
        </Button>
      )}

      {/* Remaining info */}
      {remainingInGroup.length > 1 && !showResult && !isSpinning && (
        <p className="text-xs text-muted-foreground text-center wrap-break-word max-w-full">
          Noch zu vergeben: {remainingInGroup.map(p => p.name).join(' vs ')}
        </p>
      )}
    </div>
  );
}
