// ==========================================================
// confetti.js — lightweight canvas confetti burst
// ==========================================================
import { prefersReducedMotion } from '../core/utils.js';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9'];
let canvas, ctx, particles = [], raf = null;

function setup() {
  canvas = document.getElementById('confetti');
  ctx = canvas.getContext('2d');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
}

/**
 * confetti({ x, y, count, spread, power })
 * x / y in viewport pixels (defaults to screen center-top)
 */
export function confetti({ x = innerWidth / 2, y = innerHeight / 3, count = 40, spread = Math.PI * 2, power = 9 } = {}) {
  if (prefersReducedMotion()) return;
  if (!canvas) setup();
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = power * (0.45 + Math.random() * 0.75);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 0,
      max: 70 + Math.random() * 50,
      round: Math.random() < 0.3,
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

export function celebrate() {
  confetti({ x: innerWidth * 0.25, y: innerHeight * 0.55, count: 70, spread: Math.PI / 1.6, power: 15 });
  confetti({ x: innerWidth * 0.75, y: innerHeight * 0.55, count: 70, spread: Math.PI / 1.6, power: 15 });
}

function tick() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life < p.max);
  for (const p of particles) {
    p.life++;
    p.vy += 0.28;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  raf = particles.length ? requestAnimationFrame(tick) : null;
  if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
}
