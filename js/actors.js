/* ================= 角色：玩家 与 影子 ================= */
"use strict";

var Player = {
  x: 0, y: 0, r: 11,
  face: -Math.PI / 2,
  stamina: 100,
  hidden: false,
  hidingProp: null,
  moving: false,
  running: false,
  stepTimer: 0,
  noiseTimer: 0,
  breatheTimer: 0,

  reset: function (px, py) {
    this.x = px; this.y = py;
    this.face = -Math.PI / 2;
    this.stamina = 100;
    this.hidden = false;
    this.hidingProp = null;
    this.stepTimer = 0;
    this.noiseTimer = 0;
    this.breatheTimer = 0;
  },

  update: function (dt, g) {
    if (this.hidden) {
      this.moving = false;
      this.running = false;
      this.stamina = Math.min(100, this.stamina + 26 * dt);
      this.breatheTimer -= dt;
      if (this.breatheTimer <= 0) {
        this.breatheTimer = 3.6 + Math.random() * 2;
        AudioSys.breath();
      }
      return;
    }

    var v = Input.vector();
    var wantRun = Input.wantsRun() && (v.x !== 0 || v.y !== 0);
    var canRun = this.stamina > 1;
    var running = wantRun && canRun;

    this.moving = !!(v.x || v.y);
    this.running = running && this.moving;

    if (this.moving) this.face = Math.atan2(v.y, v.x);

    var speed = running ? CFG.PLAYER_RUN : CFG.PLAYER_SPEED;
    if (g.slowWalk) speed *= 0.62;

    if (this.moving) {
      var dx = v.x * speed * dt, dy = v.y * speed * dt;
      var np = World.moveCircle(this.x, this.y, this.r, dx, dy);
      // 走路推进的"摩擦感"：贴墙滑动后仍算移动
      this.x = np.x; this.y = np.y;
    }

    // 体力
    if (running && this.moving) {
      this.stamina = Math.max(0, this.stamina - CFG.STAMINA_DRAIN * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + CFG.STAMINA_REGEN * dt);
    }

    // 脚步声与噪音
    if (this.moving) {
      this.stepTimer -= dt;
      this.noiseTimer -= dt;
      var interval = running ? 0.27 : 0.46;
      if (this.stepTimer <= 0) {
        this.stepTimer = interval;
        AudioSys.step(running, false);
        if (running) AudioSys.step(true, false);
      }
      if (this.noiseTimer <= 0) {
        this.noiseTimer = running ? 0.3 : 0.62;
        g.emitNoise(this.x, this.y, running ? CFG.NOISE_RUN : CFG.NOISE_WALK, running);
      }
    } else {
      this.stepTimer = 0;
      this.noiseTimer = 0;
    }
  },

  hide: function (prop) {
    this.hidden = true;
    this.hidingProp = prop;
    this.x = prop.px;
    this.y = prop.py;
    prop.hiddenInside = true;
  },

  unhide: function () {
    var p = this.hidingProp;
    if (p) {
      // 从柜子旁边出来
      var dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      var T = CFG.TILE;
      for (var i = 0; i < dirs.length; i++) {
        var nx = p.px + dirs[i][0] * (T + 10);
        var ny = p.py + dirs[i][1] * (T + 10);
        if (!World.circleHits(nx, ny, this.r)) { this.x = nx; this.y = ny; break; }
      }
      p.hiddenInside = false;
    }
    this.hidden = false;
    this.hidingProp = null;
  }
};

