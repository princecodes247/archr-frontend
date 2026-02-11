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
    const zoomLevel = useRef(1);
    const swayPhase = useRef({ px1: Math.random() * 100, px2: Math.random() * 100, py1: Math.random() * 100, py2: Math.random() * 100 });

    // Aim timer: 1.0 (full) → 0.0 (auto-fire)
    const AIM_DURATION_FRAMES = 4 * 60; // ~4 seconds at 60fps
    const aimTimer = useRef(1.0);
    const shouldAutoFire = useRef(false);

    // Arrow flight animation refs
    const arrowFlight = useRef<{
        active: boolean;
        progress: number;
        hitPoint: Point;
    }>({ active: false, progress: 0, hitPoint: { x: 0, y: 0 } });

    // Post-shot zoom state
    const postShotZoom = useRef<{
        active: boolean;
        timer: number;     // countdown in frames
        hitPoint: Point;   // zoom focus (relative to target center)
    }>({ active: false, timer: 0, hitPoint: { x: 0, y: 0 } });

    // React State for rendered overlays
    const [pinnedArrow, setPinnedArrow] = useState<Point | null>(null);
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
            // Start arrow flight animation
            const hitPt = data.path[0] || { x: 0, y: 0 };
            arrowFlight.current = { active: true, progress: 0, hitPoint: hitPt };
            setPinnedArrow(null); // Clear old pinned arrow
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
            // Three zoom phases: normal (1x), aiming (2x on target), post-shot (3x on hit)
            const psz = postShotZoom.current;
            let desiredZoom = 1.0;
            let zoomFocusX = targetCenterX;
            let zoomFocusY = targetCenterY;

            if (psz.active) {
                desiredZoom = 3.0;
                zoomFocusX = targetCenterX + psz.hitPoint.x;
                zoomFocusY = targetCenterY + psz.hitPoint.y;
                psz.timer--;
                if (psz.timer <= 0) {
                    psz.active = false;
                }
            } else if (isMyTurn && isAiming.current) {
                desiredZoom = 2.0;
            }

            zoomLevel.current += (desiredZoom - zoomLevel.current) * 0.06;

            // ── Drawing ──
            ctx.save();

            // Apply zoom centered on focus point
            const zoom = zoomLevel.current;
            ctx.translate(zoomFocusX, zoomFocusY);
            ctx.scale(zoom, zoom);
            ctx.translate(-zoomFocusX, -zoomFocusY);

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

            // 4. Pinned arrow (after flight completes)
            if (pinnedArrow) {
                drawPinnedArrow(ctx, targetCenterX + pinnedArrow.x, targetCenterY + pinnedArrow.y);
            }

            // 5. Arrow flight animation
            const flight = arrowFlight.current;
            if (flight.active) {
                flight.progress += 0.025; // ~40 frames to complete
                const t = Math.min(flight.progress, 1);

                // Start: bottom center of screen (bow position)
                const startX = centerX;
                const startY = h + 50; // Just below screen
                // End: hit point on target
                const endX = targetCenterX + flight.hitPoint.x;
                const endY = targetCenterY + flight.hitPoint.y;
                // Arc peak: midpoint with upward offset
                const peakY = Math.min(startY, endY) - 200;

                // Quadratic bezier interpolation
                const midX = (startX + endX) / 2;
                const ax = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * endX;
                const ay = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * peakY + t * t * endY;

                // Calculate angle from trajectory
                const dt = 0.01;
                const t2 = Math.min(t + dt, 1);
                const ax2 = (1 - t2) * (1 - t2) * startX + 2 * (1 - t2) * t2 * midX + t2 * t2 * endX;
                const ay2 = (1 - t2) * (1 - t2) * startY + 2 * (1 - t2) * t2 * peakY + t2 * t2 * endY;
                const angle = Math.atan2(ay2 - ay, ax2 - ax);

                // Draw flying arrow
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(angle);

                // Shaft
                ctx.strokeStyle = '#5c4033';
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(-25, 0); ctx.lineTo(15, 0); ctx.stroke();

                // Arrowhead
                ctx.fillStyle = '#888';
                ctx.beginPath();
                ctx.moveTo(18, 0); ctx.lineTo(12, -4); ctx.lineTo(12, 4);
                ctx.fill();

                // Fletching
                ctx.fillStyle = '#c0392b';
                ctx.beginPath();
                ctx.moveTo(-25, 0); ctx.lineTo(-30, -5); ctx.lineTo(-22, 0);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(-25, 0); ctx.lineTo(-30, 5); ctx.lineTo(-22, 0);
                ctx.fill();

                ctx.restore();

                // Flight complete → pin the arrow and trigger post-shot zoom
                if (t >= 1) {
                    flight.active = false;
                    setPinnedArrow(flight.hitPoint);
                    postShotZoom.current = {
                        active: true,
                        timer: 120, // ~2 seconds at 60fps
                        hitPoint: flight.hitPoint
                    };
                }
            }

            // 6. Reticle + Aim Timer
            if (isMyTurn && isAiming.current) {
                // Tick down the aim timer
                aimTimer.current = Math.max(0, aimTimer.current - (1 / AIM_DURATION_FRAMES));

                // Auto-fire when timer expires
                if (aimTimer.current <= 0 && !shouldAutoFire.current) {
                    shouldAutoFire.current = true;
                }

                const rx = targetCenterX + reticlePos.current.x;
                const ry = targetCenterY + reticlePos.current.y;
                drawReticle(ctx, rx, ry, aimTimer.current);
            }

            ctx.restore(); // Undo zoom

            // ── HUD (drawn OUTSIDE zoom, always screen-space) ──
            drawHUD(ctx, w, h, wind.current, roomState, socket?.id, lastScore, scoreFlash);

            // Fade score flash
            if (scoreFlash > 0) {
                setScoreFlash(prev => Math.max(0, prev - 0.015));
            }

            // Handle auto-fire (from timer expiry)
            if (shouldAutoFire.current) {
                shouldAutoFire.current = false;
                isAiming.current = false;
                socket?.emit('shoot', { aimPosition: reticlePos.current });
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationFrameId);
    }, [isMyTurn, pinnedArrow, roomState, lastScore, scoreFlash]);

    // ── Input Handlers ──
    const handleStart = () => {
        if (!isMyTurn) return;
        isAiming.current = true;
        aimTimer.current = 1.0; // Reset timer
        shouldAutoFire.current = false;
        setPinnedArrow(null);
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

    const boardSize = 140; // Half-size of the board
    const bs = boardSize;

    // ── Ground shadow ──
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(0, bs + 30, bs * 0.7, 12, 0, 0, Math.PI * 2); ctx.fill();

    // ── Wooden legs ──
    const legW = 14;
    const legH = 100;
    // Left leg
    ctx.fillStyle = '#6d4c2a';
    ctx.fillRect(-bs * 0.55, bs * 0.1, legW, legH);
    // Right leg
    ctx.fillRect(bs * 0.55 - legW, bs * 0.1, legW, legH);
    // Cross brace
    ctx.fillRect(-bs * 0.55, legH * 0.5 + bs * 0.1, bs * 1.1, 10);
    // Darker edge on legs
    ctx.fillStyle = '#5a3d1e';
    ctx.fillRect(-bs * 0.55, bs * 0.1, 3, legH);
    ctx.fillRect(bs * 0.55 - 3, bs * 0.1, 3, legH);

    // ── Wooden frame (border) ──
    const frameW = 16;
    // Frame background
    ctx.fillStyle = '#7a4f2a';
    ctx.fillRect(-bs - frameW, -bs - frameW, (bs + frameW) * 2, (bs + frameW) * 2);
    // Wood grain lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let i = -bs - frameW; i < bs + frameW; i += 6) {
        ctx.beginPath();
        ctx.moveTo(-bs - frameW, i); ctx.lineTo(bs + frameW, i + 3);
        ctx.stroke();
    }
    // Frame highlight (top/left bevel)
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(-bs - frameW, -bs - frameW, (bs + frameW) * 2, 4);
    ctx.fillRect(-bs - frameW, -bs - frameW, 4, (bs + frameW) * 2);
    // Frame shadow (bottom/right bevel)
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(-bs - frameW, bs + frameW - 4, (bs + frameW) * 2, 4);
    ctx.fillRect(bs + frameW - 4, -bs - frameW, 4, (bs + frameW) * 2);

    // ── Corner bolts ──
    const boltPositions = [
        [-bs - 6, -bs - 6], [bs + 6, -bs - 6],
        [-bs - 6, bs + 6], [bs + 6, bs + 6]
    ];
    boltPositions.forEach(([bx, by]) => {
        ctx.fillStyle = '#999';
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#777';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
        // Screw slot
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(bx - 2, by); ctx.lineTo(bx + 2, by); ctx.stroke();
    });

    // ── White backing (target paper) ──
    ctx.fillStyle = '#f0ece4';
    ctx.fillRect(-bs, -bs, bs * 2, bs * 2);
    // Subtle paper texture
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    for (let ty = -bs; ty < bs; ty += 4) {
        for (let tx = -bs; tx < bs; tx += 4) {
            if (Math.random() > 0.5) ctx.fillRect(tx, ty, 4, 4);
        }
    }

    // ── Target rings (WA Archery standard) ──
    // Rings from outside in: score 1-10
    // Colors: white(1-2), white(3), black(3-4), blue(5-6), red(7-8), gold(9-10), gold X
    const rings: { r: number; fill: string; score: number }[] = [
        { r: 120, fill: '#e8e4dc', score: 1 },  // white
        { r: 108, fill: '#e0dcd4', score: 2 },  // white
        { r: 96, fill: '#d8d4cc', score: 3 },   // light gray
        { r: 84, fill: '#222', score: 4 },   // black
        { r: 72, fill: '#333', score: 5 },   // black
        { r: 60, fill: '#2196F3', score: 6 },   // blue
        { r: 48, fill: '#1976D2', score: 7 },   // blue
        { r: 36, fill: '#f44336', score: 8 },   // red
        { r: 28, fill: '#d32f2f', score: 9 },   // red
        { r: 18, fill: '#FFD600', score: 10 },  // gold/yellow
    ];

    rings.forEach(ring => {
        ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
        ctx.fillStyle = ring.fill; ctx.fill();
        // Ring border
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8; ctx.stroke();
    });

    // Inner X ring (bullseye)
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFC107'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5; ctx.stroke();

    // Center cross
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();

    // ── Score numbers ──
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Place numbers at bottom of each ring zone
    const numberPositions = [
        { score: 1, y: 114 }, { score: 2, y: 102 }, { score: 3, y: 90 },
        { score: 4, y: 78 }, { score: 5, y: 66 }, { score: 6, y: 54 },
        { score: 7, y: 42 }, { score: 8, y: 32 }, { score: 9, y: 23 },
    ];
    numberPositions.forEach(np => {
        const isLight = np.score <= 3;
        ctx.fillStyle = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)';
        ctx.fillText(`${np.score}`, 0, np.y);
    });

    ctx.restore();
};

