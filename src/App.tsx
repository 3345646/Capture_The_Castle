import { useEffect, useRef, useState } from "react";
import { Game, type HudState } from "./game/Game";

const initialHud: HudState = {
  health: 100,
  maxHealth: 100,
  weapon: "sword",
  arrows: 30,
  draw: 0,
  points: [],
  allies: 0,
  enemies: 0,
  kills: 0,
  status: "playing",
  respawn: 0,
  message: "",
  hitFlash: 0,
  damageFlash: 0,
  time: 0,
  gateHp: 900,
  gateMaxHp: 900,
  gateNear: false,
  gateDown: false,
  enemyWave: 12,
  enemyReserve: 26,
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-3 w-48 overflow-hidden rounded-sm border border-black/50 bg-black/50">
      <div className={`h-full ${color} transition-all`} style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(initialHud);
  const [started, setStarted] = useState(false);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!started || !mountRef.current) return;
    const game = new Game(mountRef.current, setHud);
    game.minimap = miniRef.current;
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, [started, seed]);

  const restart = () => {
    setHud(initialHud);
    setStarted(false);
    setSeed((s) => s + 1);
    setTimeout(() => setStarted(true), 50);
  };

  const mins = Math.floor(hud.time / 60);
  const secs = Math.floor(hud.time % 60);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black font-sans text-white select-none">
      <div ref={mountRef} className="absolute inset-0" />

      {/* damage / hit flashes */}
      <div
        className="pointer-events-none absolute inset-0 bg-red-700"
        style={{ opacity: hud.damageFlash * 0.6 }}
      />

      {started && hud.status === "playing" && (
        <>
          {/* crosshair */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-6 w-6">
              <div
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: hud.hitFlash > 0 ? "#ff4444" : "rgba(255,255,255,0.85)" }}
              />
              {hud.weapon === "bow" && hud.draw > 0 && (
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
                  style={{ width: `${30 - hud.draw * 22}px`, height: `${30 - hud.draw * 22}px` }}
                />
              )}
            </div>
          </div>

          {/* objectives top bar */}
          <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 gap-2">
            {hud.points.map((p) => {
              const pct = ((p.progress + 1) / 2) * 100;
              return (
                <div
                  key={p.id}
                  className={`w-28 rounded border px-2 py-1 text-center backdrop-blur-sm ${
                    p.contested ? "border-yellow-300 bg-yellow-500/20" : "border-white/25 bg-black/45"
                  }`}
                >
                  <div className="text-sm font-bold tracking-wider">{p.id}</div>
                  <div className="truncate text-[10px] uppercase tracking-wide opacity-75">{p.name}</div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-red-900/70">
                    <div className="h-full bg-blue-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* gate health */}
          {hud.gateNear && !hud.gateDown && (
            <div className="pointer-events-none absolute left-1/2 top-28 w-80 -translate-x-1/2 text-center">
              <div className="text-sm font-bold uppercase tracking-widest text-amber-200 drop-shadow">
                🚪 Castle Gate — break it down!
              </div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded border border-black/60 bg-black/60">
                <div
                  className="h-full bg-gradient-to-r from-amber-700 to-amber-400 transition-all"
                  style={{ width: `${(hud.gateHp / hud.gateMaxHp) * 100}%` }}
                />
              </div>
              <div className="text-xs text-white/70">
                {hud.gateHp} / {hud.gateMaxHp}
              </div>
            </div>
          )}

          {/* message */}
          {hud.message && (
            <div className="pointer-events-none absolute left-1/2 top-32 -translate-x-1/2 rounded bg-black/60 px-4 py-2 text-lg font-semibold text-amber-200 shadow">
              {hud.message}
            </div>
          )}

          {/* bottom-left status */}
          <div className="pointer-events-none absolute bottom-4 left-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-14 text-xs uppercase tracking-widest opacity-70">Health</span>
              <Bar value={hud.health} max={hud.maxHealth} color="bg-red-500" />
              <span className="text-sm font-semibold">{hud.health}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span
                className={`rounded px-2 py-0.5 ${
                  hud.weapon === "sword" ? "bg-amber-400 text-black" : "bg-black/50"
                }`}
              >
                1 · Sword
              </span>
              <span
                className={`rounded px-2 py-0.5 ${
                  hud.weapon === "bow" ? "bg-amber-400 text-black" : "bg-black/50"
                }`}
              >
                2 · Bow ({hud.arrows})
              </span>
            </div>
          </div>

          {/* bottom-right minimap + counts */}
          <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
            <div className="flex gap-3 rounded bg-black/50 px-3 py-1 text-sm">
              <span className="text-sky-300">Allies {hud.allies}</span>
              <span className="text-red-300">Enemies {hud.enemies}</span>
              <span className="text-amber-200">Kills {hud.kills}</span>
              <span className="text-orange-300">
                Wave {Math.ceil(hud.enemyWave)}s · Reserve {hud.enemyReserve}
              </span>
              <span className="opacity-70">
                {mins}:{secs.toString().padStart(2, "0")}
              </span>
            </div>
            <canvas
              ref={miniRef}
              width={170}
              height={170}
              className="rounded border border-white/25"
            />
          </div>

          {hud.respawn > 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <div className="text-3xl font-bold text-red-400">You have fallen</div>
                <div className="mt-2 text-lg">Respawning in {hud.respawn.toFixed(1)}s</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* victory */}
      {started && hud.status === "won" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="max-w-md rounded-xl border border-amber-400/40 bg-gradient-to-b from-amber-950/80 to-black p-8 text-center">
            <div className="text-5xl">🏰</div>
            <h1 className="mt-3 text-4xl font-black text-amber-300">CASTLE TAKEN</h1>
            <p className="mt-2 text-white/80">
              Every flag flies your colours. The keep has fallen.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded bg-white/10 p-2">
                <div className="text-xl font-bold">{hud.kills}</div>
                <div className="opacity-70">Kills</div>
              </div>
              <div className="rounded bg-white/10 p-2">
                <div className="text-xl font-bold">
                  {mins}:{secs.toString().padStart(2, "0")}
                </div>
                <div className="opacity-70">Time</div>
              </div>
              <div className="rounded bg-white/10 p-2">
                <div className="text-xl font-bold">{hud.points.length}</div>
                <div className="opacity-70">Flags</div>
              </div>
            </div>
            <button
              onClick={restart}
              className="mt-6 rounded-lg bg-amber-400 px-6 py-2 font-bold text-black hover:bg-amber-300"
            >
              Raid Again
            </button>
          </div>
        </div>
      )}

      {/* start screen */}
      {!started && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-slate-900 via-stone-900 to-black p-6">
          <div className="max-w-2xl rounded-2xl border border-amber-500/30 bg-black/50 p-8 shadow-2xl">
            <div className="text-center">
              <div className="text-5xl">⚔️🏰</div>
              <h1 className="mt-3 text-5xl font-black tracking-tight text-amber-300">
                SIEGE OF BLACKSTONE KEEP
              </h1>
              <p className="mt-2 text-white/70">
                Lead your warband through the gate, cut down the garrison, and raise your banner over
                all four capture points.
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-white/80">
              <div><b className="text-amber-200">WASD</b> — move</div>
              <div><b className="text-amber-200">Mouse</b> — look</div>
              <div><b className="text-amber-200">Shift</b> — sprint</div>
              <div><b className="text-amber-200">Space</b> — jump</div>
              <div><b className="text-amber-200">1 / 2 / Q</b> — sword / bow</div>
              <div><b className="text-amber-200">Left Click</b> — swing / hold to draw</div>
              <div><b className="text-amber-200">Esc</b> — release mouse</div>
              <div><b className="text-amber-200">Stairs & ramp</b> — reach the walls</div>
            </div>
            <ul className="mt-5 space-y-1 text-sm text-white/70">
              <li>• The <b className="text-amber-200">castle gate is barred</b> — hack it with your sword (or shoot it) until it splinters. Your warband will help. Or flank via the siege ramp on the east wall.</li>
              <li>• Stand inside a flag ring to capture it — more troops means faster capture.</li>
              <li>• Defenders <b className="text-amber-200">respawn in waves</b> from their deepest flag until their reserve of men runs dry.</li>
              <li>• Blue allies spawn from your furthest captured flag; red defenders reinforce the keep.</li>
              <li>• Headshots with the longbow deal double damage.</li>
            </ul>
            <div className="mt-7 text-center">
              <button
                onClick={() => setStarted(true)}
                className="rounded-xl bg-amber-400 px-10 py-3 text-lg font-black text-black shadow-lg hover:bg-amber-300"
              >
                BEGIN THE RAID
              </button>
              <p className="mt-2 text-xs text-white/50">Click the game view to lock the mouse.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
