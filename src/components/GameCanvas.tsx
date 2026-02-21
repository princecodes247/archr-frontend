import { useRef, useEffect } from 'react';
import { useControls, folder } from 'leva';
import { useSocketStore } from '../stores/useSocketStore';
import type { Room, Point } from '../types';
import { playAim, playRelease, playFlight, playImpact, playScorePop, playMatchEnd } from '../sounds/SoundManager';

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

const GameCanvas: React.FC<GameCanvasProps> = ({ onExit: _onExit }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { socket, room, playerId } = useSocketStore();
    // Solo: always your turn while time remains. Multiplayer: check currentTurn.
    const isSoloActive = room?.mode === 'solo' && (room?.timeRemaining ?? 0) > 0;
    const isMyTurn = isSoloActive || room?.currentTurn === playerId;

    // ── Leva GUI Controls ──
    const controls = useControls({
        'Aiming Feel': folder({
            smoothing: { value: 0.35, min: 0.05, max: 1.0, step: 0.05, label: 'Smoothing' },
            sensitivity: { value: 1.0, min: 0.2, max: 3.0, step: 0.1, label: 'Sensitivity' },
        }),
        'Aiming': folder({
            timerSeconds: { value: 5.0, min: 1.0, max: 15.0, step: 0.5, label: 'Timer (s)' },
            aimZoom: { value: 2.0, min: 1.0, max: 4.0, step: 0.1, label: 'Aim Zoom' },
        }),
        'Result': folder({
            resultZoom: { value: 3.0, min: 1.0, max: 6.0, step: 0.1, label: 'Result Zoom' },
            holdTime: { value: 2.5, min: 0.5, max: 5.0, step: 0.1, label: 'Hold Duration (s)' },
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
            useComplexShadow: { value: true, label: 'Complex Shadow' },
        })
    }, { hidden: !import.meta.env.DEV });
    // Store controls in a ref so the render loop always reads the latest
    // without needing controls in any useEffect dependency array.
    const controlsRef = useRef(controls);
    controlsRef.current = controls;

    // Game State Refs (mutable, used in animation loop)
    const reticlePos = useRef<Point>({ x: 0, y: 0 });
    const inputTarget = useRef<Point>({ x: 0, y: 0 });  // Raw accumulated input position
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
            const pIdx = roomStateRef.current?.players.findIndex(p => p.userId === data.player) ?? 0;

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
            playFlight(controlsRef.current.flightDuration);

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

            // ── Reticle Update (smooth follow) ──
            if (isMyTurnRef.current && isAiming.current) {
                const s = controlsRef.current.smoothing;
                const pos = reticlePos.current;
                const target = inputTarget.current;

                // Lerp toward input target for fluid motion
                pos.x += (target.x - pos.x) * s;
                pos.y += (target.y - pos.y) * s;

                // Clamp to target area
                const maxR = 160;
                const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
                if (dist > maxR) {
                    pos.x = (pos.x / dist) * maxR;
                    pos.y = (pos.y / dist) * maxR;
                }
            } else if (!isMyTurnRef.current) {
                reticlePos.current = { x: 0, y: 0 };
                inputTarget.current = { x: 0, y: 0 };
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
                    drawPinnedArrow({
                        ctx,
                        x: targetCenterX + shakeX + pa.point.x,
                        y: targetCenterY + shakeY + pa.point.y,
                        animProgress: 1.0,
                        colors: FLETCHING_PALETTES[pa.playerIndex % FLETCHING_PALETTES.length],
                        useComplexShadow: controlsRef.current.useComplexShadow
                    });
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
                drawPinnedArrow({
                    ctx,
                    x: ax,
                    y: ay,
                    animProgress: t,
                    colors: FLETCHING_PALETTES[arrowImpact.current.playerIndex % FLETCHING_PALETTES.length],
                    useComplexShadow: controlsRef.current.useComplexShadow
                });
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
                        playImpact(pendingScore.current);
                        playScorePop(pendingScore.current);
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
                    if (gameOverTimer.current === 0) playMatchEnd();
                    gameOverTimer.current += deltaTime;
                    // Game over screen is now rendered by React (GameOver component)
                    // Just darken the canvas slightly
                    if (gameOverTimer.current > controlsRef.current.gameOverDelay) {
                        ctx.fillStyle = 'rgba(6, 14, 8, 0.7)';
                        ctx.fillRect(0, 0, w, h);
                    }
                } else {
                    gameOverTimer.current = 0;
                    drawHUD(ctx, w, h, wind.current, roomStateRef.current, playerId, lastScore.current, scoreFlash.current);
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
        // Check for game-over Play Again button FIRST (before turn guard)
        const isGameOver = roomStateRef.current && (
            roomStateRef.current.mode === 'solo'
                ? roomStateRef.current.timeRemaining <= 0
                : roomStateRef.current.round > roomStateRef.current.maxRounds
        );
        if (isGameOver) return;

        if (!isMyTurn || postShotZoom.current.active || arrowFlight.current.active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Only allow aiming from the bottom 40% of the screen
        if (y < window.innerHeight * 0.6) return;

        isAiming.current = true;
        hasInteracted.current = true;
        playAim();
        aimTimer.current = 1.0;
        shouldAutoFire.current = false;

        // Random start position around the target edge
        const targetRadius = 100;
        const slotIndex = Math.floor(Math.random() * 6);
        const spawnAngle = (slotIndex / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const startPos = {
            x: Math.cos(spawnAngle) * targetRadius * (0.6 + Math.random() * 0.4),
            y: Math.sin(spawnAngle) * targetRadius * (0.6 + Math.random() * 0.4)
        };
        reticlePos.current = { ...startPos };
        inputTarget.current = { ...startPos };

        lastInputPos.current = { x, y };
        lastScore.current = null;
    };

    const handleMove = (x: number, y: number) => {
        if (!isMyTurn || !isAiming.current) return;

        if (lastInputPos.current) {
            const dx = x - lastInputPos.current.x;
            const dy = y - lastInputPos.current.y;
            const sens = controlsRef.current.sensitivity;
            inputTarget.current.x += dx * sens;
            inputTarget.current.y += dy * sens;
        }

        lastInputPos.current = { x, y };
    };

    const handleEnd = () => {
        if (!isMyTurn || !isAiming.current) return;
        isAiming.current = false;
        playRelease();
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

const drawPinnedArrow = ({
    ctx,
    x,
    y,
    animProgress = 1.0,
    colors = FLETCHING_PALETTES[0],
    useComplexShadow = false,
}: {
    ctx: CanvasRenderingContext2D;
    x: number;
    y: number;
    animProgress?: number;
    colors?: FletchingColors;
    useComplexShadow?: boolean;
}) => {
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

    if (useComplexShadow) {
        ctx.globalAlpha = 0.18 * animProgress;
        ctx.fillStyle = '#000';
        ctx.filter = 'blur(3px)';
        ctx.beginPath();
        // Broadhead blades (bottom)
        ctx.moveTo(shadowOx - 5, shadowOy + 3);
        ctx.lineTo(shadowOx, shadowOy - 2);
        ctx.lineTo(shadowOx + 5, shadowOy + 3);
        // Shaft right edge (going up)
        ctx.lineTo(shadowOx + shaftR1, shadowOy);
        ctx.lineTo(shadowOx + shaftR2, shadowOy - shaftLen);
        // Right fletching wing
        ctx.lineTo(shadowOx + 14, shadowOy - shaftLen - 18);
        ctx.lineTo(shadowOx + 0, shadowOy - shaftLen - 18 * 0.7);
        // Left fletching wing
        ctx.lineTo(shadowOx - 14, shadowOy - shaftLen - 18);
        ctx.lineTo(shadowOx - shaftR2, shadowOy - shaftLen);
        // Shaft left edge (going back down)
        ctx.lineTo(shadowOx - shaftR1, shadowOy);
        ctx.closePath();
        ctx.fill();
        ctx.filter = 'none';
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.globalAlpha = animProgress;
        ctx.beginPath(); ctx.ellipse(shadowOx, shadowOy - shaftLen / 2, 10, shaftLen * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.beginPath(); ctx.ellipse(shadowOx, shadowOy - shaftLen / 2, 6, shaftLen * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
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
    _windVal: Point,
    room: Room | null,
    myId: string | undefined,
    lastScore: number | null,
    scoreFlash: number
) => {
    // ── Score Flash (center of screen) ──
    if (lastScore !== null && scoreFlash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(scoreFlash * 1.5, 1);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const fontSize = 72 + (1 - scoreFlash) * 30;
        const scoreText = lastScore > 0 ? `+${lastScore}` : 'MISS';
        const color = lastScore >= 8 ? '#c9a84c' : lastScore >= 5 ? '#6ee7b7' : lastScore > 0 ? '#94a3b8' : '#f87171';
        const glowColor = lastScore >= 8 ? 'rgba(201, 168, 76, 0.4)' : lastScore >= 5 ? 'rgba(110, 231, 183, 0.3)' : lastScore > 0 ? 'rgba(148, 163, 184, 0.2)' : 'rgba(248, 113, 113, 0.3)';
        const yPos = h * 0.42;

        // Glow
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 24;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Text stroke (outline) for contrast
        ctx.font = `900 ${fontSize}px 'Playfair Display', Georgia, serif`;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 4;
        ctx.strokeText(scoreText, w / 2, yPos);

        // Fill
        ctx.fillStyle = color;
        ctx.fillText(scoreText, w / 2, yPos);

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        if (lastScore === 10) {
            ctx.font = `700 24px 'DM Sans', system-ui, sans-serif`;
            ctx.letterSpacing = '0.15em';
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 3;
            ctx.strokeText('B U L L S E Y E', w / 2, yPos + 50);
            ctx.fillStyle = '#c9a84c';
            ctx.fillText('B U L L S E Y E', w / 2, yPos + 50);
            ctx.letterSpacing = '0px';
        } else if (lastScore === 0) {
            ctx.font = `500 18px 'DM Sans', system-ui, sans-serif`;
            ctx.fillStyle = 'rgba(240, 236, 228, 0.45)';
            // ctx.fillText('Better luck next time', w / 2, yPos + 45);
        }
        ctx.restore();
    }

    // ── Drag Zone Indicator ──
    const dragZoneY = h * 0.6;
    const isActive = room?.currentTurn === myId;

    // Gradient overlay on drag zone
    if (isActive) {
        const zoneGrad = ctx.createLinearGradient(0, dragZoneY, 0, h);
        zoneGrad.addColorStop(0, 'rgba(201, 168, 76, 0)');
        zoneGrad.addColorStop(0.3, 'rgba(201, 168, 76, 0.02)');
        zoneGrad.addColorStop(1, 'rgba(201, 168, 76, 0.06)');
        ctx.fillStyle = zoneGrad;
        ctx.fillRect(0, dragZoneY, w, h - dragZoneY);
    }

    // Divider line
    ctx.save();
    ctx.strokeStyle = isActive ? 'rgba(201, 168, 76, 0.2)' : 'rgba(240, 236, 228, 0.08)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, dragZoneY);
    ctx.lineTo(w - 40, dragZoneY);
    ctx.stroke();
    ctx.restore();

    // Grip dots
    if (isActive) {
        ctx.fillStyle = 'rgba(201, 168, 76, 0.3)';
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
    ctx.fillStyle = isActive ? 'rgba(240, 236, 228, 0.25)' : 'rgba(240, 236, 228, 0.12)';
    ctx.font = `500 12px 'DM Sans', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(isActive ? 'Tap & drag below to aim · Release to shoot' : 'Waiting for opponent…', w / 2, h - 20);
};

const drawTutorial = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cx = w / 2;
    const cy = h * 0.75;

    const time = performance.now();
    const slide = (Math.sin(time * 0.005) + 1) / 2;
    const yOffset = slide * 40;

    ctx.save();
    ctx.translate(cx, cy + yOffset);

    // Finger with gold tint
    ctx.fillStyle = 'rgba(240, 236, 228, 0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-10, 0, 20, 30, 10);
    ctx.fill();

    // Ring indicator with gold
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 20 + slide * 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Text
    ctx.save();
    ctx.font = `600 16px 'DM Sans', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(240, 236, 228, 0.8)';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText('TAP & DRAG TO AIM', cx, cy - 40);
    ctx.restore();
};

export default GameCanvas;
