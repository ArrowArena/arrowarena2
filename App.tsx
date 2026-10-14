import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Crosshair, Flag, Heart, Play, RotateCcw, Shield, Skull, Swords, Target, Volume2, VolumeX, Zap, HeartPulse, Gauge, Flame, ChevronRight, Trophy, MapPin } from 'lucide-react';

type Weapon = 'bow' | 'spear';
type ViewMode = 'first' | 'third';
type Screen = 'menu' | 'game';
type Keys = Record<string, boolean>;
type Team = 'blue' | 'red';
type ArrowShot = { id: number; x: number; y: number; vx: number; vy: number; life: number; team: Team; angle: number };
type PowerUpType = 'heal' | 'speed' | 'rapid' | 'shield';
type PowerUp = { id: number; x: number; y: number; type: PowerUpType; active: boolean; respawn: number };
type ActiveBuff = { type: PowerUpType; time: number };
type PlatformDef = { x: number; y: number; w: number; h: number };
type KillFeedEntry = { id: number; killer: string; victim: string; killerTeam: Team };
type Player = { x: number; y: number; vx: number; vy: number; grounded: boolean; facing: 1 | -1; dash: number };
type Bot = {
  id: number; team: Team; name: string; x: number; y: number; vx: number; vy: number;
  grounded: boolean; facing: 1 | -1; hp: number; alive: boolean; respawn: number;
  weapon: Weapon; fireCooldown: number; jumpCooldown: number; hasFlag: boolean; color: string;
  invuln: number; buff: ActiveBuff | null; dashCooldown: number;
};

const WORLD_WIDTH = 2200;
const GROUND_Y = 520;
const CHAR_H = 78;
const START_PLAYER: Player = { x: 290, y: GROUND_Y - CHAR_H, vx: 0, vy: 0, grounded: true, facing: 1, dash: 0 };
const RED_FLAG_X = 1885;
const BLUE_BASE_X = 255;
const MAX_ROUNDS = 5;
const ROUND_TIME = 120;
const WIN_SCORE = Math.ceil(MAX_ROUNDS / 2);

const PLATFORMS: PlatformDef[] = [
  { x: 335, y: GROUND_Y - 190, w: 360, h: 20 },
  { x: 800, y: GROUND_Y - 140, w: 280, h: 20 },
  { x: 1200, y: GROUND_Y - 170, w: 240, h: 20 },
  { x: 1580, y: GROUND_Y - 120, w: 300, h: 20 },
];

const TEAM_NAMES_BLUE = ['SEEWOLF', 'KASPIAN'];
const TEAM_NAMES_RED = ['ASCHENPFEIL', 'KORVAN'];

const POWERUP_SPAWNS: { x: number; y: number; type: PowerUpType }[] = [
  { x: 500, y: GROUND_Y - 240, type: 'heal' },
  { x: 1050, y: GROUND_Y - 220, type: 'speed' },
  { x: 1350, y: GROUND_Y - 230, type: 'rapid' },
  { x: 1750, y: GROUND_Y - 190, type: 'shield' },
];

function makeBots(): Bot[] {
  const bots: Bot[] = [];
  let id = 100;
  TEAM_NAMES_BLUE.forEach((name, i) => {
    bots.push({ id: id++, team: 'blue', name, x: 380 + i * 160, y: GROUND_Y - CHAR_H, vx: 0, vy: 0, grounded: true, facing: 1, hp: 100, alive: true, respawn: 0, weapon: i === 0 ? 'bow' : 'spear', fireCooldown: 1 + i, jumpCooldown: 0, hasFlag: false, color: '#72aeb1', invuln: 1, buff: null, dashCooldown: 0 });
  });
  TEAM_NAMES_RED.forEach((name, i) => {
    bots.push({ id: id++, team: 'red', name, x: 1500 + i * 160, y: GROUND_Y - CHAR_H, vx: 0, vy: 0, grounded: true, facing: -1, hp: 100, alive: true, respawn: 0, weapon: i === 0 ? 'bow' : 'spear', fireCooldown: 1.5 + i, jumpCooldown: 0, hasFlag: false, color: '#bb6553', invuln: 1, buff: null, dashCooldown: 0 });
  });
  return bots;
}

function makePowerUps(): PowerUp[] {
  return POWERUP_SPAWNS.map((p, i) => ({ id: i, x: p.x, y: p.y, type: p.type, active: true, respawn: 0 }));
}

const POWERUP_INFO: Record<PowerUpType, { label: string; color: string; icon: typeof Heart }> = {
  heal: { label: 'HEILUNG', color: '#6abe6a', icon: HeartPulse },
  speed: { label: 'SPEED', color: '#e0b34a', icon: Gauge },
  rapid: { label: 'SCHNELLFEUER', color: '#d4634f', icon: Flame },
  shield: { label: 'SCHILD', color: '#5a9fb8', icon: Shield },
};

