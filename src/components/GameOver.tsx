import React, { useMemo, useCallback, useState } from 'react';
import type { Room } from '../types';
import { shareScoreCard } from './ShareCard';
import './GameOver.css';

interface GameOverProps {
    room: Room;
    playerId: string | undefined;
    onPlayAgain: () => void;
}

type RatingTier = {
    text: string;
    colorClass: string;
    subtitle: string;
    glow: string;
    showBeams: boolean;
};

function getRating(avg: number): RatingTier {
    if (avg >= 9.5) return { text: 'PERFECT', colorClass: 'gameover-title--gold', subtitle: 'Legendary accuracy', glow: 'rgba(201, 168, 76, 0.35)', showBeams: true };
    if (avg >= 8) return { text: 'EXCELLENT', colorClass: 'gameover-title--green', subtitle: 'Sharp shooting', glow: 'rgba(110, 231, 183, 0.3)', showBeams: true };
    if (avg >= 6) return { text: 'GREAT', colorClass: 'gameover-title--blue', subtitle: 'Well done', glow: 'rgba(125, 211, 252, 0.2)', showBeams: false };
    if (avg >= 4) return { text: 'GOOD', colorClass: 'gameover-title--purple', subtitle: 'Solid effort', glow: 'rgba(167, 139, 250, 0.2)', showBeams: false };
    if (avg >= 2) return { text: 'OK', colorClass: 'gameover-title--muted', subtitle: 'Keep practicing', glow: 'rgba(148, 163, 184, 0.15)', showBeams: false };
    return { text: 'ROUGH', colorClass: 'gameover-title--red', subtitle: 'Try again', glow: 'rgba(248, 113, 113, 0.15)', showBeams: false };
}

const SVGTargetRings: React.FC = () => (
    <div className="gameover-rings">
        <svg viewBox="0 0 400 400" fill="none">
            {[180, 150, 120, 90, 60, 30].map((r, i) => (
                <circle
                    key={r}
                    cx="200" cy="200" r={r}
                    stroke={i < 2 ? 'rgba(240, 236, 228, 0.5)' : 'rgba(201, 168, 76, 0.6)'}
                    strokeWidth={i === 0 ? '1.2' : '0.6'}
                />
            ))}
            <line x1="10" y1="200" x2="390" y2="200" stroke="rgba(201, 168, 76, 0.3)" strokeWidth="0.4" />
            <line x1="200" y1="10" x2="200" y2="390" stroke="rgba(201, 168, 76, 0.3)" strokeWidth="0.4" />
        </svg>
    </div>
);

const RadialBeams: React.FC<{ color: string }> = ({ color }) => (
    <div className="gameover-beams">
        <svg viewBox="0 0 500 500" fill="none">
            {Array.from({ length: 16 }).map((_, i) => {
                const angle = (i / 16) * 360;
                return (
                    <line
                        key={i}
                        x1="250" y1="250"
                        x2={250 + Math.cos((angle * Math.PI) / 180) * 240}
                        y2={250 + Math.sin((angle * Math.PI) / 180) * 240}
                        stroke={color}
                        strokeWidth="3"
                        opacity="0.6"
                    />
                );
            })}
        </svg>
    </div>
);

const Sparkles: React.FC<{ color: string; count?: number }> = ({ color, count = 10 }) => {
    const sparkles = useMemo(() =>
        Array.from({ length: count }).map((_, i) => ({
            left: `${15 + Math.random() * 70}%`,
            top: `${20 + Math.random() * 50}%`,
            delay: `${i * 0.3 + Math.random() * 0.5}s`,
            duration: `${2.5 + Math.random() * 1.5}s`,
        })),
        [count]
    );

    return (
        <div className="gameover-sparkles">
            {sparkles.map((s, i) => (
                <div
                    key={i}
                    className="gameover-sparkle"
                    style={{
                        left: s.left,
                        top: s.top,
                        '--sparkle-color': color,
                        '--sparkle-delay': s.delay,
                        '--sparkle-duration': s.duration,
                    } as React.CSSProperties}
                />
            ))}
        </div>
    );
};

const AccuracyRing: React.FC<{ score: number; color: string; glow: string; accuracy: number }> = ({ score, color, glow, accuracy }) => {
    const circumference = 2 * Math.PI * 68;
    const offset = circumference * (1 - accuracy);

    return (
        <div className="gameover-ring-container">
            <svg className="gameover-ring-svg" viewBox="0 0 160 160">
                {/* Outer decorative ring */}
                <circle className="gameover-ring-outer" cx="80" cy="80" r="78" stroke={color} />
                {/* Track */}
                <circle className="gameover-ring-track" cx="80" cy="80" r="68" />
                {/* Progress */}
                <circle
                    className="gameover-ring-progress"
                    cx="80" cy="80" r="68"
                    stroke={color}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    style={{ '--ring-glow': glow } as React.CSSProperties}
                />
            </svg>
            <div className="gameover-ring-score">
                <div className="gameover-ring-value">{score}</div>
                <div className="gameover-ring-label">Points</div>
            </div>
        </div>
    );
};

