import React, { useState, useEffect } from 'react';
import { useSocketStore } from '../stores/useSocketStore';
import './MainMenu.css';

interface LeaderboardEntry {
    userId: string;
    name: string;
    score: number;
    date: number;
}

interface LeaderboardProps {
    onBack?: () => void;
    currentScore?: number | null;
    onScoreSubmitted?: () => void;
    variant?: 'fullscreen' | 'embedded';
    className?: string;
}


const Leaderboard: React.FC<LeaderboardProps> = ({
    onBack,
    currentScore,
    onScoreSubmitted: _onScoreSubmitted,
    variant = 'fullscreen',
}) => {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const { socket, playerId } = useSocketStore();

    useEffect(() => {
        if (!socket) return;

        socket.emit('getLeaderboard');

        const handleUpdate = (data: LeaderboardEntry[]) => {
            setEntries(data);
        };

        socket.on('leaderboardUpdate', handleUpdate);

        return () => {
            socket.off('leaderboardUpdate', handleUpdate);
        };
    }, [socket]);

    const getMedalEmoji = (rank: number) => {
        if (rank === 0) return '🥇';
        if (rank === 1) return '🥈';
        if (rank === 2) return '🥉';
        return null;
    };

    const getRankClass = (index: number) => {
        if (index === 0) return 'lb-rank lb-rank-1';
        if (index === 1) return 'lb-rank lb-rank-2';
        if (index === 2) return 'lb-rank lb-rank-3';
        return 'lb-rank lb-rank-default';
    };

    const getEntryClass = (index: number) => {
        if (index === 0) return 'lb-entry lb-entry-1';
        if (index === 1) return 'lb-entry lb-entry-2';
        if (index === 2) return 'lb-entry lb-entry-3';
        return 'lb-entry';
    };

    const content = (
        <div className="lb-card">
            {/* Gold accent line at top */}
            <div className="lb-header">
                <svg className="lb-trophy-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L9 7H3l5 4-2 7 6-4 6 4-2-7 5-4h-6L12 2z" opacity="0.9" />
                </svg>
                <h2 className="lb-title">Leaderboard</h2>
                <svg className="lb-trophy-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L9 7H3l5 4-2 7 6-4 6 4-2-7 5-4h-6L12 2z" opacity="0.9" />
                </svg>
            </div>

            {/* Current score display (no form needed — auto-submitted) */}
            {currentScore !== null && currentScore !== undefined && (
                <div className="lb-submit-card">
                    <div className="lb-submit-label">Your Score</div>
                    <div className="lb-submit-score">{currentScore}</div>
                </div>
            )}

            {/* Entries */}
            <div className="lb-list">
                {entries.map((entry, index) => (
                    <div
                        key={index}
                        className={getEntryClass(index)}
                        style={{
                            animationDelay: `${index * 60}ms`,
                        }}
                    >
                        <div className="lb-entry-left">
                            <div className={getRankClass(index)}>
                                {getMedalEmoji(index) || (index + 1)}
                            </div>
                            <span className="lb-name">
                                {entry.name}
                                {entry.userId === playerId && (
                                    <span style={{ color: '#c9a84c', fontSize: '10px', marginLeft: '6px' }}>YOU</span>
                                )}
                            </span>
                        </div>
                        <span className={`lb-score ${index > 2 ? 'lb-score-default' : ''}`}>
                            {entry.score}
                        </span>
                    </div>
                ))}
                {entries.length === 0 && (
                    <div className="lb-empty">
                        <svg className="lb-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                            <line x1="12" y1="2" x2="12" y2="4" />
                            <line x1="12" y1="20" x2="12" y2="22" />
                            <line x1="2" y1="12" x2="4" y2="12" />
                            <line x1="20" y1="12" x2="22" y2="12" />
                        </svg>
                        <span className="lb-empty-text">No high scores yet</span>
                    </div>
                )}
            </div>

            {onBack && (
                <button onClick={onBack} className="lb-back-btn">
                    Back to Menu
                </button>
            )}
        </div>
    );

    if (variant === 'fullscreen') {
        return (
            <div className="lb-fullscreen">
                {content}
            </div>
        );
    }

    return content;
};

export default Leaderboard;
