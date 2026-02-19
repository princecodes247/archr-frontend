import React from 'react';
import type { Room } from '../types';

interface GameUIProps {
    room: Room | null;
    playerId: string | undefined;
}

const GameUI: React.FC<GameUIProps> = ({ room, playerId }) => {
    if (!room) return <div className="absolute top-4 left-4 text-white">Waiting for players...</div>;

    // Solo: game over when time runs out; Multiplayer: game over when round > maxRounds
    const isGameOver = room.mode === 'solo'
        ? room.timeRemaining <= 0
        : room.round > room.maxRounds;
    if (isGameOver) return null;

    const me = room.players.find(p => p.id === playerId);

    if (room.mode === 'solo') {
        // ── Solo UI ──
        const timeLeft = Math.ceil(room.timeRemaining);
        const isUrgent = timeLeft <= 10;
        const isCritical = timeLeft <= 5;

        return (
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
                {/* Top Bar */}
                <div className="flex justify-between items-start">
                    {/* Score */}
                    <div className="p-4 rounded-xl backdrop-blur-md bg-white/20 border-2 border-yellow-400">
                        <div className="text-sm text-gray-200 uppercase tracking-wider">SCORE</div>
                        <div className="text-4xl font-bold text-white">{me?.score || 0}</div>
                    </div>

                    {/* Timer */}
                    <div className="flex flex-col items-center">
                        <div className={`px-6 py-3 rounded-full backdrop-blur-sm transition-colors ${isCritical ? 'bg-red-500/60 animate-pulse' :
                            isUrgent ? 'bg-red-500/30' :
                                'bg-black/40'
                            }`}>
                            <span className={`font-bold text-3xl font-mono ${isCritical ? 'text-red-300' :
                                isUrgent ? 'text-yellow-400' :
                                    'text-white'
                                }`}>
                                {timeLeft}s
                            </span>
                        </div>
                        <div className="mt-2 text-white/50 text-xs uppercase tracking-widest">
                            Shot {room.round}
                        </div>
                    </div>

                    {/* Spacer to balance layout */}
                    <div className="w-[100px]" />
                </div>

                {/* Bottom */}
                <div className="text-center pb-4 text-white/50 text-sm">
                    Tap &amp; Drag to Aim · Release to Shoot
                </div>
            </div>
        );
    }

    // ── Multiplayer UI ──
    const isMyTurn = room.currentTurn === playerId;
    const opponent = room.players.find(p => p.id !== playerId);

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
            <div className="flex justify-between items-start">
                <div className={`p-4 rounded-xl backdrop-blur-md ${isMyTurn ? 'bg-white/20 border-2 border-yellow-400' : 'bg-black/20'}`}>
                    <div className="text-sm text-gray-200 uppercase tracking-wider">YOU</div>
                    <div className="text-4xl font-bold text-white">{me?.score || 0}</div>
                </div>

                <div className="flex flex-col items-center">
                    <div className="bg-black/40 px-6 py-2 rounded-full backdrop-blur-sm">
                        <span className="text-white font-bold text-xl">ROUND {room.round} / {room.maxRounds}</span>
                    </div>
                    {isMyTurn && (
                        <div className="mt-4 bg-yellow-500 text-black px-4 py-1 rounded font-bold animate-pulse">
                            YOUR TURN
                        </div>
                    )}
                    {!isMyTurn && room.players.length > 1 && (
                        <div className="mt-4 bg-gray-600 text-white px-4 py-1 rounded">
                            OPPONENT'S TURN
                        </div>
                    )}
                    {!isMyTurn && room.players.length === 1 && (
                        <div className="mt-4 bg-blue-600 text-white px-4 py-1 rounded animate-bounce">
                            WAITING FOR OPPONENT
                        </div>
                    )}
                </div>

                <div className={`p-4 rounded-xl backdrop-blur-md ${!isMyTurn && room.players.length > 1 ? 'bg-white/20 border-2 border-red-400' : 'bg-black/20'}`}>
                    <div className="text-sm text-gray-200 uppercase tracking-wider">OPPONENT</div>
                    <div className="text-4xl font-bold text-white">{opponent?.score || 0}</div>
                </div>
            </div>

            <div className="text-center pb-4 text-white/50 text-sm">
                Drag to Aim &amp; Shoot
            </div>
        </div>
    );
};

export default GameUI;
