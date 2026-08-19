// The quarterback, shared between games.
//
// The pull maths and the release point are imported from the Hail Mary physics
// module rather than copied, so a throw here behaves exactly like a throw
// there and tuning one tunes both.

import { GROUND_Y } from "./hailMaryLevels";
import { QB_HEAD_SRC } from "./hailMaryHead";
import { BALL_R, MAX_PULL, SLING } from "./hailMaryPhysics";

// He stands just left of the release point so his head never covers the ball.
export const QB_X = 88;
export const QB_SHOULDER = GROUND_Y - 68;
export const HEAD_R = 52;

// Decoded once for the life of the page. Until it is ready the head renders as
// a plain circle, so a slow decode can never leave a hole in the sprite.
let headImg = null;
export function qbHead() {
  if (headImg) return headImg;
  if (typeof window === "undefined") return null;
  headImg = new window.Image();
  headImg.src = QB_HEAD_SRC;
  return headImg;
}

// Where the ball sits for a given drag, clamped to the maximum pull.
export function pull(drag) {
  let dx = drag.x - SLING.x;
  let dy = drag.y - SLING.y;
  const d = Math.hypot(dx, dy);
  if (d > MAX_PULL) {
    dx = (dx / d) * MAX_PULL;
    dy = (dy / d) * MAX_PULL;
  }
  return { px: SLING.x + dx, py: SLING.y + dy };
}

// Normal-sized quarterback, absurd head. The throwing arm tracks wherever the
// ball is being pulled to, so he winds up as you drag. Pass a decoded Image
// as headOverride to play as someone else; default is the commissioner.
export function drawQB(ctx, hand, headOverride) {
  const headY = QB_SHOULDER - HEAD_R + 4;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(QB_X, GROUND_Y + 3, 34, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1b2a3d";
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(QB_X - 4, GROUND_Y - 34);
  ctx.lineTo(QB_X - 16, GROUND_Y - 2);
  ctx.moveTo(QB_X + 4, GROUND_Y - 34);
  ctx.lineTo(QB_X + 18, GROUND_Y - 2);
  ctx.stroke();

  ctx.fillStyle = "#0057B8";
  ctx.fillRect(QB_X - 15, QB_SHOULDER, 30, GROUND_Y - 32 - QB_SHOULDER);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1", QB_X, QB_SHOULDER + 22);

  ctx.strokeStyle = "#e6b79c";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(QB_X + 12, QB_SHOULDER + 6);
  ctx.lineTo(QB_X + 42, QB_SHOULDER + 2);
  ctx.moveTo(QB_X + 12, QB_SHOULDER + 4);
  ctx.lineTo(hand.px, hand.py);
  ctx.stroke();

  // The head is already cut out in the image itself (webp with alpha), so it
  // draws straight on — no clip, no ring, just the head at its own aspect.
  const img = headOverride || qbHead();
  const ready = img && img.complete && img.naturalWidth > 0;
  if (ready) {
    const hh = HEAD_R * 2;
    const ww = (hh * img.naturalWidth) / img.naturalHeight;
    ctx.drawImage(img, QB_X - ww / 2, headY - HEAD_R, ww, hh);
  } else {
    ctx.fillStyle = "#e6b79c";
    ctx.beginPath();
    ctx.arc(QB_X, headY, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawBall(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#8b4a24";
  ctx.beginPath();
  ctx.ellipse(0, 0, BALL_R + 4, BALL_R - 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4f1ea";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(7, 0);
  for (let i = -5; i <= 5; i += 2.5) {
    ctx.moveTo(i, -3.5);
    ctx.lineTo(i, 3.5);
  }
  ctx.stroke();
  ctx.restore();
}
