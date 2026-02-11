import React from 'react';

interface Player {
    id: string;
    score: number;
}

interface Room {
    id: string;
    players: Player[];
    currentTurn: string;
    round: number;
    maxRounds: number;
}

interface GameUIProps {
    room: Room | null;
    playerId: string | undefined;
}

const GameUI: React.FC<GameUIProps> = ({ room, playerId }) => {
    if (!room) return <div className="absolute top-4 left-4 text-white">Waiting for players...</div>;

    const isMyTurn = room.currentTurn === playerId;
    const opponent = room.players.find(p => p.id !== playerId);
    const me = room.players.find(p => p.id === playerId);

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
            {/* Top Bar: Scores & Round */}
            <div className="flex justify-between items-start">
                {/* My Score */}
                <div className={`p-4 rounded-xl backdrop-blur-md ${isMyTurn ? 'bg-white/20 border-2 border-yellow-400' : 'bg-black/20'}`}>
                    <div className="text-sm text-gray-200 uppercase tracking-wider">YOU</div>
                    <div className="text-4xl font-bold text-white">{me?.score || 0}</div>
                </div>

                {/* Round Info */}
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

                {/* Opponent Score */}
                <div className={`p-4 rounded-xl backdrop-blur-md ${!isMyTurn && room.players.length > 1 ? 'bg-white/20 border-2 border-red-400' : 'bg-black/20'}`}>
                    <div className="text-sm text-gray-200 uppercase tracking-wider">OPPONENT</div>
                    <div className="text-4xl font-bold text-white">{opponent?.score || 0}</div>
                </div>
            </div>

            {/* Bottom Controls (Optional) */}
            <div className="text-center pb-4 text-white/50 text-sm">
                Drag to Aim & Shoot
            </div>
        </div>
    );
};

export default GameUI;
