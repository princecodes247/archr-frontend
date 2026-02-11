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

const GameCanvas: React.FC<GameCanvasProps> = ({ socket, isMyTurn }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Game State Refs (for animation loop)
    const reticlePos = useRef<Point>({ x: 0, y: 0 }); // Relative to center (0,0)
    const controlPos = useRef<Point>({ x: 0, y: 0 }); // User's "finger" position relative to center
    const wind = useRef<Point>({ x: 0, y: 0 });
    const isAiming = useRef(false);

    // React State for UI overlays (if needed, but canvas handles most)
    const [lastShotPath, setLastShotPath] = useState<Point[] | null>(null);

    useEffect(() => {
        if (!socket) return;

        socket.on('gameState', (room: any) => {
            if (room.wind) {
                wind.current = room.wind;
            }
        });

        socket.on('shotResult', (data: { path: Point[], score: number }) => {
            console.log('Shot Result:', data);
            // Visual feedback of where it hit.
            // Since path is just the hit point now, we can show a marker there.
            setLastShotPath(data.path);
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
            // Resize handling
            if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }

            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h * 0.55 + 80; // Target Center Y (aligned with drawTarget)

            // Physics Update (Drift & Sway)
            if (isMyTurn && isAiming.current) {
                const time = Date.now() / 1000;

                // 1. Wind Drift (Continuous push)
                // We add wind to the reticle position frame by frame? 
                // No, wind suggests a velocity.
                // Let's say reticle velocity = (Control - Reticle) * stiffness + Wind

                // Simple approach: Reticle follows Control with lerp, but Wind is added as an offset continuously?
                // Or Wind pushes the Control point away?
                // Let's do: Reticle = Control + Sway + Cumulative Wind?
                // "It slowly drifts". Implicitly means position changes over time if not corrected.

                // Let's treat reticlePos as the actual aim.
                // It moves towards controlPos.
                // But it also gets pushed by wind.

                const stiffness = 0.05; // Inertia
                const windForce = 0.5;

                // Move towards control
                reticlePos.current.x += (controlPos.current.x - reticlePos.current.x) * stiffness;
                reticlePos.current.y += (controlPos.current.y - reticlePos.current.y) * stiffness;

                // Apply Wind Drift
                reticlePos.current.x += wind.current.x * windForce;
                reticlePos.current.y += wind.current.y * windForce;

                // Apply Hand Sway (High frequency, low amplitude noise)
                const swayX = Math.sin(time * 2) * 0.5 + Math.cos(time * 5) * 0.2;
                const swayY = Math.cos(time * 3) * 0.5 + Math.sin(time * 4) * 0.2;

                reticlePos.current.x += swayX;
                reticlePos.current.y += swayY;

                // Update Control Pos to "follow" the drift slightly? 
                // No, control pos is where the user's finger IS. 
                // If user holds still, reticle drifts away.
                // User must constantly adjust controlPos to fight wind.
                // Effectively, user moves mouse opposite to wind.
            } else {
                // Reset to center when not aiming
                if (!isMyTurn) {
                    reticlePos.current = { x: 0, y: 0 };
                    controlPos.current = { x: 0, y: 0 };
                }
            }


            // Drawing
            // 1. Sky & Atmosphere
            const skyGradient = ctx.createLinearGradient(0, 0, 0, h * 0.6);
            skyGradient.addColorStop(0, '#58a7e8');
            skyGradient.addColorStop(1, '#a3d8f7');
            ctx.fillStyle = skyGradient; ctx.fillRect(0, 0, w, h);

            // 2. Ground
            const horizonY = h * 0.55;
            const groundGradient = ctx.createLinearGradient(0, horizonY, 0, h);
            groundGradient.addColorStop(0, '#598c3e');
            groundGradient.addColorStop(1, '#2f5a18');
            ctx.fillStyle = groundGradient; ctx.fillRect(0, horizonY, w, h - horizonY);

            // Trees
            drawTrees(ctx, w, horizonY);

            // 3. Target
            const targetX = cx;
            const targetY = cy;
            drawTarget(ctx, targetX, targetY, 0.6);

            // 4. Hit Result (Last Shot)
            if (lastShotPath && lastShotPath.length > 0) {
                const hit = lastShotPath[0]; // Currently just one point
                ctx.save();
                ctx.translate(targetX + hit.x, targetY + hit.y);
                ctx.fillStyle = '#5c4033';
                ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); // Hole
                // Draw Arrow stuck
                ctx.rotate(Math.PI / 4); // Random angle?
                ctx.fillRect(-2, -20, 4, 40);
                ctx.restore();
            }

            // 5. Reticle (Only when aiming)
            if (isMyTurn && isAiming.current) {
                const rx = cx + reticlePos.current.x;
                const ry = cy + reticlePos.current.y;

                drawReticle(ctx, rx, ry);

                // Debug/Visual line to finger?
                // ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(cx + controlPos.current.x, cy + controlPos.current.y); ctx.strokeStyle="rgba(255,255,255,0.3)"; ctx.stroke();
            }

            // 6. Wind Indicator
            drawWindIndicator(ctx, w, h, wind.current);

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => cancelAnimationFrame(animationFrameId);
    }, [isMyTurn, lastShotPath]); // wind ref doesn't need dep

    // Interaction Handlers
    // We want "Relative Mouse Movement" to adjust Control Pos?
    // Or absolute mapping?
    // Absolute mapping (drag to position) is easier for touch.
    // But for "fighting drift", relative motion (like FPS mouse) might be better?
    // Let's stick to "Drag to move reticle". 
    // Wait, if I hold my finger still, ControlPos is static. Reticle drifts away.
    // I have to move my finger to drag ControlPos back.
    // So dragging = setting Control Pos.

    // To make it feel better: centering the screen = (0,0).

    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isMyTurn) return;
        isAiming.current = true;
        // On start, set control pos to current reticle pos (so it doesn't snap)
        // actually, we want to grab it.
        // Let's just enable aiming.
    };

    const handleMove = (x: number, y: number) => {
        if (!isMyTurn || !isAiming.current) return;

        // We need delta movement to adjust ControlPos?
        // Or direct mapping?
        // If direct mapping: ControlPos = MousePos - Center.
        // Screen Center = Target Center.

        // Let's go with Delta for precision?
        // No, simple Direct Mapping is more intuitive for "Angry Birds" players transition.
        // But "Sniper" feel usually implies subtle movements.

        // Let's try: ControlPos is directly mapped to screen coordinates relative to center.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h * 0.55 + 80;

        controlPos.current = { x: x - cx, y: y - cy };
    };

    const handleEnd = () => {
        if (!isMyTurn || !isAiming.current) return;
        isAiming.current = false;

        // Fire!
        // Send current Reticle Position (relative to target center)
        socket?.emit('shoot', { aimPosition: reticlePos.current });

        // Reset
        // reticlePos.current = { x: 0, y: 0 }; // Keep it there to show where you fired?
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
                handleStart(e);
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }}
            onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={handleEnd}
        />
    );
};

