import React, { useRef, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';

interface GameCanvasProps {
    socket: Socket | null;
    isMyTurn: boolean;
}

interface Point {
    x: number;
    y: number;
}

interface Player {
    id: string;
    score: number;
}

interface RoomState {
    players: Player[];
    currentTurn: string;
    round: number;
    maxRounds: number;
    wind: Point;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ socket, isMyTurn }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Game State Refs (mutable, used in animation loop)
    const reticlePos = useRef<Point>({ x: 0, y: 0 });
    const controlPos = useRef<Point>({ x: 0, y: 0 });
    const wind = useRef<Point>({ x: 0, y: 0 });
    const isAiming = useRef(false);
    const zoomLevel = useRef(1); // Smooth zoom interpolation
    const swayPhase = useRef({ px1: Math.random() * 100, px2: Math.random() * 100, py1: Math.random() * 100, py2: Math.random() * 100 });

    // React State for rendered overlays
    const [lastShotPath, setLastShotPath] = useState<Point[] | null>(null);
    const [roomState, setRoomState] = useState<RoomState | null>(null);
    const [lastScore, setLastScore] = useState<number | null>(null);
    const [scoreFlash, setScoreFlash] = useState(0);

    useEffect(() => {
        if (!socket) return;

        socket.on('gameState', (room: RoomState) => {
            if (room.wind) {
                wind.current = room.wind;
            }
            setRoomState(room);
            // Randomize sway phases each turn
            swayPhase.current = {
                px1: Math.random() * 100,
                px2: Math.random() * 100,
                py1: Math.random() * 100,
                py2: Math.random() * 100,
            };
        });

        socket.on('shotResult', (data: { path: Point[], score: number }) => {
            console.log('Shot Result:', data);
            setLastShotPath(data.path);
            setLastScore(data.score);
            setScoreFlash(1);
        });

        return () => {
            socket.off('gameState');
            socket.off('shotResult');
        };
    }, [socket]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            // Resize
            if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }

            const w = canvas.width;
            const h = canvas.height;
            const centerX = w / 2;
            const horizonY = h * 0.55;
            const targetCenterX = centerX;
            const targetCenterY = horizonY + 80;

            // ── Physics Update ──
            // Four layers: Wind Drift → Hand Sway → Player Input → Input Offset Sway
            if (isMyTurn && isAiming.current) {
                const time = Date.now() / 1000;
                const sp = swayPhase.current;

                // Layer 1: Player Input — reticle follows finger with inertia
                const stiffness = 0.12;
                reticlePos.current.x += (controlPos.current.x - reticlePos.current.x) * stiffness;
                reticlePos.current.y += (controlPos.current.y - reticlePos.current.y) * stiffness;

                // Layer 2: Wind Drift — gentle, constant push (predictable → learnable)
                const windForce = 0.3;
                reticlePos.current.x += wind.current.x * windForce;
                reticlePos.current.y += wind.current.y * windForce;

                // Layer 3: Hand Sway — breathing + micro tremor (creates tension)
                // Slow breathing cycle (~1 Hz, low amplitude)
                const breathX = Math.sin(time * 0.9 + sp.px1) * 0.6;
                const breathY = Math.cos(time * 0.7 + sp.py1) * 0.8;
                // Faster hand tremor (~3-5 Hz, very small)
                const tremorX = Math.sin(time * 3.2 + sp.px2) * 0.25 + Math.cos(time * 5.7 + sp.px1) * 0.1;
                const tremorY = Math.cos(time * 3.8 + sp.py2) * 0.2 + Math.sin(time * 5.1 + sp.py1) * 0.1;

                reticlePos.current.x += breathX + tremorX;
                reticlePos.current.y += breathY + tremorY;

                // Layer 4: Input Offset Sway — the further from center, the more unstable
                // This rewards patience: staying near center is easier to hold.
                const offsetDist = Math.sqrt(
                    reticlePos.current.x * reticlePos.current.x +
                    reticlePos.current.y * reticlePos.current.y
                );
                const instability = Math.min(offsetDist / 80, 1.0); // 0 at center, 1 at 80px+
                const offsetSwayX = Math.sin(time * 2.1 + sp.py2) * instability * 0.8;
                const offsetSwayY = Math.cos(time * 1.7 + sp.px2) * instability * 0.6;

                reticlePos.current.x += offsetSwayX;
                reticlePos.current.y += offsetSwayY;

            } else if (!isMyTurn) {
                reticlePos.current = { x: 0, y: 0 };
                controlPos.current = { x: 0, y: 0 };
            }

            // ── Zoom Interpolation ──
            const targetZoom = (isMyTurn && isAiming.current) ? 2.0 : 1.0;
            zoomLevel.current += (targetZoom - zoomLevel.current) * 0.04;

            // ── Drawing ──
            ctx.save();

            // Apply zoom centered on target
            const zoom = zoomLevel.current;
            ctx.translate(targetCenterX, targetCenterY);
            ctx.scale(zoom, zoom);
            ctx.translate(-targetCenterX, -targetCenterY);

            // 1. Sky
            const skyGradient = ctx.createLinearGradient(0, 0, 0, h * 0.6);
            skyGradient.addColorStop(0, '#58a7e8');
            skyGradient.addColorStop(1, '#a3d8f7');
            ctx.fillStyle = skyGradient;
            ctx.fillRect(-w, -h, w * 3, h * 3); // Over-draw for zoom

            // 2. Ground
            const groundGradient = ctx.createLinearGradient(0, horizonY, 0, h);
            groundGradient.addColorStop(0, '#598c3e');
            groundGradient.addColorStop(1, '#2f5a18');
            ctx.fillStyle = groundGradient;
            ctx.fillRect(-w, horizonY, w * 3, h * 2);

            // Mowing lines
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = -20; i <= 20; i++) {
                ctx.moveTo(centerX + i * 80, h);
                ctx.lineTo(centerX + i * 2, horizonY);
            }
            ctx.stroke();

            // Trees
            drawTrees(ctx, w, horizonY);

            // 3. Target
            drawTarget(ctx, targetCenterX, targetCenterY, 0.6);

            // 4. Hit marker
            if (lastShotPath && lastShotPath.length > 0) {
                const hit = lastShotPath[0];
                ctx.save();
                ctx.translate(targetCenterX + hit.x, targetCenterY + hit.y);
                // Arrow stuck in target
                ctx.fillStyle = '#5c4033';
                ctx.fillRect(-2, -18, 4, 36); // shaft
                // Fletching
                ctx.fillStyle = '#c0392b';
                ctx.beginPath();
                ctx.moveTo(-2, 18); ctx.lineTo(2, 18); ctx.lineTo(6, 24); ctx.lineTo(-6, 24);
                ctx.fill();
                // Impact point
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }

            // 5. Reticle
            if (isMyTurn && isAiming.current) {
                const rx = targetCenterX + reticlePos.current.x;
                const ry = targetCenterY + reticlePos.current.y;
                drawReticle(ctx, rx, ry);
            }

            ctx.restore(); // Undo zoom

            // ── HUD (drawn OUTSIDE zoom, always screen-space) ──
            drawHUD(ctx, w, h, wind.current, roomState, socket?.id, lastScore, scoreFlash);

            // Fade score flash
            if (scoreFlash > 0) {
                setScoreFlash(prev => Math.max(0, prev - 0.015));
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationFrameId);
    }, [isMyTurn, lastShotPath, roomState, lastScore, scoreFlash]);

    // ── Input Handlers ──
    const handleStart = () => {
        if (!isMyTurn) return;
        isAiming.current = true;
        setLastShotPath(null);
        setLastScore(null);
    };

    const handleMove = (x: number, y: number) => {
        if (!isMyTurn || !isAiming.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const cx = canvas.width / 2;
        const cy = canvas.height * 0.55 + 80;

        // Scale the control by inverse zoom so finger maps correctly
        const zoom = zoomLevel.current;
        controlPos.current = { x: (x - cx) / zoom, y: (y - cy) / zoom };
    };

    const handleEnd = () => {
        if (!isMyTurn || !isAiming.current) return;
        isAiming.current = false;

        socket?.emit('shoot', { aimPosition: reticlePos.current });
    };

    return (
        <canvas
            ref={canvasRef}
            className={`block w-full h-full touch-none ${isMyTurn ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
            onMouseDown={handleStart}
            onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
            onMouseUp={handleEnd}
            onMouseLeave={() => { if (isAiming.current) handleEnd(); }}
            onTouchStart={(e) => {
                handleStart();
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }}
            onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={handleEnd}
        />
    );
};

// ═══════════════════════════════════════════
// Drawing Helpers
// ═══════════════════════════════════════════

const drawTrees = (ctx: CanvasRenderingContext2D, w: number, horizonY: number) => {
    // Background tree line
    ctx.fillStyle = '#1e3f1b';
    for (let i = -100; i < w + 100; i += 45) {
        const treeH = 60 + Math.sin(i * 0.1) * 15;
        ctx.beginPath();
        ctx.moveTo(i, horizonY);
        ctx.lineTo(i + 22, horizonY - treeH);
        ctx.lineTo(i + 45, horizonY);
        ctx.fill();
    }
    // Foreground rounded trees
    ctx.fillStyle = '#2d5a27';
    for (let i = -50; i < w + 100; i += 90) {
        const treeH = 80 + Math.cos(i) * 20;
        ctx.beginPath();
        ctx.arc(i, horizonY - treeH, 30, 0, Math.PI * 2);
        ctx.arc(i - 20, horizonY - treeH + 20, 25, 0, Math.PI * 2);
        ctx.arc(i + 20, horizonY - treeH + 20, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(i - 5, horizonY - 40, 10, 40);
    }
};

const drawTarget = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(0, 80, 50, 8, 0, 0, Math.PI * 2); ctx.fill();

    // Legs
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-35, 0, 10, 80);
    ctx.fillRect(25, 0, 10, 80);
    ctx.fillRect(-40, 60, 80, 8);

    // Face
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(-55, -55, 110, 110);

    // Rings
    const rings = [
        { r: 50, c: 'white' }, { r: 40, c: 'black' },
        { r: 30, c: '#00bcd4' }, { r: 20, c: '#f44336' }, { r: 10, c: '#ffeb3b' }
    ];
    rings.forEach(ring => {
        ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
        ctx.fillStyle = ring.c; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.restore();
};

const drawReticle = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);

    // Outer glow
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();

    // Main circle
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();

    // Crosshair lines (with gap in center)
    ctx.beginPath();
    ctx.moveTo(0, -30); ctx.lineTo(0, -6);
    ctx.moveTo(0, 6); ctx.lineTo(0, 30);
    ctx.moveTo(-30, 0); ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0); ctx.lineTo(30, 0);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
};

const drawHUD = (
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    windVal: Point,
    room: RoomState | null,
    myId: string | undefined,
    lastScore: number | null,
    scoreFlash: number
) => {
    // ── Top bar background ──
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, w, 70);
    // Bottom edge highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, 68, w, 2);

    if (room) {
        const me = room.players.find(p => p.id === myId);
        const opponent = room.players.find(p => p.id !== myId);
        const isMyTurn = room.currentTurn === myId;

        // ── My Score (left) ──
        ctx.fillStyle = isMyTurn ? '#fbbf24' : '#94a3b8';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('YOU', 20, 28);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 28px Arial';
        ctx.fillText(`${me?.score ?? 0}`, 20, 56);

        // ── Round (center) ──
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px Arial';
        ctx.fillText(`ROUND`, w / 2, 24);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px Arial';
        ctx.fillText(`${room.round} / ${room.maxRounds}`, w / 2, 50);

        // Turn indicator
        if (isMyTurn) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 11px Arial';
            ctx.fillText('▶ YOUR TURN', w / 2, 66);
        } else if (room.players.length > 1) {
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Arial';
            ctx.fillText("OPPONENT'S TURN", w / 2, 66);
        } else {
            ctx.fillStyle = '#3b82f6';
            ctx.font = '11px Arial';
            ctx.fillText('WAITING FOR OPPONENT…', w / 2, 66);
        }

        // ── Opponent Score (right) ──
        ctx.textAlign = 'right';
        ctx.fillStyle = (!isMyTurn && room.players.length > 1) ? '#f87171' : '#94a3b8';
        ctx.font = 'bold 12px Arial';
        ctx.fillText('OPP', w - 20, 28);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 28px Arial';
        ctx.fillText(`${opponent?.score ?? 0}`, w - 20, 56);
    }

    // ── Wind Indicator (top-right, inside bar) ──
    const windX = w - 100;
    const windY = 35;
    ctx.save();
    ctx.translate(windX, windY);

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('WIND', 0, -18);

    // Arrow
    const strength = Math.sqrt(windVal.x * windVal.x + windVal.y * windVal.y);
    const angle = Math.atan2(windVal.y, windVal.x);

    ctx.save();
    ctx.rotate(angle);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
    ctx.lineTo(6, -4); ctx.moveTo(12, 0); ctx.lineTo(6, 4);
    ctx.stroke();
    ctx.restore();

    // Strength number
    ctx.fillStyle = 'white';
    ctx.font = 'bold 13px Arial';
    ctx.fillText(strength.toFixed(1), 0, 18);

    ctx.restore();

    // ── Score Flash (center of screen) ──
    if (lastScore !== null && scoreFlash > 0) {
        ctx.save();
        ctx.globalAlpha = scoreFlash;
        ctx.textAlign = 'center';
        ctx.fillStyle = lastScore >= 8 ? '#fbbf24' : lastScore >= 5 ? '#34d399' : lastScore > 0 ? '#94a3b8' : '#ef4444';
        ctx.font = `bold ${48 + (1 - scoreFlash) * 20}px Arial`;
        ctx.fillText(lastScore > 0 ? `+${lastScore}` : 'MISS', w / 2, h / 2);
        if (lastScore === 10) {
            ctx.font = 'bold 20px Arial';
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('BULLSEYE!', w / 2, h / 2 + 40);
        }
        ctx.restore();
    }

    // ── Bottom instruction ──
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tap & hold to aim · Release to shoot', w / 2, h - 20);
};

export default GameCanvas;
