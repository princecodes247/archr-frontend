import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import GamePage from './components/GamePage';
import MainMenu from './components/MainMenu';
import { useSocketStore } from './stores/useSocketStore';
import './App.css';

function App() {
  const { connected, finalScore, setFinalScore, setRoom, connect } = useSocketStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black relative font-sans">
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black text-white">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-sm uppercase tracking-widest text-gray-500">Connecting to Server...</div>
          </div>
        </div>
      )}

      {connected && (
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={
                <MainMenu
                  currentScore={finalScore}
                  onScoreSubmitted={() => setFinalScore(null)}
                />
              }
            />
            <Route
              path="/game/:mode"
              element={
                <GamePage
                  onExit={() => setRoom(null)}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      )}
    </div>
  );
}

export default App;