const drawPinnedArrow = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);

    // Impact hole
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();

    // Shaft protruding outward (foreshortened — viewed from front)
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(-1.5, -3, 3, -18); // Short shaft sticking "out" (drawn upward for perspective)

    // Fletching (two fins at the end of the shaft)
    const fY = -21;
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(0, fY); ctx.lineTo(-6, fY - 8); ctx.lineTo(0, fY - 4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, fY); ctx.lineTo(6, fY - 8); ctx.lineTo(0, fY - 4);
    ctx.fill();

    // Nock (small circle at end)
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(0, fY - 4, 1.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
};

const drawReticle = (ctx: CanvasRenderingContext2D, x: number, y: number, timerFraction: number) => {
    ctx.save();
    ctx.translate(x, y);

    const outerR = 32;
    const innerR = 20;

    // ── Timer arc (outer ring) ──
    // Background track (dim)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, outerR, 0, Math.PI * 2); ctx.stroke();

    // Active timer arc — color shifts green → yellow → red
    const startAngle = -Math.PI / 2; // 12 o'clock
    const endAngle = startAngle + timerFraction * Math.PI * 2;

    let timerColor: string;
    let glowColor: string;
    if (timerFraction > 0.5) {
        timerColor = '#4ade80';
        glowColor = 'rgba(74, 222, 128, 0.3)';
    } else if (timerFraction > 0.25) {
        timerColor = '#facc15';
        glowColor = 'rgba(250, 204, 21, 0.3)';
    } else {
        timerColor = '#ef4444';
        glowColor = 'rgba(239, 68, 68, 0.3)';
    }

    // Glow behind the arc
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 9;
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(0, 0, outerR, startAngle, endAngle); ctx.stroke();
    ctx.globalAlpha = 1;

    // Main timer arc
    ctx.strokeStyle = timerColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, outerR, startAngle, endAngle); ctx.stroke();
    ctx.lineCap = 'butt';

    // ── Inner circle ──
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, innerR, 0, Math.PI * 2); ctx.stroke();

    // ── Crosshair lines (with gap in center) ──
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -outerR + 2); ctx.lineTo(0, -6);
    ctx.moveTo(0, 6); ctx.lineTo(0, outerR - 2);
    ctx.moveTo(-outerR + 2, 0); ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0); ctx.lineTo(outerR - 2, 0);
    ctx.stroke();

    // ── Center dot ──
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
