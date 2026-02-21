/**
 * ShareCard.ts — Generates a premium branded score card image on an offscreen canvas.
 * Returns a PNG Blob suitable for Web Share API or download.
 */
import type { Room } from '../types';

// ── Rating tiers (mirrors GameOver.tsx) ──
type RatingTier = {
    text: string;
    color: string;
    subtitle: string;
};

function getRating(avg: number): RatingTier {
    if (avg >= 9.5) return { text: 'PERFECT', color: '#c9a84c', subtitle: 'Legendary accuracy' };
    if (avg >= 8)  return { text: 'EXCELLENT', color: '#6ee7b7', subtitle: 'Sharp shooting' };
    if (avg >= 6)  return { text: 'GREAT', color: '#7dd3fc', subtitle: 'Well done' };
    if (avg >= 4)  return { text: 'GOOD', color: '#a78bfa', subtitle: 'Solid effort' };
    if (avg >= 2)  return { text: 'OK', color: '#94a3b8', subtitle: 'Keep practicing' };
    return { text: 'ROUGH', color: '#f87171', subtitle: 'Try again' };
}

// ── Canvas helpers ──
function drawRoundedRect(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

/** Procedurally generate a subtle noise overlay.
 *  Uses a temp canvas because putImageData bypasses globalAlpha/compositing. */
function drawNoise(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, alpha: number) {
    const tmp = new OffscreenCanvas(w, h);
    const tctx = tmp.getContext('2d')!;
    const imageData = tctx.createImageData(w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
    }
    tctx.putImageData(imageData, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
}

/** Draw decorative target rings in the background */
function drawTargetRings(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cx: number, cy: number, maxR: number, accentColor: string) {
    const [r, g, b] = hexToRgb(accentColor);

    // Outer glow
    const glowGrad = ctx.createRadialGradient(cx, cy, maxR * 0.3, cx, cy, maxR);
    glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.04)`);
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(cx - maxR, cy - maxR, maxR * 2, maxR * 2);

    const radii = [1.0, 0.83, 0.67, 0.5, 0.33, 0.17];
    radii.forEach((frac, i) => {
        const rad = maxR * frac;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.strokeStyle = i < 2
            ? `rgba(240, 236, 228, 0.06)`
            : `rgba(${r}, ${g}, ${b}, 0.08)`;
        ctx.lineWidth = i === 0 ? 1.5 : 0.6;
        ctx.stroke();
    });

    // Crosshairs
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.04)`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Diagonal crosshairs for extra depth
    const diag = maxR * 0.7;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.025)`;
    ctx.beginPath();
    ctx.moveTo(cx - diag, cy - diag); ctx.lineTo(cx + diag, cy + diag);
    ctx.moveTo(cx + diag, cy - diag); ctx.lineTo(cx - diag, cy + diag);
    ctx.stroke();
}

/** Draw the accuracy ring with glow and progress arc */
function drawAccuracyArc(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    cx: number, cy: number, radius: number,
    accuracy: number, color: string
) {
    const [r, g, b] = hexToRgb(color);

    // Outer decorative ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.08)`;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Track ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240, 236, 228, 0.06)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Progress arc
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * accuracy;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';

    // Inner subtle glow fill
    const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.8);
    innerGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.03)`);
    innerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 5, 0, Math.PI * 2);
    ctx.fill();
}

/** Draw a horizontal gold accent line */
function drawGoldLine(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cx: number, y: number, width: number, alpha: number = 0.6) {
    const grad = ctx.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.3, `rgba(201, 168, 76, ${alpha * 0.5})`);
    grad.addColorStop(0.5, `rgba(201, 168, 76, ${alpha})`);
    grad.addColorStop(0.7, `rgba(201, 168, 76, ${alpha * 0.5})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - width / 2, y, width, 1.5);
}

/** Draw small decorative diamond markers */
function drawDiamond(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
}

/** Draw the stat label-value pair */
function drawStat(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number, y: number,
    label: string, value: string,
    accent: boolean, accentColor: string
) {
    ctx.font = '600 9px "DM Sans", system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(240, 236, 228, 0.3)';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y);
    ctx.letterSpacing = '0px';

    ctx.font = '700 28px "Playfair Display", Georgia, serif';
    ctx.fillStyle = accent ? accentColor : '#f0ece4';
    if (accent) {
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 12;
    }
    ctx.fillText(value, x, y + 36);
    ctx.shadowBlur = 0;
}