// ... Helpers ...
const drawTrees = (ctx: CanvasRenderingContext2D, w: number, horizonY: number) => {
    ctx.fillStyle = '#1e3f1b';
    // Simplified trees for brevity, same as before
    for (let i = 0; i < w; i += 45) {
        ctx.fillRect(i, horizonY - 40, 10, 40);
        ctx.beginPath(); ctx.arc(i + 5, horizonY - 40, 20, 0, Math.PI * 2); ctx.fill();
    }
};

const drawTarget = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Legs
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-35, 0, 10, 80); ctx.fillRect(25, 0, 10, 80);

    // Face
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(-55, -55, 110, 110);

    // Rings
    const rings = [{ r: 50, c: 'white' }, { r: 40, c: 'black' }, { r: 30, c: '#00bcd4' }, { r: 20, c: '#f44336' }, { r: 10, c: '#ffeb3b' }];
    rings.forEach(ring => {
        ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2); ctx.fillStyle = ring.c; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.restore();
};

const drawReticle = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = 2;

    // Circle
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(0, -30); ctx.lineTo(0, 30);
    ctx.moveTo(-30, 0); ctx.lineTo(30, 0);
    ctx.stroke();

    // Dot
    ctx.fillStyle = 'red';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
};

const drawWindIndicator = (ctx: CanvasRenderingContext2D, w: number, h: number, wind: Point) => {
    const wx = w - 80;
    const wy = 80;

    ctx.save();
    ctx.translate(wx, wy);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();

    // Text
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText("WIND", 0, -20);

    // Arrow
    const strength = Math.sqrt(wind.x * wind.x + wind.y * wind.y);
    const angle = Math.atan2(wind.y, wind.x);

    ctx.rotate(angle);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
    ctx.lineTo(5, -5); ctx.moveTo(15, 0); ctx.lineTo(5, 5);
    ctx.stroke();

    ctx.restore();

    // Strength Text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(strength.toFixed(1), wx, wy + 20);
};

export default GameCanvas;
