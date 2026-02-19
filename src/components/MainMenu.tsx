import React from 'react';
import { Link } from 'react-router-dom';
import Leaderboard from './Leaderboard';

interface MainMenuProps {
    currentScore?: number | null;
    onScoreSubmitted?: () => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ currentScore, onScoreSubmitted }) => {
    return (
        <div className="absolute inset-0 bg-black flex flex-col md:flex-row items-center justify-center p-6 select-none gap-12">

            {/* Left Column: Title & Menu */}
            <div className="flex flex-col items-center justify-center">
                {/* Logo / Title */}
                <div className="mb-12 text-center">
                    <h1 className="text-6xl font-black text-white tracking-tighter mb-2">
                        ARCHR
                    </h1>
                    <div className="text-yellow-500 font-bold tracking-[0.5em] text-sm opacity-80">
                        PRECISION ARCHERY
                    </div>
                </div>

                {/* Menu Options */}
                <div className="flex flex-col gap-4 w-full max-w-xs">

                    {/* Solo Play (Primary) */}
                    <Link
                        to="/game/solo"
                        className="group relative bg-white text-black font-black text-xl py-4 px-8 rounded-xl overflow-hidden transform transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] text-center no-underline block"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-yellow-300 via-white to-yellow-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <span className="relative z-10 flex items-center justify-center gap-2">
                            PLAY SOLO
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </span>
                    </Link>

                    {/* Multiplayer (Secondary) */}
                    <Link
                        to="/game/multiplayer"
                        className="group relative bg-gray-900 border border-white/20 text-white font-bold text-lg py-4 px-8 rounded-xl transform transition-all hover:bg-gray-800 active:scale-95 hover:border-white/40 text-center no-underline block"
                    >
                        <span className="flex items-center justify-center gap-2">
                            MULTIPLAYER
                            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded ml-2 border border-green-500/30">ONLINE</span>
                        </span>
                    </Link>
                </div>

                {/* Footer */}
                <div className="text-gray-700 text-xs font-mono mt-12">
                    v1.0.0 · ARCHR
                </div>
            </div>

            {/* Right Column: Leaderboard */}
            <div className="w-full max-w-md h-[500px] flex items-center">
                <Leaderboard
                    variant="embedded"
                    className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 h-full shadow-2xl"
                    currentScore={currentScore}
                    onScoreSubmitted={onScoreSubmitted}
                />
            </div>

        </div>
    );
};

export default MainMenu;
