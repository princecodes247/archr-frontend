import React from 'react';
import { Link } from 'react-router-dom';
import Leaderboard from './Leaderboard';
import './MainMenu.css';

interface MainMenuProps {
    currentScore?: number | null;
    onScoreSubmitted?: () => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ currentScore, onScoreSubmitted }) => {
    return (
        <div className="menu-page">
            {/* Floating particles */}
            <div className="menu-particles">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="menu-particle" />
                ))}
            </div>

            <div className="menu-layout">
                {/* Left: Hero */}
                <div className="menu-hero">
                    <div className="menu-logo">
                        <h1 className="menu-logo-title">ARCHR</h1>
                        <div className="menu-logo-subtitle">Precision Archery</div>
                        <div className="menu-logo-divider" />
                    </div>

                    <div className="menu-buttons">
                        <Link to="/game/solo" className="menu-btn menu-btn-primary">
                            <span>Play Solo</span>
                            <svg className="menu-btn-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </Link>

                        <Link to="/game/multiplayer" className="menu-btn menu-btn-secondary">
                            <span>Multiplayer</span>
                            <span className="menu-btn-badge">Online</span>
                        </Link>
                    </div>

                    <div className="menu-footer">
                        v1.0 · ARCHR
                    </div>
                </div>

                {/* Right: Leaderboard */}
                <div className="lb-container">
                    <Leaderboard
                        variant="embedded"
                        currentScore={currentScore}
                        onScoreSubmitted={onScoreSubmitted}
                    />
                </div>
            </div>
        </div>
    );
};

export default MainMenu;
