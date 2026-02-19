import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GameCanvas from './GameCanvas';
import GameUI from './GameUI';
import { useSocketStore } from '../stores/useSocketStore';
import type { Room } from '../types';


interface GamePageProps {
    onExit: () => void;
}

const GamePage: React.FC<GamePageProps> = ({ onExit }) => {
    const { mode } = useParams<{ mode: 'solo' | 'multiplayer' }>();
    const navigate = useNavigate();
    const { socket, room, setRoom, playerId, setFinalScore } = useSocketStore();

    useEffect(() => {
        if (mode !== 'solo' && mode !== 'multiplayer') {
            navigate('/');
            return;
        }

        if (!socket) return;

        console.log('Joining game mode:', mode);
        socket.emit('joinGame', mode);

        socket.on('gameState', (data: Room) => {
            console.log('Game State Update:', data);
            setRoom(data);

            // If new game started, clear final score
            if (data.round === 1 && data.players.find(p => p.id === socket.id)?.score === 0) {
                setFinalScore(null);
            }

            // Check for Game Over to trigger leaderboard submission flow
            if (data.round > data.maxRounds) {
                const me = data.players.find(p => p.id === socket.id);
                if (me) {
                    setFinalScore(me.score);
                }
            }
        });

        return () => {
            // Cleanup on unmount if needed
        };
    }, [mode, navigate, socket]);

    const handleGameExit = () => {
        onExit();
        navigate('/');
    };

    return (
        <>
            <GameCanvas onExit={handleGameExit} />
            <GameUI room={room} playerId={playerId} />
        </>
    );
};

export default GamePage;
