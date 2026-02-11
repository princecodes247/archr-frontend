import React, { useRef, useEffect, useState } from 'react';
import { useControls, folder } from 'leva';
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

    // ── Leva GUI Controls ──
    const controls = useControls({
        'Drift Physics': folder({
            steeringPower: { value: 0.15, min: 0.01, max: 1.0, step: 0.01, label: 'Steering Power' },
            maxSpeed: { value: 4.0, min: 0.5, max: 15.0, step: 0.1, label: 'Max Speed' },
            minSpeed: { value: 0.4, min: 0.0, max: 3.0, step: 0.1, label: 'Min Speed' },
        }),
        'Aiming': folder({
            timerSeconds: { value: 5.0, min: 1.0, max: 15.0, step: 0.5, label: 'Timer (s)' },
            aimZoom: { value: 2.0, min: 1.0, max: 4.0, step: 0.1, label: 'Aim Zoom' },
        }),
        'Result': folder({
            resultZoom: { value: 3.0, min: 1.0, max: 6.0, step: 0.1, label: 'Result Zoom' },
            holdTime: { value: 2.0, min: 0.5, max: 5.0, step: 0.1, label: 'Hold Duration (s)' },
        }),
        'Target': folder({
            targetScale: { value: 0.6, min: 0.1, max: 2.0, step: 0.1, label: 'Target Size' },
        })
    });

    // Game State Refs (mutable, used in animation loop)
    const reticlePos = useRef<Point>({ x: 0, y: 0 });
    const momentum = useRef<Point>({ x: 0, y: 0 });    // Freedrift velocity
    const inputBuffer = useRef<Point>({ x: 0, y: 0 }); // Accumulated mouse delta since last frame
    const lastInputPos = useRef<Point | null>(null);
    const wind = useRef<Point>({ x: 0, y: 0 });
    const isAiming = useRef(false);
    const zoomLevel = useRef(1);

    // Aim timer: 1.0 (full) → 0.0 (auto-fire)
    const aimTimer = useRef(1.0);
    const shouldAutoFire = useRef(false);

    // Arrow flight animation refs
    const arrowFlight = useRef<{
        active: boolean;
        progress: number;
        hitPoint: Point;
    }>({ active: false, progress: 0, hitPoint: { x: 0, y: 0 } });

    // Impact animation (overshoot + bounce + squash when arrow lands)
    const arrowImpact = useRef<{
        active: boolean;
        frame: number;       // Current frame of impact anim
        totalFrames: number; // Duration (~12 frames = 0.2s)
        hitPoint: Point;
    }>({ active: false, frame: 0, totalFrames: 12, hitPoint: { x: 0, y: 0 } });

    // Board shake on impact
    const boardShake = useRef<{ x: number; y: number; decay: number }>({
        x: 0, y: 0, decay: 0
    });

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
            // Additive Impulse Steering: Mouse movement imparts momentum change.
            // Momentum persists forever (no friction) and is clamped by Speed Bounds.
            if (isMyTurn && isAiming.current) {
                const m = momentum.current;
                const buf = inputBuffer.current;

                // 1. Add accumulated input as thrust (delta based steering)
                m.x += buf.x * controls.steeringPower;
                m.y += buf.y * controls.steeringPower;

                // Clear buffer for next frame
                buf.x = 0;
                buf.y = 0;

                // 2. Bound speed: Clamp to [MIN_SPEED, MAX_SPEED]
                const speed = Math.sqrt(m.x * m.x + m.y * m.y);
                if (speed > controls.maxSpeed) {
                    const scale = controls.maxSpeed / speed;
                    m.x *= scale;
                    m.y *= scale;
                } else if (speed < controls.minSpeed && speed > 0.001) {
                    const scale = controls.minSpeed / speed;
                    m.x *= scale;
                    m.y *= scale;
                }

                // 3. Apply momentum to position
                reticlePos.current.x += m.x;
                reticlePos.current.y += m.y;

            } else if (!isMyTurn) {
                reticlePos.current = { x: 0, y: 0 };
                momentum.current = { x: 0, y: 0 };
                inputBuffer.current = { x: 0, y: 0 };
                lastInputPos.current = null;
            }

            // ── Zoom Interpolation ──
            // Three zoom phases: normal (1x), aiming (2x on target), post-shot (3x on hit)
            const psz = postShotZoom.current;
            let desiredZoom = 1.0;
            let zoomFocusX = targetCenterX;
            let zoomFocusY = targetCenterY;

            if (psz.active) {
                desiredZoom = controls.resultZoom;
                zoomFocusX = targetCenterX + psz.hitPoint.x;
                zoomFocusY = targetCenterY + psz.hitPoint.y;
                psz.timer--;
                if (psz.timer <= 0) {
                    psz.active = false;
                }
            } else if (isMyTurn && isAiming.current) {
                desiredZoom = controls.aimZoom;
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

            // 3. Target (with board shake offset)
            const shake = boardShake.current;
            let shakeX = 0, shakeY = 0;
            if (shake.decay > 0) {
                shakeX = shake.x * shake.decay * Math.sin(shake.decay * 40);
                shakeY = shake.y * shake.decay * Math.cos(shake.decay * 35);
                shake.decay *= 0.88; // Exponential decay
                if (shake.decay < 0.01) shake.decay = 0;
            }
            drawTarget(ctx, targetCenterX + shakeX, targetCenterY + shakeY, controls.targetScale);

            // 4. Pinned arrow (after flight completes)
            if (pinnedArrow) {
                drawPinnedArrow(ctx, targetCenterX + shakeX + pinnedArrow.x, targetCenterY + shakeY + pinnedArrow.y, 1.0);
            }

            // 4b. Impact animation (arrow landing with overshoot/bounce)
            const impact = arrowImpact.current;
            if (impact.active) {
                impact.frame++;
                const t = impact.frame / impact.totalFrames; // 0 → 1

                // Overshoot + damped bounce: starts at 1.15 (overshoot), settles to 1.0
                const bounce = 1.0 + 0.15 * Math.cos(t * Math.PI * 2.5) * (1 - t);
                // Squash: compress Y at impact, then relax
                const squash = 1.0 - 0.12 * Math.cos(t * Math.PI * 3) * (1 - t);

                ctx.save();
                const ax = targetCenterX + shakeX + impact.hitPoint.x;
                const ay = targetCenterY + shakeY + impact.hitPoint.y;
                ctx.translate(ax, ay);
                ctx.scale(bounce, squash);
                ctx.translate(-ax, -ay);
                drawPinnedArrow(ctx, ax, ay, t);
                ctx.restore();

                if (impact.frame >= impact.totalFrames) {
                    impact.active = false;
                    setPinnedArrow(impact.hitPoint);
                }
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

                // Flight complete → trigger impact animation + post-shot zoom
                if (t >= 1) {
                    flight.active = false;
                    // Start impact animation (overshoot + bounce)
                    arrowImpact.current = {
                        active: true,
                        frame: 0,
                        totalFrames: 12,
                        hitPoint: flight.hitPoint
                    };
                    // Board shake
                    boardShake.current = {
                        x: (Math.random() - 0.5) * 4,
                        y: (Math.random() - 0.5) * 3,
                        decay: 1.0
                    };
                    postShotZoom.current = {
                        active: true,
                        timer: Math.floor(60 * controls.holdTime),
                        hitPoint: flight.hitPoint
                    };
                }
            }

            // 6. Reticle + Aim Timer
            if (isMyTurn && isAiming.current) {
                // Tick down the aim timer
                const framesPerSecond = 60;
                const totalFrames = controls.timerSeconds * framesPerSecond;
                aimTimer.current = Math.max(0, aimTimer.current - (1 / totalFrames));

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
    const handleStart = (x: number, y: number) => {
        if (!isMyTurn || postShotZoom.current.active) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const cx = canvas.width / 2;
        const cy = canvas.height * 0.55 + 80;
        const zoom = zoomLevel.current;
        const worldX = (x - cx) / zoom;
        const worldY = (y - cy) / zoom;

        isAiming.current = true;
        aimTimer.current = 1.0;
        shouldAutoFire.current = false;

        // Snap reticle to finger position
        reticlePos.current = { x: worldX, y: worldY };
        lastInputPos.current = { x: worldX, y: worldY };
        inputBuffer.current = { x: 0, y: 0 };

        // Start with a gentle random drift (never stands still)
        const angle = Math.random() * Math.PI * 2;
        momentum.current = {
            x: Math.cos(angle) * controls.minSpeed, // Updated from controls.drift.minSpeed
            y: Math.sin(angle) * controls.minSpeed // Updated from controls.drift.minSpeed
        };

        setPinnedArrow(null);
        setLastScore(null);
    };

    const handleMove = (x: number, y: number) => {
        if (!isMyTurn || !isAiming.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const cx = canvas.width / 2;
        const cy = canvas.height * 0.55 + 80;
        const zoom = zoomLevel.current;
        const worldX = (x - cx) / zoom;
        const worldY = (y - cy) / zoom;

        if (lastInputPos.current) {
            const dx = worldX - lastInputPos.current.x;
            const dy = worldY - lastInputPos.current.y;
            // Accumulate delta for the physics loop
            inputBuffer.current.x += dx;
            inputBuffer.current.y += dy;
        }

        lastInputPos.current = { x: worldX, y: worldY };
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
            onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
            onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
            onMouseUp={handleEnd}
            onMouseLeave={() => { if (isAiming.current) handleEnd(); }}
            onTouchStart={(e) => {
                handleStart(e.touches[0].clientX, e.touches[0].clientY);
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

const drawPinnedArrow = (ctx: CanvasRenderingContext2D, x: number, y: number, animProgress: number = 1.0) => {
    ctx.save();
    ctx.translate(x, y);

    // Deterministic tilt from hit position (5°–7° unique angle per arrow)
    const seed = Math.abs(x * 73.13 + y * 91.17) % 360;
    const tiltAngle = ((seed / 360) * 0.24 - 0.12); // ±7° — subtle, fired not placed
    ctx.rotate(tiltAngle);

    // ── Proportions (refined: thinner shaft, smaller vanes) ──
    const shaftLen = 28;
    const shaftR1 = 1.3;   // Slim shaft (matches ferrule inner radius)
    const shaftR2 = 1.3;   // Same width — straight cylinder, no taper

    // ── 1. Shadow ellipse under shaft (depth contact) ──
    ctx.save();
    ctx.globalAlpha = 0.2 * animProgress;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(3, 2, shaftLen * 0.6, 3.5, tiltAngle + 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // // ── 2. Board indentation circle (1-2px pressed-in ring) ──
    // ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    // ctx.lineWidth = 1.5;
    // ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.stroke();

    // // Inner dark hole
    // ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    // ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();

    // Pushed-out rim (lighter)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();

    // ── 3. Broadhead tip (viewed from behind — ferrule + 3 blades) ──
    // Ferrule (cylindrical base that connects to shaft)
    const ferruleR = 2.2;
    const ferruleGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, ferruleR + 1);
    ferruleGrad.addColorStop(0, '#bbb');
    ferruleGrad.addColorStop(0.4, '#999');
    ferruleGrad.addColorStop(0.8, '#777');
    ferruleGrad.addColorStop(1, '#555');
    ctx.fillStyle = ferruleGrad;
    ctx.beginPath(); ctx.arc(0, 0, ferruleR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 3 Blade edges radiating from ferrule (120° apart)
    const bladeLen = 6;
    const bladeW = 1.8;
    for (let b = 0; b < 3; b++) {
        const bAngle = (b * 120 - 60) * (Math.PI / 180);
        const bTipX = Math.cos(bAngle) * bladeLen;
        const bTipY = Math.sin(bAngle) * bladeLen;
        const bPerpX = -Math.sin(bAngle) * bladeW * 0.5;
        const bPerpY = Math.cos(bAngle) * bladeW * 0.5;

        // Blade shape (tapered razor edge)
        const bladeGrad = ctx.createLinearGradient(0, 0, bTipX, bTipY);
        bladeGrad.addColorStop(0, '#aaa');
        bladeGrad.addColorStop(0.3, '#d0d0d0');
        bladeGrad.addColorStop(0.6, '#e8e8e8'); // Razor edge glint
        bladeGrad.addColorStop(1, '#888');
        ctx.fillStyle = bladeGrad;
        ctx.beginPath();
        ctx.moveTo(bPerpX * 0.6, bPerpY * 0.6);
        ctx.lineTo(bTipX, bTipY);
        ctx.lineTo(-bPerpX * 0.6, -bPerpY * 0.6);
        ctx.closePath();
        ctx.fill();
        // Blade edge highlight
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(bPerpX * 0.3, bPerpY * 0.3);
        ctx.lineTo(bTipX * 0.9, bTipY * 0.9);
        ctx.stroke();
    }

    // Center specular highlight on ferrule
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(-0.3, -0.5, 0.8, 0, Math.PI * 2); ctx.fill();

    // ── 4. Shaft (slim carbon tube, black at bottom → dark gray at top) ──
    const shaftGradV = ctx.createLinearGradient(0, 0, 0, -shaftLen);
    shaftGradV.addColorStop(0, '#111');       // Black at ferrule end
    shaftGradV.addColorStop(0.15, '#222');     // Near-black
    shaftGradV.addColorStop(0.4, '#3a3a3a');   // Dark gray
    shaftGradV.addColorStop(0.7, '#4a4a4a');   // Mid gray
    shaftGradV.addColorStop(1, '#444');         // Slightly lighter at back
    // Horizontal highlight (cylindrical sheen)
    const shaftGradH = ctx.createLinearGradient(-shaftR1 - 0.5, 0, shaftR1 + 0.5, 0);
    shaftGradH.addColorStop(0, 'rgba(0,0,0,0.4)');
    shaftGradH.addColorStop(0.35, 'rgba(255,255,255,0.05)');
    shaftGradH.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    shaftGradH.addColorStop(0.65, 'rgba(255,255,255,0.03)');
    shaftGradH.addColorStop(1, 'rgba(0,0,0,0.3)');

    // Draw shaft body (starts flush with ferrule)
    ctx.fillStyle = shaftGradV;
    ctx.beginPath();
    ctx.moveTo(-shaftR1, 0);       // Starts at ferrule center
    ctx.lineTo(-shaftR2, -shaftLen);
    ctx.lineTo(shaftR2, -shaftLen);
    ctx.lineTo(shaftR1, 0);
    ctx.closePath();
    ctx.fill();
    // Overlay horizontal highlight
    ctx.fillStyle = shaftGradH;
    ctx.fill();

    // Subtle texture lines (carbon weave)
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.4;
    for (let i = 0; i < shaftLen; i += 4) {
        const frac = i / shaftLen;
        const w = shaftR1 + (shaftR2 - shaftR1) * frac;
        const yy = -1 - i;
        ctx.beginPath(); ctx.moveTo(-w, yy); ctx.lineTo(w, yy - 1.5); ctx.stroke();
    }
    ctx.restore();

    // ── 5. Pin wrap / binding (where vanes attach to shaft) ──
    const wrapY = -shaftLen + 1;
    const wrapGrad = ctx.createLinearGradient(-shaftR2, 0, shaftR2, 0);
    wrapGrad.addColorStop(0, '#146614');
    wrapGrad.addColorStop(0.3, '#22aa22');
    wrapGrad.addColorStop(0.5, '#33cc33');
    wrapGrad.addColorStop(0.7, '#22aa22');
    wrapGrad.addColorStop(1, '#146614');
    ctx.fillStyle = wrapGrad;
    ctx.fillRect(-shaftR2 - 0.3, wrapY, (shaftR2 + 0.3) * 2, 3);
    // Wrap thread lines
    ctx.strokeStyle = 'rgba(0,80,0,0.3)';
    ctx.lineWidth = 0.4;
    for (let wy = wrapY; wy < wrapY + 3; wy += 1) {
        ctx.beginPath(); ctx.moveTo(-shaftR2, wy); ctx.lineTo(shaftR2, wy); ctx.stroke();
    }

    // ── 6. Fletching — two triangular vanes in V-shape ──
    // Vanes attach at wrap and splay AWAY from target (negative Y = up on screen)
    const vaneBaseY = -shaftLen;     // Wrap/attach point
    const fLen = 18;                  // How far vanes extend
    const fSpread = 14;              // Lateral splay

    for (const d of [-1, 1]) {
        ctx.save();

        // Attachment point at wrap (on shaft)
        const attachX = d * 1;
        const attachY = vaneBaseY + 2;          // Just below wrap, on shaft
        // Wing tip: outward and AWAY from target (more negative Y)
        const tipX = d * fSpread;
        const tipY = vaneBaseY - fLen;            // Away from target
        // Inner point back near shaft
        const innerX = 0;
        const innerY = vaneBaseY - fLen * 0.7;

        // Main vane face
        const vGrad = ctx.createLinearGradient(attachX, attachY, tipX, tipY);
        vGrad.addColorStop(0, '#E83030');
        vGrad.addColorStop(0.4, '#F04545');
        vGrad.addColorStop(0.7, '#DD2020');
        vGrad.addColorStop(1, '#AA1515');
        ctx.fillStyle = vGrad;

        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.quadraticCurveTo(
            d * fSpread * 0.5, vaneBaseY - fLen * 0.4,
            tipX, tipY
        );
        ctx.lineTo(innerX, innerY);
        ctx.closePath();
        ctx.fill();

        // Inner face (darker — depth)
        ctx.fillStyle = 'rgba(120, 15, 15, 0.4)';
        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.lineTo(innerX, innerY);
        ctx.lineTo(innerX + d * 2, innerY + 3);
        ctx.closePath();
        ctx.fill();

        // Outline
        ctx.strokeStyle = 'rgba(80, 0, 0, 0.35)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.quadraticCurveTo(
            d * fSpread * 0.5, vaneBaseY - fLen * 0.4,
            tipX, tipY
        );
        ctx.lineTo(innerX, innerY);
        ctx.closePath();
        ctx.stroke();

        // Highlight streak
        ctx.strokeStyle = 'rgba(255, 180, 180, 0.2)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(d * 1.5, attachY - 2);
        ctx.quadraticCurveTo(
            d * fSpread * 0.35, vaneBaseY - fLen * 0.3,
            tipX * 0.7, tipY
        );
        ctx.stroke();

        ctx.restore();
    }

    // ── 7. Nock (above fletching tips) ──
    const nockY = vaneBaseY - fLen * 0.7 - 2;
    const nockGrad = ctx.createRadialGradient(0, nockY, 0, 0, nockY, 3);
    nockGrad.addColorStop(0, '#f0f0f0');
    nockGrad.addColorStop(0.5, '#ddd');
    nockGrad.addColorStop(1, '#aaa');
    ctx.fillStyle = nockGrad;
    ctx.beginPath(); ctx.arc(0, nockY, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // String groove
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-1.8, nockY + 0.5);
    ctx.lineTo(0, nockY - 1.5);
    ctx.lineTo(1.8, nockY + 0.5);
    ctx.stroke();

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
