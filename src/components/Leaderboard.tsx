import React, { useState, useEffect } from 'react';
import { useSocketStore } from '../stores/useSocketStore';

interface LeaderboardEntry {
    name: string;
    score: number;
    date: number;
}

interface LeaderboardProps {
    onBack?: () => void;
    currentScore?: number | null; // If provided, shows submission form
    onScoreSubmitted?: () => void;
    variant?: 'fullscreen' | 'embedded';
    className?: string;
}

const Leaderboard: React.FC<LeaderboardProps> = ({
    onBack,
    currentScore,
    onScoreSubmitted,
    variant = 'fullscreen',
    className = ''
}) => {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const { socket } = useSocketStore();

    useEffect(() => {
        if (!socket) return;

        // Request initial data
        socket.emit('getLeaderboard');

        const handleUpdate = (data: LeaderboardEntry[]) => {
            setEntries(data);
        };

        socket.on('leaderboardUpdate', handleUpdate);

        return () => {
            socket.off('leaderboardUpdate', handleUpdate);
        };
    }, [socket]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !currentScore || !socket) return;

        setSubmitting(true);
        socket.emit('submitScore', { name: name.trim(), score: currentScore });

        setTimeout(() => {
            setSubmitting(false);
            setSubmitted(true);
            if (onScoreSubmitted) onScoreSubmitted();
        }, 500);
    };

    const containerClasses = variant === 'fullscreen'
        ? "absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 text-white z-50"
        : `w-full ${className}`;

    const contentClasses = variant === 'fullscreen'
        ? "max-w-md w-full bg-gray-900 rounded-2xl border border-white/10 p-8 shadow-2xl"
        : "w-full bg-gray-900/50 rounded-2xl border border-white/5 p-6";

    return (
        <div className={containerClasses}>
            <div className={contentClasses}>
                <h2 className="text-2xl font-bold text-center mb-6 text-yellow-400 tracking-wider">LEADERBOARD</h2>

                {/* Submission Form */}
                {currentScore !== null && currentScore !== undefined && !submitted && (
                    <div className="mb-8 bg-white/5 p-6 rounded-xl border border-white/10">
                        <div className="text-center mb-4">
                            <div className="text-sm text-gray-400 uppercase tracking-widest">Your Score</div>
                            <div className="text-5xl font-bold text-white">{currentScore}</div>
                        </div>
                        <form onSubmit={handleSubmit} className="flex gap-2">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Enter Name"
                                maxLength={12}
                                className="flex-1 bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-400"
                                autoFocus
                            />
                            <button
                                type="submit"
                                disabled={submitting || !name.trim()}
                                className="bg-yellow-500 text-black font-bold px-6 py-2 rounded-lg hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? '...' : 'SUBMIT'}
                            </button>
                        </form>
                    </div>
                )}

                {/* List */}
                <div className="space-y-2 mb-8 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {entries.map((entry, index) => (
                        <div
                            key={index}
                            className={`flex items-center justify-between p-3 rounded-lg ${index === 0 ? 'bg-yellow-500/20 border border-yellow-500/50' :
                                index === 1 ? 'bg-gray-400/20' :
                                    index === 2 ? 'bg-orange-700/20' : 'bg-white/5'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`font-mono font-bold w-6 text-center ${index === 0 ? 'text-yellow-400' :
                                    index === 1 ? 'text-gray-300' :
                                        index === 2 ? 'text-orange-400' : 'text-gray-500'
                                    }`}>
                                    #{index + 1}
                                </div>
                                <div className="font-bold text-gray-200">{entry.name}</div>
                            </div>
                            <div className="font-mono font-bold text-yellow-500">{entry.score}</div>
                        </div>
                    ))}
                    {entries.length === 0 && (
                        <div className="text-center text-gray-500 py-8">No high scores yet</div>
                    )}
                </div>

                {onBack && (
                    <button
                        onClick={onBack}
                        className="w-full text-center text-gray-400 hover:text-white py-2 uppercase tracking-widest text-sm font-bold transition-colors mt-4"
                    >
                        {currentScore ? 'Skip / Close' : 'Back to Menu'}
                    </button>
                )}
            </div>
        </div>
    );
};

export default Leaderboard;