function resolvePlatforms(x: number, y: number, vy: number): { y: number; grounded: boolean } {
  let resultY = y;
  let grounded = false;
  for (const p of PLATFORMS) {
    if (x + 20 > p.x && x + 72 < p.x + p.w + 20 && vy >= 0) {
      if (y + CHAR_H >= p.y && y + CHAR_H <= p.y + p.h + 20) {
        resultY = p.y - CHAR_H; grounded = true; break;
      }
    }
  }
  if (resultY >= GROUND_Y - CHAR_H) { resultY = GROUND_Y - CHAR_H; grounded = true; }
  return { y: resultY, grounded };
}

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { return null; } }
  return audioCtx;
}
function playSound(type: 'shoot' | 'hit' | 'kill' | 'pickup' | 'flag' | 'win' | 'lose', muted: boolean) {
  if (muted) return;
  const ctx = getAudioCtx(); if (!ctx) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  if (type === 'shoot') { o.frequency.setValueAtTime(880, now); o.frequency.exponentialRampToValueAtTime(220, now + 0.12); g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12); o.start(now); o.stop(now + 0.12); }
  else if (type === 'hit') { o.type = 'square'; o.frequency.setValueAtTime(180, now); o.frequency.exponentialRampToValueAtTime(60, now + 0.08); g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08); o.start(now); o.stop(now + 0.08); }
  else if (type === 'kill') { o.type = 'sawtooth'; o.frequency.setValueAtTime(250, now); o.frequency.exponentialRampToValueAtTime(50, now + 0.25); g.gain.setValueAtTime(0.14, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25); o.start(now); o.stop(now + 0.25); }
  else if (type === 'pickup') { o.frequency.setValueAtTime(440, now); o.frequency.exponentialRampToValueAtTime(880, now + 0.1); g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.1); o.start(now); o.stop(now + 0.1); }
  else if (type === 'flag') { o.frequency.setValueAtTime(330, now); o.frequency.linearRampToValueAtTime(660, now + 0.15); o.frequency.linearRampToValueAtTime(880, now + 0.3); g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.3); o.start(now); o.stop(now + 0.3); }
  else if (type === 'win' || type === 'lose') { o.type = 'triangle'; const notes = type === 'win' ? [523, 659, 784, 1047] : [440, 392, 330, 262]; notes.forEach((f, i) => { o.frequency.setValueAtTime(f, now + i * 0.15); }); g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + notes.length * 0.15); o.start(now); o.stop(now + notes.length * 0.15); }
}

