import React from 'react';
import type { Room } from '../types';
import './GameUI.css';

interface GameUIProps {
    room: Room | null;
    playerId: string | undefined;
}

const GameUI: React.FC<GameUIProps> = ({ room, playerId }) => {
    if (!room) return <div className="hud-waiting">Waiting for players…</div>;

    // Solo: game over when time runs out; Multiplayer: game over when round > maxRounds
    const isGameOver = room.mode === 'solo'
        ? room.timeRemaining <= 0
        : room.round > room.maxRounds;
    if (isGameOver) return null;

    const me = room.players.find(p => p.id === playerId);

    if (room.mode === 'solo') {
        const timeLeft = Math.ceil(room.timeRemaining);
        const isUrgent = timeLeft <= 10;
        const isCritical = timeLeft <= 5;

        const timerClass = `hud-timer ${isCritical ? 'hud-timer--critical' : isUrgent ? 'hud-timer--urgent' : ''}`;
        const timerValueClass = `hud-timer-value ${isCritical ? 'hud-timer-value--critical' : isUrgent ? 'hud-timer-value--urgent' : ''}`;

        return (
            <div className="game-hud">
                <div className="game-hud-top">
                    {/* Score */}
                    <div className="hud-score-card hud-score-card--active">
                        <div className="hud-score-label hud-score-label--gold">Score</div>
                        <div className="hud-score-value">{me?.score || 0}</div>
                    </div>

                    {/* Timer */}
                    <div className="hud-center">
                        <div className={timerClass}>
                            <span className={timerValueClass}>{timeLeft}s</span>
                        </div>
                        <div className="hud-meta">Shot {room.round}</div>
                    </div>

                    {/* Spacer */}
                    <div className="hud-spacer" />
                </div>

            </div>
        );
    }

    // ── Multiplayer UI ──
    const isMyTurn = room.currentTurn === playerId;
    const opponent = room.players.find(p => p.id !== playerId);

    return (
        <div className="game-hud">
            <div className="game-hud-top">
                {/* My Score */}
                <div className={`hud-score-card ${isMyTurn ? 'hud-score-card--active' : ''}`}>
                    <div className={`hud-score-label ${isMyTurn ? 'hud-score-label--gold' : ''}`}>You</div>
                    <div className="hud-score-value">{me?.score || 0}</div>
                </div>

                {/* Center */}
                <div className="hud-center">
                    <div className="hud-round">
                        {room.round === room.maxRounds ? (
                            <span className="hud-round-text hud-round-final">Final Round</span>
                        ) : (
                            <span className="hud-round-text">
                                Round {room.round} / {room.maxRounds}
                            </span>
                        )}
                    </div>

                    {isMyTurn && (
                        <div className="hud-turn-badge hud-turn-badge--mine">Your Turn</div>
                    )}
                    {!isMyTurn && room.players.length > 1 && (
                        <div className="hud-turn-badge hud-turn-badge--opponent">Opponent's Turn</div>
                    )}
                    {!isMyTurn && room.players.length === 1 && (
                        <div className="hud-turn-badge hud-turn-badge--waiting">Waiting for Opponent</div>
                    )}
                </div>

                {/* Opponent Score */}
                <div className={`hud-score-card ${!isMyTurn && room.players.length > 1 ? 'hud-score-card--opponent-active' : ''}`}>
                    <div className="hud-score-label">Opponent</div>
                    <div className="hud-score-value">{opponent?.score || 0}</div>
                </div>
            </div>

        </div>
    );
};

export default GameUI;