// ── Main generator ──
export async function generateShareCard(room: Room, playerId: string | undefined): Promise<Blob> {
    const W = 600;
    const H = 900;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d')!;
    const cx = W / 2;

    // ═══════════════════════════════════════════
    // 1. BACKGROUND — deep dark with atmosphere
    // ═══════════════════════════════════════════
    const bgGrad = ctx.createRadialGradient(cx, H * 0.35, 0, cx, H * 0.35, H * 0.8);
    bgGrad.addColorStop(0, '#0f1a12');
    bgGrad.addColorStop(0.6, '#080e0a');
    bgGrad.addColorStop(1, '#030504');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Noise texture (very subtle)
    drawNoise(ctx, W, H, 0.03);

    // Compute data first so we can use accent color in background
    const me = room.players.find(p => p.userId === playerId);
    const myScore = me?.score || 0;
    let accentColor = '#c9a84c'; // default gold

    if (room.mode === 'solo') {
        const shotsCount = Math.max(1, room.round - 1);
        const avgPerShot = myScore / shotsCount;
        const rating = getRating(avgPerShot);
        accentColor = rating.color;
    }

    // Atmospheric glow (accent-tinted)
    const [ar, ag, ab] = hexToRgb(accentColor);
    const atmoGlow = ctx.createRadialGradient(cx, H * 0.33, 0, cx, H * 0.33, 320);
    atmoGlow.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, 0.06)`);
    atmoGlow.addColorStop(0.5, `rgba(${ar}, ${ag}, ${ab}, 0.02)`);
    atmoGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = atmoGlow;
    ctx.fillRect(0, 0, W, H);

    // Target rings background decoration
    drawTargetRings(ctx, cx, H * 0.36, 220, accentColor);

    // ═══════════════════════════════════════════
    // 2. GLASSMORPHIC CARD
    // ═══════════════════════════════════════════
    const cardX = 40;
    const cardY = 30;
    const cardW = W - 80;
    const cardH = H - 60;

    // Card background
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.fillStyle = 'rgba(10, 20, 12, 0.5)';
    ctx.fill();

    // Card border
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, 0.15)`);
    borderGrad.addColorStop(0.5, `rgba(${ar}, ${ag}, ${ab}, 0.05)`);
    borderGrad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0.12)`);
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner highlight at top edge
    ctx.save();
    ctx.clip();
    const innerHL = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
    innerHL.addColorStop(0, 'transparent');
    innerHL.addColorStop(0.3, 'rgba(240, 236, 228, 0.04)');
    innerHL.addColorStop(0.7, 'rgba(240, 236, 228, 0.04)');
    innerHL.addColorStop(1, 'transparent');
    ctx.fillStyle = innerHL;
    ctx.fillRect(cardX, cardY, cardW, 1);
    ctx.restore();

    // ═══════════════════════════════════════════
    // 3. TOP GOLD ACCENT LINE
    // ═══════════════════════════════════════════
    drawGoldLine(ctx, cx, cardY + 1, cardW * 0.5, 0.5);

    // ═══════════════════════════════════════════
    // 4. BRANDING
    // ═══════════════════════════════════════════
    // Diamonds flanking the brand name
    drawDiamond(ctx, cx - 64, 76, 4, `rgba(${ar}, ${ag}, ${ab}, 0.35)`);
    drawDiamond(ctx, cx + 64, 76, 4, `rgba(${ar}, ${ag}, ${ab}, 0.35)`);

    ctx.font = '600 12px "DM Sans", system-ui, sans-serif';
    ctx.letterSpacing = '8px';
    ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, 0.55)`;
    ctx.textAlign = 'center';
    ctx.fillText('ARCHR', cx + 4, 80); // +4 to optically center with letter-spacing
    ctx.letterSpacing = '0px';

    // Thin line below brand
    drawGoldLine(ctx, cx, 94, 80, 0.2);

    if (room.mode === 'solo') {
        // ═══════════════════════════════════════════
        // SOLO MODE CARD
        // ═══════════════════════════════════════════
        const shotsCount = Math.max(1, room.round - 1);
        const avgPerShot = myScore / shotsCount;
        const accuracyPct = Math.min(1, avgPerShot / 10);
        const rating = getRating(avgPerShot);
        const [rr, rg, rb] = hexToRgb(rating.color);

        // Sub-label
        ctx.font = '600 10px "DM Sans", system-ui, sans-serif';
        ctx.letterSpacing = '5px';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.2)';
        ctx.textAlign = 'center';
        ctx.fillText("TIME'S UP", cx, 140);
        ctx.letterSpacing = '0px';

        // Rating title with glow
        ctx.font = '900 62px "Playfair Display", Georgia, serif';
        ctx.fillStyle = rating.color;
        ctx.shadowColor = rating.color;
        ctx.shadowBlur = 50;
        ctx.fillText(rating.text, cx, 200);
        ctx.shadowBlur = 25;
        ctx.fillText(rating.text, cx, 200);
        ctx.shadowBlur = 0;

        // Subtitle in italic
        ctx.font = 'italic 400 15px "Playfair Display", Georgia, serif';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.3)';
        ctx.fillText(rating.subtitle, cx, 232);

        // Separator line
        drawGoldLine(ctx, cx, 256, 100, 0.15);

        // ── Accuracy Ring + Score ──
        const ringCY = 380;
        const ringR = 90;
        drawAccuracyArc(ctx, cx, ringCY, ringR, accuracyPct, rating.color);

        // Score number
        ctx.font = '900 68px "Playfair Display", Georgia, serif';
        ctx.fillStyle = '#f0ece4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(240, 236, 228, 0.1)';
        ctx.shadowBlur = 20;
        ctx.fillText(String(myScore), cx, ringCY - 6);
        ctx.shadowBlur = 0;

        // "Points" label below score
        ctx.font = '600 9px "DM Sans", system-ui, sans-serif';
        ctx.letterSpacing = '4px';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.25)';
        ctx.fillText('POINTS', cx, ringCY + 40);
        ctx.letterSpacing = '0px';
        ctx.textBaseline = 'alphabetic';

        // ── Stats Row ──
        const statsY = 540;
        drawRoundedRect(ctx, 80, statsY - 24, W - 160, 80, 14);
        ctx.fillStyle = `rgba(${rr}, ${rg}, ${rb}, 0.03)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, 0.08)`;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        const statW = (W - 160) / 3;
        const statItems = [
            { label: 'SHOTS', value: String(shotsCount), accent: false },
            { label: 'AVG', value: avgPerShot.toFixed(1), accent: true },
            { label: 'ACCURACY', value: `${Math.round(accuracyPct * 100)}%`, accent: false },
        ];

        statItems.forEach((item, i) => {
            const sx = 80 + statW * i + statW / 2;

            // Divider
            if (i > 0) {
                ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, 0.1)`;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(80 + statW * i, statsY - 10);
                ctx.lineTo(80 + statW * i, statsY + 44);
                ctx.stroke();
            }

            drawStat(ctx, sx, statsY, item.label, item.value, item.accent, rating.color);
        });

        // ── Decorative bottom section ──
        // Small arrow icon
        const arrowY = 680;
        ctx.save();
        ctx.translate(cx, arrowY);
        ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, 0.15)`;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        // Arrow shaft
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(20, 0);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(14, -5);
        ctx.lineTo(20, 0);
        ctx.lineTo(14, 5);
        ctx.stroke();
        // Fletching
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(-26, -5);
        ctx.moveTo(-20, 0);
        ctx.lineTo(-26, 5);
        ctx.stroke();
        ctx.restore();

    } else {
        // ═══════════════════════════════════════════
        // MULTIPLAYER MODE CARD
        // ═══════════════════════════════════════════
        const opponent = room.players.find(p => p.userId !== playerId);
        const oppScore = opponent?.score || 0;
        const isWin = myScore > oppScore;
        const isDraw = myScore === oppScore;

        const resultText = isWin ? 'VICTORY' : isDraw ? 'DRAW' : 'DEFEAT';
        const resultColor = isWin ? '#c9a84c' : isDraw ? '#f0ece4' : '#94a3b8';
        const subtitle = isWin ? 'Champion archer' : isDraw ? 'Evenly matched' : 'Better luck next round';

        // Sub-label
        ctx.font = '600 10px "DM Sans", system-ui, sans-serif';
        ctx.letterSpacing = '5px';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.2)';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', cx, 140);
        ctx.letterSpacing = '0px';

        // Result title with glow
        ctx.font = '900 62px "Playfair Display", Georgia, serif';
        ctx.fillStyle = resultColor;
        ctx.shadowColor = resultColor;
        ctx.shadowBlur = isWin ? 50 : 25;
        ctx.fillText(resultText, cx, 200);
        ctx.shadowBlur = 0;

        // Subtitle
        ctx.font = 'italic 400 15px "Playfair Display", Georgia, serif';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.3)';
        ctx.fillText(subtitle, cx, 232);

        // Separator
        drawGoldLine(ctx, cx, 256, 100, 0.15);

        // ── Score Comparison Panel ──
        const scoreBoxY = 290;
        const scoreBoxH = 160;
        drawRoundedRect(ctx, 70, scoreBoxY, W - 140, scoreBoxH, 16);
        ctx.fillStyle = 'rgba(201, 168, 76, 0.02)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        const scoreCY = scoreBoxY + scoreBoxH / 2;

        // My score
        ctx.font = '900 80px "Playfair Display", Georgia, serif';
        ctx.fillStyle = isWin || isDraw ? '#c9a84c' : 'rgba(240, 236, 228, 0.4)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isWin) {
            ctx.shadowColor = '#c9a84c';
            ctx.shadowBlur = 30;
        }
        ctx.fillText(String(myScore), cx - 110, scoreCY - 8);
        ctx.shadowBlur = 0;

        ctx.font = '600 9px "DM Sans", system-ui, sans-serif';
        ctx.letterSpacing = '3px';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.2)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('YOU', cx - 110, scoreCY + 34);
        ctx.letterSpacing = '0px';

        // Divider line
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, scoreBoxY + 20);
        ctx.lineTo(cx, scoreBoxY + scoreBoxH - 20);
        ctx.stroke();

        // VS text
        ctx.font = 'italic 400 12px "Playfair Display", Georgia, serif';
        ctx.fillStyle = 'rgba(201, 168, 76, 0.25)';
        ctx.textAlign = 'center';
        ctx.fillText('vs', cx, scoreCY);

        // Opponent score
        ctx.font = '900 80px "Playfair Display", Georgia, serif';
        ctx.fillStyle = !isWin && !isDraw ? '#f87171' : 'rgba(240, 236, 228, 0.4)';
        ctx.textBaseline = 'middle';
        if (!isWin && !isDraw) {
            ctx.shadowColor = '#f87171';
            ctx.shadowBlur = 20;
        }
        ctx.fillText(String(oppScore), cx + 110, scoreCY - 8);
        ctx.shadowBlur = 0;

        ctx.font = '600 9px "DM Sans", system-ui, sans-serif';
        ctx.letterSpacing = '3px';
        ctx.fillStyle = 'rgba(240, 236, 228, 0.2)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('OPPONENT', cx + 110, scoreCY + 34);
        ctx.letterSpacing = '0px';

        // Rounds stat
        const roundsY = 510;
        drawRoundedRect(ctx, 180, roundsY - 20, W - 360, 72, 12);
        ctx.fillStyle = 'rgba(201, 168, 76, 0.025)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        drawStat(ctx, cx, roundsY, 'ROUNDS', String(room.maxRounds), false, '#c9a84c');

        // Arrow icon
        const arrowY = 640;
        ctx.save();
        ctx.translate(cx, arrowY);
        ctx.strokeStyle = 'rgba(201, 168, 76, 0.15)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14, -5); ctx.lineTo(20, 0); ctx.lineTo(14, 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-26, -5); ctx.moveTo(-20, 0); ctx.lineTo(-26, 5); ctx.stroke();
        ctx.restore();
    }

    // ═══════════════════════════════════════════
    // 5. FOOTER
    // ═══════════════════════════════════════════
    const footerY = H - 65;

    // Gold accent line
    drawGoldLine(ctx, cx, footerY - 16, 120, 0.15);

    // Small diamonds
    drawDiamond(ctx, cx - 50, footerY + 8, 3, 'rgba(201, 168, 76, 0.2)');
    drawDiamond(ctx, cx + 50, footerY + 8, 3, 'rgba(201, 168, 76, 0.2)');

    ctx.font = '500 11px "DM Sans", system-ui, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(240, 236, 228, 0.15)';
    ctx.textAlign = 'center';
    ctx.fillText('archr.prnce.xyz', cx, footerY + 12);
    ctx.letterSpacing = '0px';

    // ── Export as PNG blob ──
    return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Share or download the score card image.
 */
export async function shareScoreCard(room: Room, playerId: string | undefined): Promise<void> {
    const blob = await generateShareCard(room, playerId);
    const file = new File([blob], 'archr-score.png', { type: 'image/png' });

    // Try Web Share API first (mobile-friendly)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({
                title: 'ARCHR Score',
                text: 'Check out my score on ARCHR! 🏹',
                files: [file],
            });
            return;
        } catch (err) {
            // User cancelled or API failed — fall through to download
            if ((err as DOMException).name === 'AbortError') return;
        }
    }

    // Fallback: trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'archr-score.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