function App() {
  const keys = useRef<Keys>({});
  const player = useRef<Player>({ ...START_PLAYER });
  const botsRef = useRef<Bot[]>(makeBots());
  const powerUpsRef = useRef<PowerUp[]>(makePowerUps());
  const frame = useRef<number>();
  const lastTime = useRef(0);
  const nextArrowId = useRef(0);
  const nextKillId = useRef(0);
  const hasFlagRef = useRef(false);
  const redFlagHeldByRef = useRef<number | null>(null);
  const scoreRef = useRef({ blue: 0, red: 0 });
  const roundRef = useRef(1);
  const playerHpRef = useRef(100);
  const playerInvulnRef = useRef(1);
  const playerBuffRef = useRef<ActiveBuff | null>(null);
  const redFlagXRef = useRef(RED_FLAG_X);
  const roundTimerRef = useRef(ROUND_TIME);
  const playerKillsRef = useRef(0);
  const playerDeathsRef = useRef(0);
  const shakeRef = useRef(0);

  const [screen, setScreen] = useState<Screen>('menu');
  const [weapon, setWeapon] = useState<Weapon>('bow');
  const [viewMode, setViewMode] = useState<ViewMode>('first');
  const [charge, setCharge] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [position, setPosition] = useState(START_PLAYER);
  const [arrows, setArrows] = useState<ArrowShot[]>([]);
  const [hasFlag, setHasFlag] = useState(false);
  const [score, setScore] = useState({ blue: 0, red: 0 });
  const [round, setRound] = useState(1);
  const [gameWon, setGameWon] = useState<Team | null>(null);
  const [matchWon, setMatchWon] = useState<Team | null>(null);
  const [message, setMessage] = useState('BEREIT');
  const [muted, setMuted] = useState(false);
  const [playerHp, setPlayerHp] = useState(100);
  const [botState, setBotState] = useState<Bot[]>(makeBots());
  const [redFlagX, setRedFlagX] = useState(RED_FLAG_X);
  const [roundTime, setRoundTime] = useState(ROUND_TIME);
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);
  const [playerKills, setPlayerKills] = useState(0);
  const [playerDeaths, setPlayerDeaths] = useState(0);
  const [playerBuff, setPlayerBuff] = useState<ActiveBuff | null>(null);
  const [powerUpState, setPowerUpState] = useState<PowerUp[]>(makePowerUps());
  const [hitFlash, setHitFlash] = useState(0);
  const [shake, setShake] = useState(0);
  const [roundTransition, setRoundTransition] = useState<string | null>(null);

  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const addKillFeed = useCallback((killer: string, victim: string, killerTeam: Team) => {
    const entry: KillFeedEntry = { id: nextKillId.current++, killer, victim, killerTeam };
    setKillFeed((current) => [...current, entry]);
    setTimeout(() => setKillFeed((current) => current.filter((e) => e.id !== entry.id)), 5000);
  }, []);

  const spawnArrow = useCallback((x: number, y: number, angle: number, team: Team) => {
    const speed = 1150;
    setArrows((current) => [...current, { id: nextArrowId.current++, x, y, vx: angle === 0 ? speed : -speed, vy: -120, life: 2.5, team, angle }]);
  }, []);

  const fireArrow = useCallback(() => {
    if (weapon !== 'bow') return;
    const direction = player.current.facing;
    const rapid = playerBuffRef.current?.type === 'rapid';
    spawnArrow(player.current.x + direction * 34, player.current.y + 30, direction === 1 ? 0 : 180, 'blue');
    playSound('shoot', mutedRef.current);
    setCharge(0); setIsCharging(false); setMessage('PFEIL LOS');
    if (rapid) { setTimeout(() => spawnArrow(player.current.x + direction * 34, player.current.y + 25, direction === 1 ? 0 : 180, 'blue'), 120); }
  }, [weapon, spawnArrow]);

  const spearDash = useCallback(() => {
    if (weapon !== 'spear' || player.current.dash > 0) return;
    player.current.vx = player.current.facing * 920; player.current.dash = 0.42;
    setMessage('SPEERSTOSS');
  }, [weapon]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (screen !== 'game') return;
      keys.current[event.key.toLowerCase()] = true;
      if (event.key.toLowerCase() === 'q') setWeapon((value) => value === 'bow' ? 'spear' : 'bow');
      if (event.key.toLowerCase() === 'z') setViewMode((value) => value === 'first' ? 'third' : 'first');
      if (event.code === 'Space') event.preventDefault();
    };
    const up = (event: KeyboardEvent) => { keys.current[event.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'game') return;
    const tick = (time: number) => {
      const dt = Math.min((time - lastTime.current) / 1000 || 0, 0.033);
      lastTime.current = time;
      if (gameWon || matchWon) { frame.current = requestAnimationFrame(tick); return; }

      const current = player.current;
      const speedBuff = playerBuffRef.current?.type === 'speed';
      const speedMult = speedBuff ? 1.5 : 1;
      const left = keys.current.a || keys.current.arrowleft;
      const right = keys.current.d || keys.current.arrowright;
      const move = Number(right) - Number(left);
      if (move) current.facing = move > 0 ? 1 : -1;
      const dashSpeed = current.dash > 0 ? current.vx : 0;
      current.vx = current.dash > 0 ? dashSpeed * Math.pow(0.08, dt) : current.vx + (move * 850 * speedMult - current.vx) * Math.min(dt * 10, 1);
      current.x = Math.max(80, Math.min(WORLD_WIDTH - 100, current.x + current.vx * dt));
      if ((keys.current.w || keys.current.arrowup || keys.current[' ']) && current.grounded) { current.vy = -720; current.grounded = false; setMessage('SPRUNG'); }
      current.vy += 1850 * dt;
      current.y += current.vy * dt;
      const groundCheck = resolvePlatforms(current.x, current.y, current.vy);
      current.y = groundCheck.y; current.grounded = groundCheck.grounded;
      if (current.grounded) current.vy = 0;
      current.dash = Math.max(0, current.dash - dt);
      playerInvulnRef.current = Math.max(0, playerInvulnRef.current - dt);
      if (playerBuffRef.current) { playerBuffRef.current.time -= dt; if (playerBuffRef.current.time <= 0) playerBuffRef.current = null; setPlayerBuff(playerBuffRef.current ? { ...playerBuffRef.current } : null); }

      if (!hasFlagRef.current && redFlagHeldByRef.current === null && Math.abs(current.x - redFlagXRef.current) < 55 && Math.abs(current.y - (GROUND_Y - CHAR_H)) < 20) {
        hasFlagRef.current = true; setHasFlag(true); setMessage('ROTE FLAGGE GESICHERT'); playSound('flag', mutedRef.current);
      }
      if (hasFlagRef.current && current.x < BLUE_BASE_X + 80) {
        hasFlagRef.current = false; setHasFlag(false);
        scoreRef.current.blue++; setScore({ ...scoreRef.current });
        setMessage('CAPTURE ERFOLGREICH'); playSound('win', mutedRef.current);
        if (scoreRef.current.blue >= WIN_SCORE) { setMatchWon('blue'); playSound('win', mutedRef.current); }
        else { setGameWon('blue'); }
      }

      roundTimerRef.current -= dt;
      if (roundTimerRef.current <= 0) {
        roundTimerRef.current = ROUND_TIME;
        scoreRef.current.red++; setScore({ ...scoreRef.current });
        setMessage('ZEIT ABGELAUFEN'); playSound('lose', mutedRef.current);
        if (scoreRef.current.red >= WIN_SCORE) { setMatchWon('red'); playSound('lose', mutedRef.current); }
        else { setGameWon('red'); }
      }
      setRoundTime(Math.ceil(roundTimerRef.current));

      const bots = botsRef.current;
      for (const bot of bots) {
        if (!bot.alive) {
          bot.respawn -= dt;
          if (bot.respawn <= 0) {
            bot.alive = true; bot.hp = 100; bot.invuln = 1.5;
            bot.x = bot.team === 'blue' ? 300 + Math.random() * 120 : 1700 + Math.random() * 120;
            bot.y = GROUND_Y - CHAR_H; bot.vx = 0; bot.vy = 0; bot.hasFlag = false;
          }
          continue;
        }
        bot.invuln = Math.max(0, bot.invuln - dt);
        bot.dashCooldown = Math.max(0, bot.dashCooldown - dt);
        if (bot.buff) { bot.buff.time -= dt; if (bot.buff.time <= 0) bot.buff = null; }

        let goalX: number;
        if (bot.team === 'red' && bot.hasFlag) { goalX = BLUE_BASE_X + 50; }
        else if (bot.team === 'blue' && hasFlagRef.current) { goalX = BLUE_BASE_X + 50; }
        else if (bot.team === 'red' && redFlagHeldByRef.current === null && !hasFlagRef.current) { goalX = redFlagXRef.current; }
        else if (bot.team === 'blue') { goalX = redFlagHeldByRef.current !== null ? (bots.find((b) => b.id === redFlagHeldByRef.current)?.x ?? RED_FLAG_X) : redFlagXRef.current; }
        else { goalX = bot.team === 'red' ? BLUE_BASE_X : RED_FLAG_X; }

        const enemies: { x: number; y: number; ref: 'player' | Bot }[] = [];
        if (playerHpRef.current > 0) enemies.push({ x: current.x, y: current.y, ref: 'player' });
        for (const b of bots) { if (b.alive && b.team !== bot.team) enemies.push({ x: b.x, y: b.y, ref: b }); }
        let nearestDist = 600;
        let nearestEnemy: { x: number; y: number; ref: 'player' | Bot } | null = null;
        for (const e of enemies) { const d = Math.abs(e.x - bot.x); if (d < nearestDist) { nearestDist = d; nearestEnemy = e; } }

        for (const pu of powerUpsRef.current) {
          if (pu.active && Math.abs(bot.x - pu.x) < 45 && Math.abs(bot.y - pu.y) < 60) {
            pu.active = false; pu.respawn = 12;
            if (pu.type === 'heal') bot.hp = Math.min(100, bot.hp + 40);
            else bot.buff = { type: pu.type, time: 6 };
          }
        }

        let moveDir = 0;
        if (nearestEnemy && nearestDist < 200 && bot.weapon === 'bow') { moveDir = bot.x < nearestEnemy.x ? -1 : 1; }
        else if (Math.abs(bot.x - goalX) > 25) { moveDir = bot.x < goalX ? 1 : -1; }
        bot.facing = moveDir >= 0 ? 1 : -1;
        const bSpeedMult = bot.buff?.type === 'speed' ? 1.5 : 1;
        bot.vx = moveDir * 420 * bSpeedMult;
        bot.x = Math.max(80, Math.min(WORLD_WIDTH - 100, bot.x + bot.vx * dt));

        bot.jumpCooldown -= dt;
        if (bot.grounded && bot.jumpCooldown <= 0 && (Math.random() < 0.015 || (moveDir !== 0 && Math.random() < 0.02))) {
          bot.vy = -680; bot.grounded = false; bot.jumpCooldown = 1.2;
        }
        bot.vy += 1850 * dt; bot.y += bot.vy * dt;
        const botGround = resolvePlatforms(bot.x, bot.y, bot.vy);
        bot.y = botGround.y; bot.grounded = botGround.grounded;
        if (bot.grounded) bot.vy = 0;

        if (bot.weapon === 'spear' && bot.dashCooldown <= 0 && nearestEnemy && nearestDist < 120 && nearestDist > 40) {
          bot.vx = bot.facing * 800; bot.dashCooldown = 2; bot.invuln = Math.max(bot.invuln, 0.3);
        }

        bot.fireCooldown -= dt;
        const fireRate = bot.buff?.type === 'rapid' ? 0.8 : 1;
        if (bot.weapon === 'bow' && bot.fireCooldown <= 0 && nearestEnemy && nearestDist < 600) {
          const angle = nearestEnemy.x > bot.x ? 0 : 180;
          spawnArrow(bot.x + bot.facing * 30, bot.y + 30, angle, bot.team);
          bot.fireCooldown = (1.8 + Math.random() * 1.2) / fireRate;
        }

        if (bot.team === 'red' && redFlagHeldByRef.current === null && !hasFlagRef.current && Math.abs(bot.x - redFlagXRef.current) < 55) {
          redFlagHeldByRef.current = bot.id; bot.hasFlag = true; playSound('flag', mutedRef.current);
        }
        if (bot.team === 'red' && bot.hasFlag && bot.x < BLUE_BASE_X + 80) {
          bot.hasFlag = false; redFlagHeldByRef.current = null;
          scoreRef.current.red++; setScore({ ...scoreRef.current });
          setMessage('ROT EROBERT FLAGGE'); playSound('lose', mutedRef.current);
          if (scoreRef.current.red >= WIN_SCORE) { setMatchWon('red'); }
          else { setGameWon('red'); }
        }
        if (bot.team === 'blue' && redFlagHeldByRef.current === null && !hasFlagRef.current && Math.abs(bot.x - redFlagXRef.current) < 55 && redFlagXRef.current !== RED_FLAG_X) {
          redFlagHeldByRef.current = bot.id; bot.hasFlag = true;
        }
        if (bot.team === 'blue' && bot.hasFlag && bot.x < BLUE_BASE_X + 80) {
          bot.hasFlag = false; redFlagHeldByRef.current = null;
          scoreRef.current.blue++; setScore({ ...scoreRef.current });
          setMessage('BLAU EROBERT FLAGGE'); playSound('win', mutedRef.current);
          if (scoreRef.current.blue >= WIN_SCORE) { setMatchWon('blue'); }
          else { setGameWon('blue'); }
        }
      }

      for (const pu of powerUpsRef.current) {
        if (!pu.active) { pu.respawn -= dt; if (pu.respawn <= 0) { pu.active = true; } continue; }
        if (Math.abs(current.x - pu.x) < 45 && Math.abs(current.y - pu.y) < 60) {
          pu.active = false; pu.respawn = 12;
          playSound('pickup', mutedRef.current);
          if (pu.type === 'heal') { playerHpRef.current = Math.min(100, playerHpRef.current + 40); setPlayerHp(playerHpRef.current); setMessage('+40 HEILUNG'); }
          else { playerBuffRef.current = { type: pu.type, time: 6 }; setPlayerBuff({ ...playerBuffRef.current }); setMessage(POWERUP_INFO[pu.type].label + ' AKTIV'); }
        }
      }

      setArrows((shots) => {
        const updated: ArrowShot[] = [];
        for (const shot of shots) {
          const nx = shot.x + shot.vx * dt;
          const ny = shot.y + shot.vy * dt;
          const nvy = shot.vy + 280 * dt;
          const life = shot.life - dt;
          if (life <= 0 || nx < 0 || nx > WORLD_WIDTH || ny > GROUND_Y) continue;
          const nAngle = Math.atan2(nvy, shot.vx) * 180 / Math.PI;

          if (shot.team === 'red' && playerInvulnRef.current <= 0 && Math.abs(nx - current.x) < 38 && Math.abs(ny - current.y + 8) < 55) {
            const shielded = playerBuffRef.current?.type === 'shield';
            if (!shielded) {
              playerHpRef.current = Math.max(0, playerHpRef.current - 20);
              setPlayerHp(playerHpRef.current); setHitFlash(1); shakeRef.current = 8; setShake(8);
              playSound('hit', mutedRef.current);
              if (playerHpRef.current <= 0) {
                playerDeathsRef.current++; setPlayerDeaths(playerDeathsRef.current);
                playerHpRef.current = 100; setPlayerHp(100); playerInvulnRef.current = 2;
                current.x = 290; current.y = GROUND_Y - CHAR_H; current.vx = 0; current.vy = 0;
                if (hasFlagRef.current) { hasFlagRef.current = false; setHasFlag(false); redFlagXRef.current = current.x; setRedFlagX(current.x); }
                addKillFeed('GEGNER', 'DU', 'red'); setMessage('GETOETET - RESPAWN');
                playSound('kill', mutedRef.current); shakeRef.current = 15; setShake(15);
              }
            } else { setMessage('SCHILD BLOCKT'); }
            continue;
          }

          let hit = false;
          for (const bot of bots) {
            if (!bot.alive || bot.team === shot.team || bot.invuln > 0) continue;
            if (Math.abs(nx - bot.x) < 38 && Math.abs(ny - bot.y + 8) < 55) {
              const shielded = bot.buff?.type === 'shield';
              if (!shielded) {
                bot.hp -= 25; hit = true;
                if (shot.team === 'blue') { shakeRef.current = 5; setShake(5); }
                if (bot.hp <= 0) {
                  bot.alive = false; bot.respawn = 4;
                  if (shot.team === 'blue') { playerKillsRef.current++; setPlayerKills(playerKillsRef.current); addKillFeed('DU', bot.name, 'blue'); playSound('kill', mutedRef.current); }
                  else { addKillFeed('GEGNER', bot.name, 'red'); }
                  if (bot.hasFlag) {
                    bot.hasFlag = false; redFlagHeldByRef.current = null;
                    redFlagXRef.current = bot.x; setRedFlagX(bot.x);
                    setMessage('FLAGGE FALLEN GELASSEN');
                  }
                } else if (shot.team === 'blue') { playSound('hit', mutedRef.current); }
              }
              break;
            }
          }
          if (hit) continue;
          updated.push({ ...shot, x: nx, y: ny, vy: nvy, life, angle: nAngle });
        }
        return updated;
      });

      if (shakeRef.current > 0) { shakeRef.current = Math.max(0, shakeRef.current - dt * 40); setShake(shakeRef.current); }
      if (hitFlash > 0) setHitFlash((v) => Math.max(0, v - dt * 4));

      setPosition({ ...current });
      setBotState(bots.map((b) => ({ ...b })));
      setPowerUpState(powerUpsRef.current.map((p) => ({ ...p })));
      if (isCharging && weapon === 'bow') setCharge((value) => Math.min(1, value + dt / 1.1));
      frame.current = requestAnimationFrame(tick);
    };
    lastTime.current = 0;
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [screen, isCharging, weapon, spawnArrow, addKillFeed, gameWon, matchWon, hitFlash]);

  const startRound = () => {
    player.current = { ...START_PLAYER };
    botsRef.current = makeBots();
    powerUpsRef.current = makePowerUps();
    hasFlagRef.current = false; redFlagHeldByRef.current = null;
    playerHpRef.current = 100; playerInvulnRef.current = 2;
    playerBuffRef.current = null; redFlagXRef.current = RED_FLAG_X;
    roundTimerRef.current = ROUND_TIME;
    setPosition({ ...START_PLAYER }); setArrows([]); setHasFlag(false);
    setCharge(0); setPlayerHp(100); setPlayerBuff(null);
    setRedFlagX(RED_FLAG_X); setRoundTime(ROUND_TIME);
    setBotState(botsRef.current.map((b) => ({ ...b })));
    setPowerUpState(powerUpsRef.current.map((p) => ({ ...p })));
    setGameWon(null); setHitFlash(0); setShake(0);
    setRoundTransition('RUNDE ' + roundRef.current);
    setTimeout(() => setRoundTransition(null), 2000);
    setMessage('BEREIT');
  };

  const startMatch = () => {
    scoreRef.current = { blue: 0, red: 0 }; roundRef.current = 1;
    playerKillsRef.current = 0; playerDeathsRef.current = 0;
    setScore({ blue: 0, red: 0 }); setRound(1);
    setPlayerKills(0); setPlayerDeaths(0);
    setMatchWon(null); setScreen('game'); startRound();
  };

  const nextRound = () => { roundRef.current++; setRound(roundRef.current); startRound(); };
  const reset = () => { startMatch(); };
  const handlePointerDown = () => { if (weapon === 'bow') { setIsCharging(true); setMessage('SPANNEN'); } else spearDash(); };
  const handlePointerUp = () => { if (isCharging) fireArrow(); };
  const cameraX = Math.max(0, Math.min(WORLD_WIDTH - 1000, position.x - 440));
  const minutes = Math.floor(roundTime / 60);
  const seconds = roundTime % 60;
  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake : 0;

  if (screen === 'menu') {
    return <main className="prototype-shell menu-screen">
      <div className="menu-bg" />
      <div className="menu-mountains" />
      <div className="menu-fortress" />
      <div className="menu-content">
        <div className="menu-eyebrow">SAISON 01 · NOCTIS KEEP</div>
        <h1 className="menu-title">ARROW<span>ARENA</span></h1>
        <p className="menu-sub">2v2 Capture-the-Flag · Bogen &amp; Speer · First/Third Person</p>
        <div className="menu-team-preview">
          <div className="menu-team menu-team-blue"><Shield size={22} /><strong>BLAU</strong><span>DU + SEEWOLF</span></div>
          <div className="menu-vs">VS</div>
          <div className="menu-team menu-team-red"><Swords size={22} /><strong>ROT</strong><span>ASCHENPFEIL + KORVAN</span></div>
        </div>
        <button className="menu-play" onClick={startMatch}><Play size={20} fill="currentColor" /> SPIEL STARTEN</button>
        <div className="menu-controls">
          <div><kbd>A</kbd><kbd>D</kbd> Bewegen</div>
          <div><kbd>SPACE</kbd> Springen</div>
          <div><kbd>Q</kbd> Waffe wechseln</div>
          <div><kbd>Z</kbd> Perspektive</div>
          <div><kbd>KLICK</kbd> Schießen / Stoß</div>
        </div>
        <div className="menu-rules">
          <div><Flag size={16} /> Hol die rote Flagge und bring sie zur blauen Basis</div>
          <div><Target size={16} /> Best of {MAX_ROUNDS} Runden · {ROUND_TIME}s pro Runde</div>
          <div><Heart size={16} /> Power-ups: Heilung, Speed, Schnellfeuer und Schild</div>
        </div>
      </div>
    </main>;
  }

  return <main className="prototype-shell" onPointerUp={handlePointerUp}>
    <header className="prototype-header"><div className="prototype-logo"><span><Flag size={16} /></span><strong>ARROW<em>ARENA</em></strong></div><div className="prototype-match"><span>NOCTIS KEEP</span><strong>2V2 · RUNDE {round}/{MAX_ROUNDS}</strong></div><div className="header-controls"><button onClick={() => setMuted((value) => !value)} aria-label="Ton umschalten">{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><button onClick={() => setScreen('menu')} aria-label="Zum Menü"><ArrowRight size={17} /></button></div></header>
    <section className="game-viewport" onPointerDown={handlePointerDown} style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}>
      <div className="sky-layer" /><div className="sun-disc" /><div className="cloud cloud-a" /><div className="cloud cloud-b" />
      <div className="game-world" style={{ transform: `translateX(${-cameraX}px)` }}>
        <div className="far-mountains"><i /><i /><i /><i /></div><div className="fortress"><div className="fort-tower left"><b /></div><div className="fort-wall"><b /><b /><b /></div><div className="fort-tower right"><b /></div></div>
        {PLATFORMS.map((p, i) => <div key={i} className="platform-solid" style={{ left: p.x, top: p.y, width: p.w, height: p.h }} />)}
        <div className="flag flag-blue"><Flag size={32} fill="currentColor" /><span>BLAU BASIS</span></div>
        {!hasFlag && redFlagHeldByRef.current === null && <div className="flag flag-red" style={{ left: redFlagX }}><Flag size={32} fill="currentColor" /><span>ROTE FLAGGE</span></div>}
        <div className="ground"><div className="ground-lines" /></div>
        {powerUpState.map((pu) => pu.active && <div key={pu.id} className={`powerup powerup-${pu.type}`} style={{ left: pu.x, top: pu.y }}>{(() => { const Icon = POWERUP_INFO[pu.type].icon; return <Icon size={22} fill="currentColor" />; })()}<div className="powerup-glow" /></div>)}
        {arrows.map((arrow) => <div key={arrow.id} className={`flying-arrow ${arrow.team === 'red' ? 'arrow-red' : 'arrow-blue'}`} style={{ left: arrow.x, top: arrow.y, transform: `rotate(${arrow.angle}deg)` }}><span /></div>)}
        {botState.map((bot) => bot.alive && <BotCharacter key={bot.id} bot={bot} />)}
        {viewMode === 'third' && <Character player={position} weapon={weapon} charging={isCharging} buff={playerBuff} />}
        {hasFlag && viewMode === 'third' && <div className="carried-flag" style={{ left: position.x + 48, top: position.y - 72 }}><Flag size={23} fill="currentColor" /></div>}
      </div>
      {viewMode === 'first' && <FirstPersonWeapon weapon={weapon} charging={isCharging} charge={charge} />}
      <div className="aim-reticle" style={{ ['--reticle' as string]: charge }}><Crosshair size={28} /></div><div className="speed-lines" style={{ opacity: position.dash > 0 ? .9 : 0 }} />
      {hitFlash > 0 && <div className="hit-flash" style={{ opacity: hitFlash * 0.4 }} />}
      <div className="message-banner">{message}</div>
      {playerBuff && <div className="buff-indicator">{(() => { const Icon = POWERUP_INFO[playerBuff.type].icon; return <Icon size={14} />; })()} {POWERUP_INFO[playerBuff.type].label} {Math.ceil(playerBuff.time)}s</div>}
      {roundTransition && <div className="round-transition"><span>{roundTransition}</span></div>}
      <div className="hud-top"><div className="team-score"><span className="blue-chip" /> BLAU <strong>{score.blue.toString().padStart(2, '0')}</strong><i>:</i><strong>{score.red.toString().padStart(2, '0')}</strong> ROT <span className="red-chip" /></div><div className="round-clock">{minutes}:{seconds.toString().padStart(2, '0')} <small>RUNDE {round}/{MAX_ROUNDS}</small></div><div className="view-badge">{viewMode === 'first' ? 'FIRST PERSON' : 'THIRD PERSON'} <kbd>Z</kbd></div></div>
      <div className="hud-left"><div className="health-label"><Heart size={15} fill="currentColor" /> GESUNDHEIT <strong>{playerHp} <small>/ 100</small></strong></div><div className="health-track"><span style={{ width: `${playerHp}%`, background: playerHp < 30 ? '#c6463f' : '#c37456' }} /></div><div className="hud-team"><span /> BLAU TEAM · 2V2</div><div className="bot-roster">{botState.filter((b) => b.team === 'blue').map((b) => <div key={b.id} className={`bot-entry ${b.alive ? '' : 'bot-dead'}`}><i style={{ background: b.color }} />{b.name} {b.alive ? <small>{b.hp} HP</small> : <Skull size={11} />}</div>)}</div></div>
      <div className="hud-right"><div className="weapon-title">AKTIVE WAFFE <kbd>Q</kbd></div><div className="active-weapon"><span>{weapon === 'bow' ? '⌁' : '†'}</span><div><strong>{weapon === 'bow' ? 'BOGEN' : 'SPEER'}</strong><small>{weapon === 'bow' ? 'DISTANZWAFFE' : 'MOVEMENT-WAFFE'}</small></div></div>{weapon === 'bow' ? <div className="charge-meter"><span style={{ width: `${charge * 100}%` }} /><b>SPANNUNG {Math.round(charge * 100)}%</b></div> : <div className="dash-ready"><Zap size={14} /> {position.dash > 0 ? 'RÜCKSLIDE' : 'STOSS BEREIT'}</div>}<div className="bot-roster enemy">{botState.filter((b) => b.team === 'red').map((b) => <div key={b.id} className={`bot-entry ${b.alive ? '' : 'bot-dead'}`}><i style={{ background: b.color }} />{b.name} {b.alive ? <small>{b.hp} HP</small> : <Skull size={11} />}</div>)}</div></div>
      <div className="control-hint"><span><kbd>A</kbd><kbd>D</kbd> bewegen</span><span><kbd>SPACE</kbd> springen</span><span><kbd>LINKSKLICK</kbd> {weapon === 'bow' ? 'spannen / schießen' : 'Speerstoß'}</span><span><kbd>Z</kbd> Ansicht wechseln</span></div>
      <div className="hud-stats"><span><Swords size={13} /> K {playerKills}</span><span><Skull size={13} /> D {playerDeaths}</span></div>
      <div className="kill-feed">{killFeed.map((entry) => <div key={entry.id} className="kill-feed-entry"><span className={entry.killerTeam === 'blue' ? 'kf-blue' : 'kf-red'}>{entry.killer}</span> <Swords size={11} /> <span className={entry.killerTeam === 'blue' ? 'kf-red' : 'kf-blue'}>{entry.victim}</span></div>)}</div>
      <div className="minimap">
        <div className="minimap-bg" />
        <div className="minimap-base minimap-blue" style={{ left: `${(BLUE_BASE_X / WORLD_WIDTH) * 100}%` }} />
        <div className="minimap-base minimap-red" style={{ left: `${(redFlagX / WORLD_WIDTH) * 100}%` }} />
        <div className="minimap-dot minimap-player" style={{ left: `${(position.x / WORLD_WIDTH) * 100}%` }} />
        {botState.map((b) => b.alive && <div key={b.id} className={`minimap-dot minimap-bot-${b.team}`} style={{ left: `${(b.x / WORLD_WIDTH) * 100}%` }} />)}
        {powerUpState.map((pu) => pu.active && <div key={pu.id} className="minimap-dot minimap-powerup" style={{ left: `${(pu.x / WORLD_WIDTH) * 100}%` }} />)}
      </div>
      <div className="objective-banner"><Flag size={15} /> {hasFlag ? 'ZURUECK ZUR BLAUEN BASIS' : redFlagHeldByRef.current !== null ? 'FLAGGE VERLOREN - JAGE!' : 'ERREICHE DIE ROTE FLAGGE'}</div>
      {gameWon && <div className="win-overlay"><div className="win-card"><div className="win-kicker">RUNDE {round} BEENDET</div><Flag size={34} fill="currentColor" /><h1>{gameWon === 'blue' ? 'Blaues Team siegt.' : 'Rotes Team siegt.'}</h1><p>Stand <strong>BLAU {score.blue} : {score.red} ROT</strong></p><button onClick={nextRound}><ChevronRight size={16} /> Nächste Runde</button></div></div>}
      {matchWon && <div className="win-overlay"><div className="win-card match-end"><div className="win-kicker">MATCH BEENDET</div><Trophy size={38} fill="currentColor" /><h1>{matchWon === 'blue' ? 'BLAU GEWINNT!' : 'ROT GEWINNT!'}</h1><p>Endstand <strong>BLAU {score.blue} : {score.red} ROT</strong></p><div className="match-stats"><span><Swords size={14} /> {playerKills} Kills</span><span><Skull size={14} /> {playerDeaths} Deaths</span></div><button onClick={reset}><Play size={16} fill="currentColor" /> Neues Match</button></div></div>}
    </section>
  </main>;
}