const GameOver: React.FC<GameOverProps> = ({ room, playerId, onPlayAgain }) => {
    const me = room.players.find(p => p.userId === playerId);
    const myScore = me?.score || 0;
    const [sharing, setSharing] = useState(false);

    const handleShare = useCallback(async () => {
        setSharing(true);
        try {
            await shareScoreCard(room, playerId);
        } catch (e) {
            console.error('Share failed:', e);
        } finally {
            setSharing(false);
        }
    }, [room, playerId]);

    if (room.mode === 'solo') {
        const shotsCount = Math.max(1, room.round - 1);
        const avgPerShot = myScore / shotsCount;
        const accuracyPct = Math.min(1, avgPerShot / 10);
        const rating = getRating(avgPerShot);

        return (
            <div className="gameover">
                <SVGTargetRings />
                {rating.showBeams && <RadialBeams color={rating.glow} />}
                {avgPerShot >= 6 && <Sparkles color={rating.glow} count={12} />}

                <div className="gameover-card">
                    <div className="gameover-label">Time's Up</div>
                    <div className={`gameover-title ${rating.colorClass}`}>{rating.text}</div>
                    <div className="gameover-subtitle">{rating.subtitle}</div>

                    <AccuracyRing
                        score={myScore}
                        color={rating.glow.replace(/[\d.]+\)$/, '1)')}
                        glow={rating.glow}
                        accuracy={accuracyPct}
                    />

                    <div className="gameover-stats" style={{ '--rating-color': rating.glow.replace(/[\d.]+\)$/, '1)') } as React.CSSProperties}>
                        <div className="gameover-stat">
                            <div className="gameover-stat-label">Shots</div>
                            <div className="gameover-stat-value">{shotsCount}</div>
                        </div>
                        <div className="gameover-stat">
                            <div className="gameover-stat-label">Avg</div>
                            <div className="gameover-stat-value gameover-stat-value--accent">{avgPerShot.toFixed(1)}</div>
                        </div>
                        <div className="gameover-stat">
                            <div className="gameover-stat-label">Accuracy</div>
                            <div className="gameover-stat-value">{Math.round(accuracyPct * 100)}%</div>
                        </div>
                    </div>

                    <div className="gameover-btn-row">
                        <button className="gameover-btn gameover-btn--share" onClick={handleShare} disabled={sharing}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                <polyline points="16 6 12 2 8 6" />
                                <line x1="12" y1="2" x2="12" y2="15" />
                            </svg>
                            {sharing ? 'SHARING…' : 'SHARE'}
                        </button>
                        <button className="gameover-btn" onClick={onPlayAgain}>
                            PLAY AGAIN
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Multiplayer ──
    const opponent = room.players.find(p => p.userId !== playerId);
    const oppScore = opponent?.score || 0;

    let resultText: string;
    let resultClass: string;
    let subtitle: string;
    let showBeams = false;
    let beamColor = '#c9a84c';

    if (myScore > oppScore) {
        resultText = 'VICTORY';
        resultClass = 'gameover-title--gold';
        subtitle = 'Champion archer';
        showBeams = true;
    } else if (myScore < oppScore) {
        resultText = 'DEFEAT';
        resultClass = 'gameover-title--muted';
        subtitle = 'Better luck next round';
    } else {
        resultText = 'DRAW';
        resultClass = 'gameover-title--cream';
        subtitle = 'Evenly matched';
        beamColor = 'rgba(240, 236, 228, 0.3)';
    }

    return (
        <div className="gameover">
            <SVGTargetRings />
            {showBeams && <RadialBeams color={beamColor} />}
            {myScore > oppScore && <Sparkles color="#c9a84c" count={8} />}

            <div className="gameover-card">
                <div className="gameover-label">Game Over</div>
                <div className={`gameover-title ${resultClass}`}>{resultText}</div>
                <div className="gameover-subtitle">{subtitle}</div>

                <div className="gameover-scores">
                    <div className="gameover-score-side">
                        <div className={`gameover-score-number ${myScore >= oppScore ? 'gameover-score-number--winner' : 'gameover-score-number--loser'}`}>
                            {myScore}
                        </div>
                        <div className="gameover-score-player">You</div>
                    </div>
                    <div className="gameover-score-divider" />
                    <div className="gameover-score-side">
                        <div className={`gameover-score-number ${oppScore > myScore ? 'gameover-score-number--defeat' : 'gameover-score-number--loser'}`}>
                            {oppScore}
                        </div>
                        <div className="gameover-score-player">Opponent</div>
                    </div>
                </div>

                <div className="gameover-btn-row">
                    <button className="gameover-btn gameover-btn--share" onClick={handleShare} disabled={sharing}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                            <polyline points="16 6 12 2 8 6" />
                            <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        {sharing ? 'SHARING…' : 'SHARE'}
                    </button>
                    <button className="gameover-btn" onClick={onPlayAgain}>
                        PLAY AGAIN
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GameOver;