/* ================= 影子 ================= */
var Ghost = {
  x: 0, y: 0, r: 13,
  active: false,
  state: "sleep",
  path: [], pathI: 0,
  repathT: 0,
  perceiveT: 0,
  target: { x: 0, y: 0 },
  lastSeen: { x: 0, y: 0 },
  lostT: 0,
  searchT: 0,
  trail: [],
  trailT: 0,
  spawnX: 0, spawnY: 0,
  huntProp: null,
  huntT: 0,
  freezeT: 0,
  stuckT: 0,
  lastX: 0, lastY: 0,
  waypoint: null,

  spawn: function (px, py) {
    this.x = px; this.y = py;
    this.spawnX = px; this.spawnY = py;
    this.active = false;
    this.state = "sleep";
    this.path = [];
    this.trail = [];
    this.huntProp = null;
    this.freezeT = 0;
  },

  wake: function () {
    this.active = true;
    this.state = "patrol";
    this.path = [];
    this.waypoint = null;
  },

  speedOf: function (g) {
    var heat = g.live.heat;
    if (this.state === "chase") return CFG.GHOST_CHASE + heat * 0.34;
    if (this.state === "hunt") return CFG.GHOST_CHASE * 0.92 + heat * 0.26;
    if (this.state === "alert" || this.state === "search") return CFG.GHOST_SEARCH + heat * 0.2;
    return CFG.GHOST_PATROL + heat * 0.14;
  },

  sightRange: function (g) {
    var r = CFG.GHOST_SIGHT + g.live.heat * 0.55;
    if (!g.player.hidden) r += g.lightOn ? 80 : -50;
    return r;
  },

  hear: function (g, evt) {
    if (!this.active) return;
    var dx = evt.x - this.x, dy = evt.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > evt.r) return;
    if (this.state === "chase" || this.state === "hunt") return;
    this.target.x = evt.x; this.target.y = evt.y;
    if (this.state !== "alert") {
      this.state = "alert";
      this.path = [];
    }
    this.alertT = 8;
  },

  /* 它看见你躲进去了 */
  witnessedHide: function (g, prop) {
    if (!this.active) return;
    this.huntProp = prop;
    this.huntT = 0;
    this.state = "hunt";
    this.path = [];
    this.target.x = prop.px; this.target.y = prop.py;
    prop.danger = true;
    prop.dangerT = 0;
  },

  update: function (dt, g) {
    if (!this.active) return;
    var p = g.player;

    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.18;
      this.perceive(g);
    }

    // 状态处理
    switch (this.state) {
      case "patrol":
        if (!this.path.length) this.pickWaypoint(g);
        break;
      case "alert":
        this.alertT -= dt;
        if (this.alertT <= 0) { this.state = "patrol"; this.path = []; }
        break;
      case "chase":
        break;
      case "search":
        this.searchT -= dt;
        if (this.searchT <= 0) { this.state = "patrol"; this.path = []; }
        break;
      case "hunt":
        var hp = this.huntProp;
        if (!hp) { this.state = "chase"; break; }
        var dxh = hp.px - this.x, dyh = hp.py - this.y;
        var dh = Math.sqrt(dxh * dxh + dyh * dyh);
        if (dh < 46) {
          this.huntT += dt;
          if (this.huntT > 1.4) g.die("它拉开了柜门");
        } else {
          this.huntT = 0;
          this.target.x = hp.px; this.target.y = hp.py;
          this.repathT -= dt;
          if (!this.path.length || this.repathT <= 0) {
            this.path = World.findPath(this.x, this.y, hp.px, hp.py);
            this.pathI = 0;
            this.repathT = 0.4;
          }
        }
        break;
    }

    // 追逐时持续重算路径
    if (this.state === "chase") {
      this.repathT -= dt;
      if (!this.path.length || this.repathT <= 0) {
        this.path = World.findPath(this.x, this.y, p.x, p.y);
        this.pathI = 0;
        this.repathT = 0.32;
      }
    }

    // 刚发现你的那一瞬：它会停住，直直地看着你
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.trail.length = 0;
      return;
    }

    this.moveAlong(dt, g);

    // 追逐 -> 丢失
    if (this.state === "chase" && this.lostT > 2.6) {
      this.state = "search";
      this.searchT = 6.5;
      this.path = World.findPath(this.x, this.y, this.lastSeen.x, this.lastSeen.y);
      this.pathI = 0;
    }

    // 拖影
    this.trailT -= dt;
    if (this.trailT <= 0 && this.state === "chase") {
      this.trailT = 0.05;
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 6) this.trail.pop();
    } else if (this.state !== "chase" && this.trail.length) {
      this.trail.pop();
    }

    // 卡住检测
    var moved = Math.abs(this.x - this.lastX) + Math.abs(this.y - this.lastY);
    this.lastX = this.x; this.lastY = this.y;
    if (moved < 0.6) {
      this.stuckT += dt;
      if (this.stuckT > 1.4) {
        this.stuckT = 0;
        this.path = [];
        if (this.state === "patrol") this.waypoint = null;
      }
    } else this.stuckT = 0;

    // 抓到
    var dx = p.x - this.x, dy = p.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!p.hidden && d < CFG.GHOST_CATCH) g.die("它碰到了你的肩膀");
  },

  perceive: function (g) {
    var p = g.player;
    if (!p.hidden) {
      var dx = p.x - this.x, dy = p.y - this.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var sight = this.sightRange(g);
      if (d < sight && World.los(this.x, this.y, p.x, p.y)) {
        var wasChasing = this.state === "chase";
        this.state = "chase";
        this.lostT = 0;
        this.lastSeen.x = p.x; this.lastSeen.y = p.y;
        this.huntProp = null;
        if (!wasChasing) {
          // 首帧察觉：停顿 + 提示音，给玩家反应时间
          this.freezeT = 0.55;
          this.path = [];
          if (!this.spotSoundT || g.time - this.spotSoundT > 2.5) {
            this.spotSoundT = g.time;
            AudioSys.stinger("see", 0.85);
            g.shake = Math.min(1, g.shake + 0.5);
          }
        }
        if (g.hideWitnessed) { g.hideWitnessed = false; }
        // 发现瞬间：心跳音效由游戏层处理
      } else if (this.state === "chase") {
        this.lostT += 0.18;
      }
    } else {
      // 玩家躲在柜子里：只有被"看见"过才会来找
      if (this.state === "chase" || this.state === "hunt") {
        this.lostT += 0.18;
      }
    }
  },

  moveAlong: function (dt, g) {
    if (!this.path.length) {
      // hunt 时直着走
      if (this.state === "hunt" && this.huntProp) {
        var dx = this.huntProp.px - this.x, dy = this.huntProp.py - this.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 30) {
          var sp = this.speedOf(g) * dt;
          this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
        }
      }
      return;
    }
    var node = this.path[this.pathI];
    if (!node) { this.path = []; return; }
    var dx = node.x - this.x, dy = node.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var sp = this.speedOf(g) * dt;
    if (d < sp) {
      this.stepTo(node.x, node.y);
      this.pathI++;
      if (this.pathI >= this.path.length) this.path = [];
    } else {
      this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
    }
  },

  stepTo: function (nx, ny) {
    var np = World.moveCircle(this.x, this.y, this.r, nx - this.x, ny - this.y);
    this.x = np.x; this.y = np.y;
  },

  pickWaypoint: function (g) {
    var pts = [
      { x: 10 * 32, y: 19 * 32 },
      { x: 25 * 32, y: 19 * 32 },
      { x: 40 * 32, y: 19 * 32 },
      { x: 55 * 32, y: 19 * 32 },
      { x: 10 * 32, y: 9 * 32 },
      { x: 25 * 32, y: 9 * 32 },
      { x: 40 * 32, y: 9 * 32 },
      { x: 55 * 32, y: 8 * 32 },
      { x: 9 * 32, y: 30 * 32 },
      { x: 55 * 32, y: 30 * 32 }
    ];
    var best = null, bestD = -1;
    for (var i = 0; i < 6; i++) {
      var c = pts[Math.floor(Math.random() * pts.length)];
      var dx = c.x - this.x, dy = c.y - this.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > bestD && d > 160) { bestD = d; best = c; }
    }
    if (!best) best = pts[0];
    this.waypoint = best;
    this.target.x = best.x; this.target.y = best.y;
    this.path = World.findPath(this.x, this.y, best.x, best.y);
    this.pathI = 0;
  }
};