function FirstPersonWeapon({ weapon, charging, charge }: { weapon: Weapon; charging: boolean; charge: number }) {
  return <div className={`first-person-weapon ${weapon === 'spear' ? 'first-person-spear' : 'first-person-bow'} ${charging ? 'is-charging' : ''}`}>
    <div className="fp-arm fp-arm-left" /><div className="fp-arm fp-arm-right" />
    {weapon === 'bow' ? <><div className="fp-bow-limb fp-bow-top" /><div className="fp-bow-limb fp-bow-bottom" /><div className="fp-bow-grip" /><div className="fp-bow-string" style={{ transform: `translateX(${charge * 48}px)` }} /><div className="fp-arrow" /></> : <><div className="fp-spear-shaft" /><div className="fp-spear-head" /></>}
  </div>;
}

function Character({ player, weapon, charging, buff }: { player: Player; weapon: Weapon; charging: boolean; buff: ActiveBuff | null }) {
  return <div className={`character character-player ${player.grounded ? '' : 'is-airborne'} ${player.dash > 0 ? 'is-dashing' : ''} ${buff ? `buffed-${buff.type}` : ''}`} style={{ left: player.x, top: player.y, transform: `scaleX(${player.facing})` }}>
    <div className="character-shadow" /><div className="cape" /><div className="character-legs"><i /><i /></div><div className="character-torso"><div className="belt" /><div className="armor-plate" /></div><div className="character-head"><div className="hood"><i /></div><div className="face-shadow" /></div><div className="character-arm back-arm" /><div className={`character-arm front-arm ${charging ? 'drawn' : ''}`} />{weapon === 'bow' ? <div className={`character-bow ${charging ? 'drawn' : ''}`}><i /><b /></div> : <div className="character-spear"><i /><b /></div>}<div className="quiver"><i /><i /><i /></div>
    <div className="name-tag">DU</div>
  </div>;
}

