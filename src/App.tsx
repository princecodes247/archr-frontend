import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import GamePage from './components/GamePage';
import MainMenu from './components/MainMenu';
import Connecting from './components/Connecting';
import { useSocketStore } from './stores/useSocketStore';
import './App.css';

function App() {
  const { connected, finalScore, setFinalScore, setRoom, connect } = useSocketStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black relative font-sans">
      {!connected && <Connecting />}

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
