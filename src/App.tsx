import { useEffect, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import GameUI from './components/GameUI';
import { initiateSocket, getSocket } from './services/socket';
import './App.css';

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


function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState<string>();

  useEffect(() => {
    initiateSocket('http://localhost:3000');
    const socket = getSocket();

    socket.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
      setPlayerId(socket.id);
    });

    socket.on('gameState', (data: Room) => {
      console.log('Game State Update:', data);
      setRoom(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="w-full h-screen overflow-hidden bg-black relative">
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50 text-white">
          Connecting to server...
        </div>
      )}
      <GameCanvas
        socket={connected ? getSocket() : null}
        isMyTurn={room?.currentTurn === playerId}
      />
      <GameUI room={room} playerId={playerId} />
    </div>
  );
}

export default App;