function BotCharacter({ bot }: { bot: Bot }) {
  return <div className={`character character-bot ${bot.team === 'red' ? 'bot-red-team' : 'bot-blue-team'} ${bot.grounded ? '' : 'is-airborne'} ${bot.buff ? `buffed-${bot.buff.type}` : ''} ${bot.invuln > 0 ? 'invuln' : ''}`} style={{ left: bot.x, top: bot.y, transform: `scaleX(${bot.facing})` }}>
    <div className="character-shadow" /><div className="cape bot-cape" /><div className="character-legs"><i /><i /></div><div className="character-torso"><div className="belt" /><div className="armor-plate" /></div><div className="character-head"><div className="hood bot-hood"><i /></div><div className="face-shadow" /></div><div className="character-arm back-arm" /><div className="character-arm front-arm" />{bot.weapon === 'bow' ? <div className="character-bow"><i /><b /></div> : <div className="character-spear"><i /><b /></div>}<div className="quiver"><i /><i /><i /></div>
    <div className="bot-hp-bar"><span style={{ width: `${bot.hp}%`, background: bot.team === 'red' ? '#bb6553' : '#72aeb1' }} /></div>
    <div className="name-tag bot-name" style={{ color: bot.color }}>{bot.name}</div>
    {bot.hasFlag && <div className="carried-flag" style={{ left: 48, top: -72 }}><Flag size={20} fill="currentColor" /></div>}
  </div>;
}

export default App;
