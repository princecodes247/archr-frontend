import { useRef, useEffect } from 'react';
import { useControls, folder } from 'leva';
import { useSocketStore } from '../stores/useSocketStore';
import type { Room, Point } from '../types';

interface GameCanvasProps {
    onExit: () => void;
}

// Player fletching color palettes
interface FletchingColors {
    grad: [string, string, string, string]; // gradient stops
    inner: string;                          // inner face
    outline: string;                        // outline stroke
    highlight: string;                      // sheen highlight
}
const FLETCHING_PALETTES: FletchingColors[] = [
    { // Player 1: Red
        grad: ['#E83030', '#F04545', '#DD2020', '#AA1515'],
        inner: 'rgba(120, 15, 15, 0.4)',
        outline: 'rgba(80, 0, 0, 0.35)',
        highlight: 'rgba(255, 180, 180, 0.2)',
    },
    { // Player 2: Blue
        grad: ['#2060E8', '#3575F0', '#1850DD', '#1035AA'],
        inner: 'rgba(15, 30, 120, 0.4)',
        outline: 'rgba(0, 0, 80, 0.35)',
        highlight: 'rgba(180, 200, 255, 0.2)',
    },
];

const GameCanvas: React.FC<GameCanvasProps> = ({ onExit }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { socket, room, playerId } = useSocketStore();
    // Solo: always your turn while time remains. Multiplayer: check currentTurn.
    const isSoloActive = room?.mode === 'solo' && (room?.timeRemaining ?? 0) > 0;
    const isMyTurn = isSoloActive || room?.currentTurn === playerId;

    // ── Leva GUI Controls ──
    const controls = useControls({
        'Drift Physics': folder({
            dragSensitivity: { value: 0.5, min: 0.1, max: 2.0, step: 0.05, label: 'Drag Sensitivity' },
            friction: { value: 0.85, min: 0.5, max: 0.99, step: 0.01, label: 'Friction' },
            driftSpeed: { value: 0.3, min: 0.0, max: 2.0, step: 0.1, label: 'Random Drift' },
        }),
        'Aiming': folder({
            timerSeconds: { value: 5.0, min: 1.0, max: 15.0, step: 0.5, label: 'Timer (s)' },
            aimZoom: { value: 2.0, min: 1.0, max: 4.0, step: 0.1, label: 'Aim Zoom' },
        }),
        'Result': folder({
            resultZoom: { value: 3.0, min: 1.0, max: 6.0, step: 0.1, label: 'Result Zoom' },
            holdTime: { value: 3.2, min: 0.5, max: 5.0, step: 0.1, label: 'Hold Duration (s)' },
            gameOverDelay: { value: 1000, min: 0, max: 2000, step: 100, label: 'Game Over Delay (ms)' },
        }),
        'Target': folder({
            targetScale: { value: 0.6, min: 0.1, max: 2.0, step: 0.1, label: 'Target Size' },
        }),
        'Flight Animation': folder({
            flightDuration: { value: 350, min: 200, max: 2000, step: 50, label: 'Duration (ms)' },
            arcHeightFactor: { value: 0.20, min: 0.01, max: 0.5, step: 0.01, label: 'Arc Height %' },
            windDriftXFactor: { value: 6.0, min: 0.0, max: 20.0, step: 0.5, label: 'Wind Drift X' },
            windDriftYFactor: { value: 3.0, min: 0.0, max: 10.0, step: 0.5, label: 'Wind Drift Y' },
            slowMoThreshold: { value: 0.95, min: 0.5, max: 1.0, step: 0.01, label: 'Slow-mo Start' },
            slowMoSpeed: { value: 0.8, min: 0.1, max: 1.0, step: 0.05, label: 'Slow-mo Speed' },
        }),
        'Arrows': folder({
            maxArrows: { value: 3, min: 1, max: 10, step: 1, label: 'Max Retained Arrows' },
        })
    });
    // Store controls in a ref so the render loop always reads the latest
    // without needing controls in any useEffect dependency array.
    const controlsRef = useRef(controls);
    controlsRef.current = controls;

    // Game State Refs (mutable, used in animation loop)
    const reticlePos = useRef<Point>({ x: 0, y: 0 });
    const momentum = useRef<Point>({ x: 0, y: 0 });    // Freedrift velocity
    const inputBuffer = useRef<Point>({ x: 0, y: 0 }); // Accumulated mouse delta since last frame
    const lastInputPos = useRef<Point | null>(null);
    const wind = useRef<Point>({ x: 0, y: 0 });
    const isAiming = useRef(false);
    const zoomLevel = useRef(1);

    // Aim timer: 1.0 (full) → 0.0 (auto-fire)
    const aimTimer = useRef<number>(0);
    const gameOverTimer = useRef<number>(0);
    const shouldAutoFire = useRef<boolean>(false);

    // Zoom / Camera stateion refs
    interface TrailPoint { x: number; y: number; angle: number; alpha: number; }
    interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; r: number; }
    const arrowFlight = useRef<{
        active: boolean;
        elapsed: number;      // ms elapsed
        duration: number;     // total flight ms
        hitPoint: Point;
        startX: number; startY: number;
        endX: number; endY: number;
        windX: number; windY: number;
        arcHeight: number;    // gravity arc magnitude
        trail: TrailPoint[];  // motion trail
        particles: Particle[];// impact dust
        flashFrames: number;  // impact flash countdown
        playerIndex: number;  // who shot this arrow
    }>({
        active: false, elapsed: 0, duration: 550,
        hitPoint: { x: 0, y: 0 },
        startX: 0, startY: 0, endX: 0, endY: 0,
        windX: 0, windY: 0, arcHeight: 180,
        trail: [], particles: [], flashFrames: 0, playerIndex: 0
    });

    // DeltaTime tracking
    const lastFrameTime = useRef(performance.now());

    // Release zoom bump
    const releaseZoomBump = useRef(0);

    // Impact animation (overshoot + bounce + squash when arrow lands)
    const arrowImpact = useRef<{
        active: boolean;
        frame: number;
        totalFrames: number;
        hitPoint: Point;
        playerIndex: number;
    }>({ active: false, frame: 0, totalFrames: 12, hitPoint: { x: 0, y: 0 }, playerIndex: 0 });

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

    // Tutorial state
    const hasInteracted = useRef(false);

    // Render-loop state (refs to avoid re-renders and animation loop re-initialization)
    interface PinnedArrow { point: Point; playerIndex: number; }
    const pinnedArrows = useRef<PinnedArrow[]>([]);
    const roomStateRef = useRef<Room | null>(room);
    const lastScore = useRef<number | null>(null);
    const scoreFlash = useRef(0);
    const pendingScore = useRef<number | null>(null);
    const isMyTurnRef = useRef(isMyTurn);
    isMyTurnRef.current = isMyTurn;

    // Sync room state from prop
    useEffect(() => {
        roomStateRef.current = room;
        if (room?.wind) {
            wind.current = room.wind;
        }
    }, [room]);

    useEffect(() => {
        if (!socket) return;

        const handleShotResult = (data: { player: string, path: Point[], score: number }) => {
            const hitPt = data.path[0] || { x: 0, y: 0 };

            // Determine player index for fletching color
            const pIdx = roomStateRef.current?.players.findIndex(p => p.id === data.player) ?? 0;

            // Compute flight start/end in screen space (will be resolved in render)
            const f = arrowFlight.current;
            f.active = true;
            f.elapsed = 0;
            f.duration = controlsRef.current.flightDuration;
            f.hitPoint = hitPt;
            f.startX = 0; f.startY = 0; // Computed in render (needs canvas dims)
            f.endX = 0; f.endY = 0;
            f.windX = wind.current.x;
            f.windY = wind.current.y;
            f.arcHeight = 180;
            f.trail = [];
            f.particles = [];
            f.flashFrames = 0;
            f.playerIndex = pIdx;

            pendingScore.current = data.score; // Defer until arrow lands

            // Release camera zoom bump
            releaseZoomBump.current = 1.0;
        };

        socket.on('shotResult', handleShotResult);

        return () => {
            socket.off('shotResult', handleShotResult);
        };
    }, [socket]);

    // Offscreen background cache (sky + ground + mowing lines + trees)
    const bgCache = useRef<{ canvas: OffscreenCanvas; w: number; h: number } | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            // DeltaTime (ms)
            const now = performance.now();
            const deltaTime = Math.min(now - lastFrameTime.current, 50); // Cap at 50ms
            lastFrameTime.current = now;
            // Resize (account for devicePixelRatio for sharp rendering on mobile)
            const dpr = window.devicePixelRatio || 1;
            const displayW = window.innerWidth;
            const displayH = window.innerHeight;

            // Resize buffer if mismatch
            if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
                canvas.width = displayW * dpr;
                canvas.height = displayH * dpr;
                canvas.style.width = displayW + 'px';
                canvas.style.height = displayH + 'px';
                bgCache.current = null; // Invalidate background cache on resize
            }

            // Always enforce scale every frame to prevent state drift
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const w = displayW;
            const h = displayH;
            const centerX = w / 2;
            const horizonY = h * 0.55;
            const targetCenterX = centerX;
            const targetCenterY = horizonY + 80;

            // ── Physics Update ──
            // Additive Impulse Steering: Mouse movement imparts momentum change.
            // Momentum persists forever (no friction) and is clamped by Speed Bounds.
            if (isMyTurnRef.current && isAiming.current) {
                const m = momentum.current;
                const buf = inputBuffer.current;

                // 1. Apply drag input directly (screen-space deltas scaled by sensitivity)
                m.x += buf.x * controlsRef.current.dragSensitivity;
                m.y += buf.y * controlsRef.current.dragSensitivity;

                // Clear buffer
                buf.x = 0;
                buf.y = 0;

                // 2. Apply friction (momentum decays naturally)
                m.x *= controlsRef.current.friction;
                m.y *= controlsRef.current.friction;

                // 3. Add gentle random drift so crosshair is never perfectly still
                const driftAngle = performance.now() * 0.002;
                m.x += Math.sin(driftAngle * 1.3) * controlsRef.current.driftSpeed * 0.1;
                m.y += Math.cos(driftAngle * 0.9) * controlsRef.current.driftSpeed * 0.1;

                // 4. Apply momentum to position
                reticlePos.current.x += m.x;
                reticlePos.current.y += m.y;

                // 5. Clamp to target area (keep within ~150px of center)
                const maxR = 160;
                const rx = reticlePos.current.x;
                const ry = reticlePos.current.y;
                const dist = Math.sqrt(rx * rx + ry * ry);
                if (dist > maxR) {
                    reticlePos.current.x = (rx / dist) * maxR;
                    reticlePos.current.y = (ry / dist) * maxR;
                }

            } else if (!isMyTurnRef.current) {
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
                desiredZoom = controlsRef.current.resultZoom;
                zoomFocusX = targetCenterX + psz.hitPoint.x;
                zoomFocusY = targetCenterY + psz.hitPoint.y;
                psz.timer--;
                if (psz.timer <= 0) {
                    psz.active = false;
                }
            } else if (arrowFlight.current.active) {
                // Start zooming toward hit point during flight (last 30%)
                const ft = arrowFlight.current.elapsed / arrowFlight.current.duration;
                if (ft > 0.7) {
                    const zoomBlend = (ft - 0.7) / 0.3; // 0→1 over last 30%
                    desiredZoom = 1.0 + (controlsRef.current.resultZoom - 1.0) * zoomBlend;
                    zoomFocusX = targetCenterX + arrowFlight.current.hitPoint.x;
                    zoomFocusY = targetCenterY + arrowFlight.current.hitPoint.y;
                }
            } else if (isMyTurnRef.current && isAiming.current) {
                desiredZoom = controlsRef.current.aimZoom;
            }

            // Release zoom bump (brief ~2% zoom on shot release)
            if (releaseZoomBump.current > 0.01) {
                desiredZoom += releaseZoomBump.current * 0.03;
                releaseZoomBump.current *= 0.92;
            }

            zoomLevel.current += (desiredZoom - zoomLevel.current) * 0.06;

            // ── Drawing ──
            ctx.save();

            // Apply zoom centered on focus point
            const zoom = zoomLevel.current;
            ctx.translate(zoomFocusX, zoomFocusY);
            ctx.scale(zoom, zoom);
            ctx.translate(-zoomFocusX, -zoomFocusY);

            // 1. Static background (cached to offscreen canvas at DPR resolution)
            if (!bgCache.current || bgCache.current.w !== w || bgCache.current.h !== h) {
                const offscreen = new OffscreenCanvas(w * dpr, h * dpr);
                const offCtx = offscreen.getContext('2d');
                if (offCtx) {
                    // Match main canvas DPR scaling
                    offCtx.scale(dpr, dpr);

                    // Sky
                    const skyGradient = offCtx.createLinearGradient(0, 0, 0, h * 0.6);
                    skyGradient.addColorStop(0, '#58a7e8');
                    skyGradient.addColorStop(1, '#a3d8f7');
                    offCtx.fillStyle = skyGradient;
                    offCtx.fillRect(0, 0, w, h);

                    // Ground
                    const groundGradient = offCtx.createLinearGradient(0, horizonY, 0, h);
                    groundGradient.addColorStop(0, '#598c3e');
                    groundGradient.addColorStop(1, '#2f5a18');
                    offCtx.fillStyle = groundGradient;
                    offCtx.fillRect(0, horizonY, w, h - horizonY);

                    // Mowing lines
                    offCtx.strokeStyle = 'rgba(255,255,255,0.06)';
                    offCtx.lineWidth = 1;
                    offCtx.beginPath();
                    for (let i = -20; i <= 20; i++) {
                        offCtx.moveTo(centerX + i * 80, h);
                        offCtx.lineTo(centerX + i * 2, horizonY);
                    }
                    offCtx.stroke();

                    // Trees
                    drawTrees(offCtx as unknown as CanvasRenderingContext2D, w, horizonY);

                    bgCache.current = { canvas: offscreen, w, h };
                }
            }

            if (bgCache.current) {
                // Draw cached bg — source is DPR-scaled, dest is in CSS-pixel space (ctx already has dpr transform)
                ctx.drawImage(bgCache.current.canvas, 0, 0, bgCache.current.canvas.width, bgCache.current.canvas.height, -w, -h, w * 3, h * 3);
            }

            // 3. Target (with board shake offset)
            const shake = boardShake.current;
            let shakeX = 0, shakeY = 0;
            if (shake.decay > 0) {
                shakeX = shake.x * shake.decay * Math.sin(shake.decay * 40);
                shakeY = shake.y * shake.decay * Math.cos(shake.decay * 35);
                shake.decay *= 0.88; // Exponential decay
                if (shake.decay < 0.01) shake.decay = 0;
            }
            drawTarget(ctx, targetCenterX + shakeX, targetCenterY + shakeY, controlsRef.current.targetScale);

            // Wind indicator above target
            drawWindIndicator(ctx, targetCenterX + shakeX, targetCenterY + shakeY - 140 * controlsRef.current.targetScale - 30, wind.current);

            // 4. Pinned arrow (after flight completes)
            if (pinnedArrows.current.length > 0) {
                for (const pa of pinnedArrows.current) {
                    drawPinnedArrow(ctx, targetCenterX + shakeX + pa.point.x, targetCenterY + shakeY + pa.point.y, 1.0, FLETCHING_PALETTES[pa.playerIndex % FLETCHING_PALETTES.length]);
                }
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
                drawPinnedArrow(ctx, ax, ay, t, FLETCHING_PALETTES[arrowImpact.current.playerIndex % FLETCHING_PALETTES.length]);
                ctx.restore();

                if (impact.frame >= impact.totalFrames) {
                    impact.active = false;
                    const next = [...pinnedArrows.current, { point: impact.hitPoint, playerIndex: impact.playerIndex }];
                    pinnedArrows.current = next.length > controlsRef.current.maxArrows
                        ? next.slice(next.length - controlsRef.current.maxArrows)
                        : next;
                }
            }

            // 5. Arrow flight animation (projectile physics)
            const flight = arrowFlight.current;
            if (flight.active) {
                // Resolve start/end positions on first frame
                if (flight.elapsed === 0) {
                    flight.startX = centerX;
                    flight.startY = h + 50;
                    flight.endX = targetCenterX + flight.hitPoint.x;
                    flight.endY = targetCenterY + flight.hitPoint.y;

                    const dx = flight.endX - flight.startX;
                    const dy = flight.endY - flight.startY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    flight.arcHeight = dist * controlsRef.current.arcHeightFactor;
                }

                // Slow-mo for last portion of flight
                const tNorm = flight.elapsed / flight.duration;
                const speedMul = tNorm > controlsRef.current.slowMoThreshold ? controlsRef.current.slowMoSpeed : 1.0;
                flight.elapsed += deltaTime * speedMul;
                const t = Math.min(flight.elapsed / flight.duration, 1);

                // ── Projectile position ──
                // Linear interpolation + gravity arc + wind drift
                const gravityArc = -4 * flight.arcHeight * t * (t - 1);
                const windDriftX = flight.windX * controlsRef.current.windDriftXFactor * t * t;
                const windDriftY = flight.windY * controlsRef.current.windDriftYFactor * t * t;

                const ax = flight.startX + (flight.endX - flight.startX) * t + windDriftX;
                const ay = flight.startY + (flight.endY - flight.startY) * t - gravityArc + windDriftY;

                // ── Velocity for rotation ──
                const dt2 = 0.02;
                const t2 = Math.min(t + dt2, 1);
                const gravArc2 = -4 * flight.arcHeight * t2 * (t2 - 1);
                const wdx2 = flight.windX * controlsRef.current.windDriftXFactor * t2 * t2;
                const wdy2 = flight.windY * controlsRef.current.windDriftYFactor * t2 * t2;
                const ax2 = flight.startX + (flight.endX - flight.startX) * t2 + wdx2;
                const ay2 = flight.startY + (flight.endY - flight.startY) * t2 - gravArc2 + wdy2;
                let angle = Math.atan2(ay2 - ay, ax2 - ax);

                if (t > 0.8) {
                    const finalAngle = Math.atan2(flight.endY - ay, flight.endX - ax);
                    const blend = (t - 0.8) / 0.2;
                    angle = angle * (1 - blend * blend) + finalAngle * blend * blend;
                }

                // ── Motion trail ──
                flight.trail.push({ x: ax, y: ay, angle, alpha: 1.0 });
                if (flight.trail.length > 8) flight.trail.shift();
                flight.trail.forEach((tp, i) => {
                    const trailAlpha = (i / flight.trail.length) * 0.25;
                    ctx.save();
                    ctx.globalAlpha = trailAlpha;
                    ctx.translate(tp.x, tp.y);
                    ctx.rotate(tp.angle);
                    ctx.strokeStyle = '#444';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(10, 0); ctx.stroke();
                    ctx.restore();
                });

                // ── Draw flying arrow ──
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(angle);
                const shaftGrad = ctx.createLinearGradient(0, -1.5, 0, 1.5);
                shaftGrad.addColorStop(0, '#3a3a3a');
                shaftGrad.addColorStop(0.5, '#555');
                shaftGrad.addColorStop(1, '#2a2a2a');
                ctx.fillStyle = shaftGrad;
                ctx.fillRect(-28, -1.5, 43, 3);
                const headGrad = ctx.createLinearGradient(15, -4, 15, 4);
                headGrad.addColorStop(0, '#aaa');
                headGrad.addColorStop(0.5, '#ddd');
                headGrad.addColorStop(1, '#888');
                ctx.fillStyle = headGrad;
                ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(14, -4); ctx.lineTo(14, 4); ctx.closePath(); ctx.fill();
                const fletchColor = FLETCHING_PALETTES[flight.playerIndex % FLETCHING_PALETTES.length].grad[0];
                ctx.fillStyle = fletchColor;
                ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(-35, -6); ctx.lineTo(-26, -1); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(-35, 6); ctx.lineTo(-26, 1); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#ddd';
                ctx.beginPath(); ctx.arc(-28, 0, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.restore();

                if (t >= 1) {
                    flight.active = false;
                    flight.trail = [];
                    const impactX = targetCenterX + shakeX + flight.hitPoint.x;
                    const impactY = targetCenterY + shakeY + flight.hitPoint.y;
                    for (let p_idx = 0; p_idx < 10; p_idx++) {
                        const pa = Math.random() * Math.PI * 2;
                        const pv = 1 + Math.random() * 3;
                        flight.particles.push({
                            x: impactX, y: impactY,
                            vx: Math.cos(pa) * pv,
                            vy: Math.sin(pa) * pv - 1,
                            life: 0, maxLife: 15 + Math.random() * 10,
                            r: 1 + Math.random() * 2
                        });
                    }
                    flight.flashFrames = 4;
                    arrowImpact.current = { active: true, frame: 0, totalFrames: 12, hitPoint: flight.hitPoint, playerIndex: flight.playerIndex };
                    boardShake.current = { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 3, decay: 1.0 };
                    // Solo: shorter hold for rapid-fire feel
                    const holdFrames = roomStateRef.current?.mode === 'solo'
                        ? Math.floor(60 * 0.8)
                        : Math.floor(60 * controlsRef.current.holdTime);
                    postShotZoom.current = { active: true, timer: holdFrames, hitPoint: flight.hitPoint };
                    // Now show the score
                    if (pendingScore.current !== null) {
                        lastScore.current = pendingScore.current;
                        scoreFlash.current = 1;
                        pendingScore.current = null;
                    }
                }
            }

            // 5b. Impact particles & flash
            if (flight.particles.length > 0) {
                flight.particles = flight.particles.filter(p => {
                    p.life++; p.x += p.vx; p.y += p.vy; p.vy += 0.15;
                    const alpha = 1 - p.life / p.maxLife;
                    if (alpha <= 0) return false;
                    ctx.save(); ctx.globalAlpha = alpha * 0.6; ctx.fillStyle = '#c8b89a';
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
                    return true;
                });
            }
            if (flight.flashFrames > 0) {
                const fx = targetCenterX + shakeX + flight.hitPoint.x;
                const fy = targetCenterY + shakeY + flight.hitPoint.y;
                ctx.save(); ctx.globalAlpha = flight.flashFrames / 4 * 0.4; ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(fx, fy, 12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
                flight.flashFrames--;
            }

            // 6. Reticle + Aim Timer
            if (isMyTurnRef.current && isAiming.current) {
                const totalFrames = controlsRef.current.timerSeconds * 60;
                aimTimer.current = Math.max(0, aimTimer.current - (1 / totalFrames));
                if (aimTimer.current <= 0 && !shouldAutoFire.current) {
                    shouldAutoFire.current = true;
                }
                const rx = targetCenterX + reticlePos.current.x;
                const ry = targetCenterY + reticlePos.current.y;
                drawReticle(ctx, rx, ry, aimTimer.current);
            }

            ctx.restore(); // Undo zoom

            // 8. HUD & Game Over
            if (roomStateRef.current) {
                // Check for Game Over (solo: time-based, multiplayer: round-based)
                const isGameOver = roomStateRef.current.mode === 'solo'
                    ? roomStateRef.current.timeRemaining <= 0
                    : roomStateRef.current.round > roomStateRef.current.maxRounds;
                if (isGameOver) {
                    gameOverTimer.current += deltaTime;
                    if (gameOverTimer.current > controlsRef.current.gameOverDelay) {
                        drawGameOver(ctx, w, h, roomStateRef.current, socket?.id, gameOverTimer.current - controlsRef.current.gameOverDelay);
                    }
                } else {
                    gameOverTimer.current = 0;
                    drawHUD(ctx, w, h, wind.current, roomStateRef.current, socket?.id, lastScore.current, scoreFlash.current);
                    if (scoreFlash.current > 0) scoreFlash.current = Math.max(0, scoreFlash.current - 0.005);
                    if (shouldAutoFire.current) {
                        shouldAutoFire.current = false; isAiming.current = false;
                        socket?.emit('shoot', { aimPosition: reticlePos.current });
                    }

                    // Tutorial overlay (Round 1 only, before interaction)
                    if (roomStateRef.current.round === 1 && !hasInteracted.current && isMyTurnRef.current && !isAiming.current) {
                        drawTutorial(ctx, w, h);
                    }
                }
            }


            animationFrameId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationFrameId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Input Handlers ──
    const handleStart = (x: number, y: number) => {
        if (!isMyTurn || postShotZoom.current.active || arrowFlight.current.active) return;

        // Explicitly block input if game is over (unless clicking Play Again)
        const isGameOver = roomStateRef.current && (
            roomStateRef.current.mode === 'solo'
                ? roomStateRef.current.timeRemaining <= 0
                : roomStateRef.current.round > roomStateRef.current.maxRounds
        );
        if (isGameOver) {
            // Check collision with Play Again button
            const w = window.innerWidth;
            const h = window.innerHeight;
            const cx = w / 2;
            const cy = h / 2;
            const btnW = 180;
            const btnH = 48;
            const btnY = roomStateRef.current?.mode === 'solo'
                ? cy + Math.min(w, h) * 0.12 + 100
                : cy + 70;

            // Check if click is inside button (simple box check)
            if (x >= cx - btnW / 2 && x <= cx + btnW / 2 &&
                y >= btnY && y <= btnY + btnH) {
                onExit();
            }
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Only allow aiming from the bottom 40% of the screen
        if (y < window.innerHeight * 0.6) return;

        isAiming.current = true;
        hasInteracted.current = true; // Dismiss tutorial
        aimTimer.current = 1.0;
        shouldAutoFire.current = false;

        // Random start position: one of 6 spots around the target edge
        // Note: Reticle position is in CSS pixels relative to target center
        const targetRadius = 100;
        const slotIndex = Math.floor(Math.random() * 6);
        const spawnAngle = (slotIndex / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        reticlePos.current = {
            x: Math.cos(spawnAngle) * targetRadius * (0.6 + Math.random() * 0.4),
            y: Math.sin(spawnAngle) * targetRadius * (0.6 + Math.random() * 0.4)
        };

        // Track raw screen position for delta calculation
        lastInputPos.current = { x, y };
        inputBuffer.current = { x: 0, y: 0 };
        momentum.current = { x: 0, y: 0 };

        lastScore.current = null;
    };

    const handleMove = (x: number, y: number) => {
        if (!isMyTurn || !isAiming.current) return;

        // Use raw screen-space deltas (not world-space) for predictable control
        if (lastInputPos.current) {
            const dx = x - lastInputPos.current.x;
            const dy = y - lastInputPos.current.y;
            inputBuffer.current.x += dx;
            inputBuffer.current.y += dy;
        }

        lastInputPos.current = { x, y };
    };

    const handleEnd = () => {
        if (!isMyTurn || !isAiming.current) return;
        isAiming.current = false;

        // Final shot
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
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, bs + 55, bs * 0.8, 10, 0, 0, Math.PI * 2); ctx.fill();

    // ── Wooden legs (angled, tapered — like an easel/A-frame) ──
    const legTopW = 12;     // Width at top (where leg meets board)
    const legBotW = 10;     // Width at bottom (ground)
    const legH = 70;        // Leg height below board
    const legSplay = 25;    // How far legs splay outward at bottom

    // Left leg (angled outward)
    ctx.save();
    ctx.fillStyle = '#5e3a1a';
    ctx.beginPath();
    ctx.moveTo(-bs * 0.4 - legTopW / 2, bs + 2);             // Top-left
    ctx.lineTo(-bs * 0.4 + legTopW / 2, bs + 2);             // Top-right
    ctx.lineTo(-bs * 0.4 - legSplay + legBotW / 2, bs + legH); // Bottom-right
    ctx.lineTo(-bs * 0.4 - legSplay - legBotW / 2, bs + legH); // Bottom-left
    ctx.closePath();
    ctx.fill();
    // Wood grain highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.8;
    for (let i = 5; i < legH; i += 8) {
        const t = i / legH;
        const cx = -bs * 0.4 - legSplay * t;
        ctx.beginPath(); ctx.moveTo(cx - 4, bs + 2 + i); ctx.lineTo(cx + 4, bs + 2 + i + 2); ctx.stroke();
    }
    // Dark inner edge
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bs * 0.4 + legTopW / 2, bs + 2);
    ctx.lineTo(-bs * 0.4 - legSplay + legBotW / 2, bs + legH);
    ctx.stroke();
    ctx.restore();

    // Right leg (mirrored)
    ctx.save();
    ctx.fillStyle = '#5e3a1a';
    ctx.beginPath();
    ctx.moveTo(bs * 0.4 - legTopW / 2, bs + 2);
    ctx.lineTo(bs * 0.4 + legTopW / 2, bs + 2);
    ctx.lineTo(bs * 0.4 + legSplay + legBotW / 2, bs + legH);
    ctx.lineTo(bs * 0.4 + legSplay - legBotW / 2, bs + legH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.8;
    for (let i = 5; i < legH; i += 8) {
        const t = i / legH;
        const cx = bs * 0.4 + legSplay * t;
        ctx.beginPath(); ctx.moveTo(cx - 4, bs + 2 + i); ctx.lineTo(cx + 4, bs + 2 + i + 2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bs * 0.4 - legTopW / 2, bs + 2);
    ctx.lineTo(bs * 0.4 + legSplay - legBotW / 2, bs + legH);
    ctx.stroke();
    ctx.restore();

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
    // Subtle paper texture (deterministic — no flicker)
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    for (let ty = -bs; ty < bs; ty += 4) {
        for (let tx = -bs; tx < bs; tx += 4) {
            // Simple hash for deterministic noise
            if (((tx * 73 + ty * 137) & 0xff) > 128) ctx.fillRect(tx, ty, 4, 4);
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

// Wind speed + direction indicator (displayed above target)
const drawWindIndicator = (ctx: CanvasRenderingContext2D, x: number, y: number, wind: Point) => {
    const strength = Math.sqrt(wind.x * wind.x + wind.y * wind.y);
    const angle = Math.atan2(wind.y, wind.x);

    ctx.save();
    ctx.translate(x, y);

    // ── Background pill ──
    const pillW = 140;
    const pillH = 32;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
    ctx.fill();

    // ── "WIND:" label ──
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ccc';
    ctx.fillText('WIND:', -pillW / 2 + 12, 1);

    // ── Speed value (yellow, bold) ──
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillStyle = '#FFD600';
    ctx.fillText(strength.toFixed(1), 12, 1);

    // ── Direction arrow in circle ──
    const circleX = pillW / 2 - 18;
    const circleR = 11;

    // Yellow circle outline
    ctx.strokeStyle = '#FFD600';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(circleX, 0, circleR, 0, Math.PI * 2);
    ctx.stroke();

    // Arrow pointing in wind direction
    ctx.save();
    ctx.translate(circleX, 0);
    ctx.rotate(angle);
    ctx.fillStyle = '#FFD600';
    ctx.beginPath();
    // Arrow shaft
    ctx.moveTo(-5, 0);
    ctx.lineTo(4, 0);
    // Arrowhead
    ctx.moveTo(3, -3.5);
    ctx.lineTo(7, 0);
    ctx.lineTo(3, 3.5);
    ctx.closePath();
    ctx.fill();
    // Arrow shaft line
    ctx.strokeStyle = '#FFD600';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(4, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
};

const drawPinnedArrow = (ctx: CanvasRenderingContext2D, x: number, y: number, animProgress: number = 1.0, colors: FletchingColors = FLETCHING_PALETTES[0]) => {
    ctx.save();
    ctx.translate(x, y);

    // Deterministic tilt from hit position
    const seed = Math.abs(x * 73.13 + y * 91.17) % 360;
    const tiltAngle = ((seed / 360) * 0.24 - 0.12);
    ctx.rotate(tiltAngle);

    const shaftLen = 28;
    const shaftR1 = 1.3;
    const shaftR2 = 1.3;

    // ── 1. Shadow — layered ellipses (no blur filter!) ──
    const shadowOx = 4;
    const shadowOy = 5;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.globalAlpha = animProgress;
    ctx.beginPath(); ctx.ellipse(shadowOx, shadowOy - shaftLen / 2, 10, shaftLen * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath(); ctx.ellipse(shadowOx, shadowOy - shaftLen / 2, 6, shaftLen * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Pushed-out rim
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();

    // ── 2. Broadhead — flat colors (no per-frame gradients) ──
    const ferruleR = 2.2;
    ctx.fillStyle = '#999';
    ctx.beginPath(); ctx.arc(0, 0, ferruleR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 3 Blade edges (flat fills)
    const bladeLen = 6;
    const bladeW = 1.8;
    ctx.fillStyle = '#ccc';
    for (let b = 0; b < 3; b++) {
        const bAngle = (b * 120 - 60) * (Math.PI / 180);
        const bTipX = Math.cos(bAngle) * bladeLen;
        const bTipY = Math.sin(bAngle) * bladeLen;
        const bPerpX = -Math.sin(bAngle) * bladeW * 0.5;
        const bPerpY = Math.cos(bAngle) * bladeW * 0.5;
        ctx.beginPath();
        ctx.moveTo(bPerpX * 0.6, bPerpY * 0.6);
        ctx.lineTo(bTipX, bTipY);
        ctx.lineTo(-bPerpX * 0.6, -bPerpY * 0.6);
        ctx.closePath();
        ctx.fill();
    }

    // Ferrule highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(-0.3, -0.5, 0.8, 0, Math.PI * 2); ctx.fill();

    // ── 3. Shaft — single flat fill (gradient invisible at 3px width) ──
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(-shaftR1, 0);
    ctx.lineTo(-shaftR2, -shaftLen);
    ctx.lineTo(shaftR2, -shaftLen);
    ctx.lineTo(shaftR1, 0);
    ctx.closePath();
    ctx.fill();

    // ── 4. Pin wrap ──
    const wrapY = -shaftLen + 1;
    ctx.fillStyle = '#22aa22';
    ctx.fillRect(-shaftR2 - 0.3, wrapY, (shaftR2 + 0.3) * 2, 3);

    // ── 5. Fletching — two vanes ──
    const vaneBaseY = -shaftLen;
    const fLen = 18;
    const fSpread = 14;

    for (const d of [-1, 1]) {
        const attachX = d * 1;
        const attachY = vaneBaseY + 2;
        const tipX = d * fSpread;
        const tipY = vaneBaseY - fLen;
        const innerX = 0;
        const innerY = vaneBaseY - fLen * 0.7;

        // Main vane — use base fletching color (flat)
        ctx.fillStyle = colors.grad[0];
        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.quadraticCurveTo(d * fSpread * 0.5, vaneBaseY - fLen * 0.4, tipX, tipY);
        ctx.lineTo(innerX, innerY);
        ctx.closePath();
        ctx.fill();

        // Inner face
        ctx.fillStyle = colors.inner;
        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.lineTo(innerX, innerY);
        ctx.lineTo(innerX + d * 2, innerY + 3);
        ctx.closePath();
        ctx.fill();

        // Outline
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(attachX, attachY);
        ctx.quadraticCurveTo(d * fSpread * 0.5, vaneBaseY - fLen * 0.4, tipX, tipY);
        ctx.lineTo(innerX, innerY);
        ctx.closePath();
        ctx.stroke();
    }

    // ── 6. Nock — flat ──
    const nockY = vaneBaseY - fLen * 0.7 - 2;
    ctx.fillStyle = '#ddd';
    ctx.beginPath(); ctx.arc(0, nockY, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
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
    room: Room | null,
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

        // ── Center Info ──
        ctx.textAlign = 'center';

        if (room.mode === 'solo') {
            // Solo: show countdown timer
            const timeLeft = Math.ceil(room.timeRemaining);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px Arial';
            ctx.fillText('TIME', w / 2, 24);

            if (timeLeft <= 5) {
                ctx.fillStyle = '#ef4444'; // Red
            } else if (timeLeft <= 10) {
                ctx.fillStyle = '#fbbf24'; // Yellow
            } else {
                ctx.fillStyle = 'white';
            }
            ctx.font = 'bold 28px Arial';
            ctx.fillText(`${timeLeft}s`, w / 2, 52);

            ctx.fillStyle = '#64748b';
            ctx.font = '11px Arial';
            ctx.fillText(`Shot ${room.round}`, w / 2, 66);
        } else {
            // Multiplayer: show round
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px Arial';
            ctx.fillText('ROUND', w / 2, 24);

            if (room.round === room.maxRounds) {
                ctx.fillStyle = '#fbbf24';
                ctx.font = 'bold 20px Arial';
                ctx.fillText('FINAL ROUND', w / 2, 48);
            } else {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 24px Arial';
                ctx.fillText(`${room.round} / ${room.maxRounds}`, w / 2, 50);
            }

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
        ctx.globalAlpha = Math.min(scoreFlash * 1.5, 1); // Brighter for longer
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const fontSize = 72 + (1 - scoreFlash) * 30;
        const scoreText = lastScore > 0 ? `+${lastScore}` : 'MISS';
        const color = lastScore >= 8 ? '#fbbf24' : lastScore >= 5 ? '#34d399' : lastScore > 0 ? '#94a3b8' : '#ef4444';
        const yPos = h * 0.42;

        // Drop shadow
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 3;

        // Text stroke (outline) for contrast
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 5;
        ctx.strokeText(scoreText, w / 2, yPos);

        // Fill
        ctx.fillStyle = color;
        ctx.fillText(scoreText, w / 2, yPos);

        // Reset shadow for subtitle
        ctx.shadowColor = 'transparent';

        if (lastScore === 10) {
            ctx.font = 'bold 28px Arial';
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 3;
            ctx.strokeText('BULLSEYE!', w / 2, yPos + 50);
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('BULLSEYE!', w / 2, yPos + 50);
        } else if (lastScore === 0) {
            ctx.font = 'bold 22px Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillText('Better luck next time', w / 2, yPos + 45);
        }
        ctx.restore();
    }

    // ── Drag Zone Indicator ──
    const dragZoneY = h * 0.6;
    const isActive = room?.currentTurn === myId;

    // Gradient overlay on drag zone
    if (isActive) {
        const zoneGrad = ctx.createLinearGradient(0, dragZoneY, 0, h);
        zoneGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        zoneGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.06)');
        zoneGrad.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
        ctx.fillStyle = zoneGrad;
        ctx.fillRect(0, dragZoneY, w, h - dragZoneY);
    }

    // Divider line
    ctx.save();
    ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.30)' : 'rgba(255, 255, 255, 0.10)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(40, dragZoneY);
    ctx.lineTo(w - 40, dragZoneY);
    ctx.stroke();
    ctx.restore();

    // Grip dots — centered row at divider
    if (isActive) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        const dotCount = 5;
        const dotSpacing = 8;
        const dotsStartX = w / 2 - ((dotCount - 1) * dotSpacing) / 2;
        for (let i = 0; i < dotCount; i++) {
            ctx.beginPath();
            ctx.arc(dotsStartX + i * dotSpacing, dragZoneY, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Bottom instruction
    ctx.fillStyle = isActive ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(isActive ? 'Tap & drag below to aim · Release to shoot' : 'Waiting for opponent...', w / 2, h - 20);
};

const drawTutorial = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cx = w / 2;
    const cy = h * 0.75; // Center of drag zone

    // Animate hand moving down
    const time = performance.now();
    const slide = (Math.sin(time * 0.005) + 1) / 2; // 0 to 1
    const yOffset = slide * 40;

    ctx.save();
    ctx.translate(cx, cy + yOffset);

    // Hand icon (simple shape)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;

    // Finger
    ctx.beginPath();
    ctx.roundRect(-10, 0, 20, 30, 10);
    ctx.fill();
    // Circle indicator
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 20 + slide * 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Text
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText("TAP & DRAG TO AIM", cx, cy - 40);
};

const drawGameOver = (ctx: CanvasRenderingContext2D, w: number, h: number, room: Room, myId: string | undefined, animTime: number) => {
    // ── Easing functions ──
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const easeOutBack = (t: number) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    // ── Animation phases ──
    const fadeIn = Math.min(1, animTime / 600);
    const contentReveal = Math.min(1, Math.max(0, animTime - 200) / 500);
    const statsReveal = Math.min(1, Math.max(0, animTime - 500) / 400);
    const buttonReveal = Math.min(1, Math.max(0, animTime - 800) / 400);
    const ringProgress = easeOutCubic(Math.min(1, Math.max(0, animTime - 300) / 1200));

    const me = room.players.find(p => p.id === myId);
    const myScore = me?.score || 0;
    const cx = w / 2;
    const cy = h / 2;

    // ── Background overlay with radial gradient ──
    ctx.save();
    ctx.globalAlpha = fadeIn;
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    bgGrad.addColorStop(0, 'rgba(10, 10, 20, 0.92)');
    bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle noise texture
    ctx.globalAlpha = fadeIn * 0.03;
    for (let i = 0; i < 200; i++) {
        const nx = (Math.sin(i * 777.7) * 0.5 + 0.5) * w;
        const ny = (Math.cos(i * 333.3) * 0.5 + 0.5) * h;
        ctx.fillStyle = '#fff';
        ctx.fillRect(nx, ny, 1, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';

    if (room.mode === 'solo') {
        // ═══════════════════════════════════════
        // SOLO — Accuracy Ring + Stats
        // ═══════════════════════════════════════
        const shotsCount = Math.max(1, room.round - 1);
        const avgPerShot = myScore / shotsCount;
        const accuracyPct = Math.min(1, avgPerShot / 10);

        let ratingText: string;
        let ratingColor: string;
        let ratingGlow: string;
        let subtitleText: string;

        if (avgPerShot >= 9.5) {
            ratingText = 'PERFECT';
            ratingColor = '#fbbf24';
            ratingGlow = 'rgba(251, 191, 36, 0.4)';
            subtitleText = 'Legendary accuracy';
        } else if (avgPerShot >= 8) {
            ratingText = 'EXCELLENT';
            ratingColor = '#34d399';
            ratingGlow = 'rgba(52, 211, 153, 0.3)';
            subtitleText = 'Sharp shooting';
        } else if (avgPerShot >= 6) {
            ratingText = 'GREAT';
            ratingColor = '#60a5fa';
            ratingGlow = 'rgba(96, 165, 250, 0.3)';
            subtitleText = 'Well done';
        } else if (avgPerShot >= 4) {
            ratingText = 'GOOD';
            ratingColor = '#a78bfa';
            ratingGlow = 'rgba(167, 139, 250, 0.3)';
            subtitleText = 'Solid effort';
        } else if (avgPerShot >= 2) {
            ratingText = 'OK';
            ratingColor = '#94a3b8';
            ratingGlow = 'rgba(148, 163, 184, 0.2)';
            subtitleText = 'Keep practicing';
        } else {
            ratingText = 'ROUGH';
            ratingColor = '#f87171';
            ratingGlow = 'rgba(248, 113, 113, 0.2)';
            subtitleText = 'Try again';
        }

        // ── Accuracy ring ──
        const ringRadius = Math.min(w, h) * 0.12;
        const ringCenterY = cy - 55;
        const ringWidth = 6;

        // Ring background track
        ctx.globalAlpha = fadeIn * 0.15;
        ctx.beginPath();
        ctx.arc(cx, ringCenterY, ringRadius, -Math.PI / 2, Math.PI * 1.5);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = ringWidth;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Ring progress arc
        const arcEnd = -Math.PI / 2 + Math.PI * 2 * accuracyPct * ringProgress;
        ctx.globalAlpha = fadeIn;
        ctx.beginPath();
        ctx.arc(cx, ringCenterY, ringRadius, -Math.PI / 2, arcEnd);
        ctx.strokeStyle = ratingColor;
        ctx.lineWidth = ringWidth;
        ctx.lineCap = 'round';
        ctx.shadowColor = ratingGlow;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Score inside ring
        const scoreScale = easeOutBack(contentReveal);
        ctx.globalAlpha = fadeIn * contentReveal;
        ctx.save();
        ctx.translate(cx, ringCenterY);
        ctx.scale(scoreScale, scoreScale);
        ctx.font = 'bold 42px Georgia, serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${myScore}`, 0, 12);
        ctx.font = '12px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('POINTS', 0, 30);
        ctx.restore();

        // ── Rating text above ring ──
        const titleSlide = easeOutBack(contentReveal);
        const titleY = (ringCenterY - ringRadius - 40) - (1 - titleSlide) * 30;
        ctx.globalAlpha = fadeIn * contentReveal;
        ctx.font = 'bold 13px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('T I M E \' S   U P', cx, titleY - 28);

        ctx.font = 'bold 38px Georgia, serif';
        ctx.fillStyle = ratingColor;
        ctx.shadowColor = ratingGlow;
        ctx.shadowBlur = 24 * fadeIn;
        ctx.fillText(ratingText, cx, titleY);
        ctx.shadowBlur = 0;

        // Subtitle
        ctx.font = 'italic 16px Georgia, serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(subtitleText, cx, titleY + 22);

        // ── Stats row ──
        const statsY = ringCenterY + ringRadius + 40;
        const statSpacing = Math.min(120, w * 0.22);
        const statsAlpha = easeOutCubic(statsReveal);
        ctx.globalAlpha = fadeIn * statsAlpha;

        // Stat: Shots
        const statSlide1 = easeOutBack(Math.min(1, statsReveal * 1.5));
        const s1y = statsY + (1 - statSlide1) * 15;
        ctx.font = '11px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('SHOTS', cx - statSpacing, s1y);
        ctx.font = 'bold 24px Georgia, serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${shotsCount}`, cx - statSpacing, s1y + 26);

        // Stat: Avg
        const statSlide2 = easeOutBack(Math.min(1, statsReveal * 1.3));
        const s2y = statsY + (1 - statSlide2) * 15;
        ctx.font = '11px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('AVG / SHOT', cx, s2y);
        ctx.font = 'bold 24px Georgia, serif';
        ctx.fillStyle = ratingColor;
        ctx.fillText(avgPerShot.toFixed(1), cx, s2y + 26);

        // Stat: Accuracy %
        const statSlide3 = easeOutBack(Math.min(1, statsReveal * 1.1));
        const s3y = statsY + (1 - statSlide3) * 15;
        ctx.font = '11px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('ACCURACY', cx + statSpacing, s3y);
        ctx.font = 'bold 24px Georgia, serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${Math.round(accuracyPct * ringProgress * 100)}%`, cx + statSpacing, s3y + 26);

        // Dividers between stats
        ctx.globalAlpha = fadeIn * statsAlpha * 0.15;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - statSpacing / 2, statsY - 5, 1, 40);
        ctx.fillRect(cx + statSpacing / 2, statsY - 5, 1, 40);

        // ── Sparkle particles on good scores ──
        if (avgPerShot >= 6 && animTime > 500) {
            const sparkleTime = animTime * 0.001;
            for (let i = 0; i < 8; i++) {
                const angle = sparkleTime * 0.5 + i * Math.PI / 4;
                const dist = ringRadius + 15 + Math.sin(sparkleTime * 2 + i) * 8;
                const sx = cx + Math.cos(angle) * dist;
                const sy = ringCenterY + Math.sin(angle) * dist;
                const size = 1.5 + Math.sin(sparkleTime * 3 + i * 2) * 0.8;
                ctx.fillStyle = ratingColor;
                ctx.globalAlpha = fadeIn * (0.3 + Math.sin(sparkleTime * 4 + i) * 0.3);
                ctx.beginPath();
                ctx.arc(sx, sy, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

    } else {
        // ═══════════════════════════════════════
        // MULTIPLAYER GAME OVER
        // ═══════════════════════════════════════
        const opponent = room.players.find(p => p.id !== myId);
        const oppScore = opponent?.score || 0;

        let resultText: string;
        let resultColor: string;
        let resultGlow: string;

        if (myScore > oppScore) {
            resultText = 'VICTORY';
            resultColor = '#fbbf24';
            resultGlow = 'rgba(251, 191, 36, 0.4)';
        } else if (myScore < oppScore) {
            resultText = 'DEFEAT';
            resultColor = '#94a3b8';
            resultGlow = 'rgba(148, 163, 184, 0.2)';
        } else {
            resultText = 'DRAW';
            resultColor = '#e2e8f0';
            resultGlow = 'rgba(226, 232, 240, 0.2)';
        }

        // Title
        const titleSlide = easeOutBack(contentReveal);
        const titleY = (cy - 100) - (1 - titleSlide) * 40;
        ctx.globalAlpha = fadeIn * contentReveal;
        ctx.font = 'bold 13px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('G A M E   O V E R', cx, titleY - 24);

        // Result — zooms in
        const resultScale = easeOutBack(contentReveal);
        ctx.save();
        ctx.translate(cx, titleY + 20);
        ctx.scale(resultScale, resultScale);
        ctx.font = 'bold 52px Georgia, serif';
        ctx.fillStyle = resultColor;
        ctx.shadowColor = resultGlow;
        ctx.shadowBlur = 28 * fadeIn;
        ctx.fillText(resultText, 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();

        // Score comparison
        const scoreY = cy + 20 + (1 - easeOutCubic(statsReveal)) * 20;
        ctx.globalAlpha = fadeIn * easeOutCubic(statsReveal);

        // My score (left)
        ctx.textAlign = 'right';
        ctx.font = 'bold 48px Georgia, serif';
        ctx.fillStyle = myScore >= oppScore ? resultColor : 'rgba(255,255,255,0.6)';
        ctx.fillText(`${myScore}`, cx - 24, scoreY);

        // Divider
        ctx.textAlign = 'center';
        ctx.font = '24px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillText('—', cx, scoreY - 4);

        // Opponent score (right)
        ctx.textAlign = 'left';
        ctx.font = 'bold 48px Georgia, serif';
        ctx.fillStyle = oppScore > myScore ? '#f87171' : 'rgba(255,255,255,0.6)';
        ctx.fillText(`${oppScore}`, cx + 24, scoreY);

        // Labels
        ctx.textAlign = 'center';
        ctx.font = '12px Helvetica, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText('YOU', cx - 50, scoreY + 22);
        ctx.fillText('OPP', cx + 50, scoreY + 22);
    }

    // ── Play Again button ──
    if (animTime > 800) {
        const btnAlpha = easeOutCubic(buttonReveal);
        ctx.globalAlpha = btnAlpha;

        const btnW = 180;
        const btnH = 48;
        const btnY = room.mode === 'solo'
            ? cy + Math.min(w, h) * 0.12 + 100
            : cy + 70;

        ctx.shadowColor = 'rgba(255, 255, 255, 0.15)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(cx - btnW / 2, btnY, btnW, btnH, btnH / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#0a0a14';
        ctx.textAlign = 'center';
        ctx.font = 'bold 14px Helvetica, sans-serif';
        ctx.fillText('P L A Y   A G A I N', cx, btnY + btnH / 2 + 5);
    }

    ctx.restore();
};

export default GameCanvas;
