/* ================= 游戏主控 ================= */
"use strict";

var Game = {
  state: "title",
  inGame: false,
  time: 0,
  dt: 0,
  last: 0,
  cam: { x: 0, y: 0 },
  player: Player,
  ghost: Ghost,
  live: Live,
  clues: { tape: false, letter: false, phone: false },
  clueCount: 0,
  lightOn: true,
  lightFlicker: false,
  flickerT: 0,
  flashRed: 0,
  shake: 0,
  target: null,
  noises: [],
  slowWalk: false,
  heartT: 0,
  checkpoint: { x: 0, y: 0 },
  curRoom: null,
  roomNameT: 0,
  ghostWoken: false,
  deadReason: "",
  busy: false,
  pauseEl: null,
  toastT: null,
  roomT: null,

  /* ================= 启动 ================= */
  init: function () {
    this.cv = document.getElementById("view");
    Renderer.init(this.cv);
    World.build();
    Renderer.bake();
    Live.initDom();
    Input.init();
    this.bindUi();
    this.buildPauseEl();
    this.fitCanvas();
    var self = this;
    window.addEventListener("resize", function () { self.fitCanvas(); });
    this.last = performance.now();
    requestAnimationFrame(function (ts) { self.loop(ts); });
  },

  fitCanvas: function () {
    var w = window.innerWidth, h = window.innerHeight;
    var aspect = w / h;
    var vw, vh;
    if (aspect >= 1) {
      vh = 540;
      vw = Math.round(Math.min(1180, 540 * aspect));
    } else {
      vw = 540;
      vh = Math.round(Math.min(1200, 540 / aspect));
    }
    if (vw !== CFG.VIEW_W || vh !== CFG.VIEW_H) {
      Renderer.setViewSize(vw, vh);
    }
    var scale = Math.min(w / CFG.VIEW_W, h / CFG.VIEW_H);
    this.cv.style.width = Math.floor(CFG.VIEW_W * scale) + "px";
    this.cv.style.height = Math.floor(CFG.VIEW_H * scale) + "px";
  },

  bindUi: function () {
    var self = this;
    var on = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", function (e) {
        e.preventDefault();
        AudioSys.resume();
        AudioSys.ui();
        fn();
      });
    };
    on("btnStart", function () { self.startRun(); });
    on("btnDocClose", function () { self.closeDoc(); });
    on("btnRetry", function () { self.retry(); });
    on("btnGiveUp", function () { self.toTitle(); });
    on("btnPublish", function () { self.showEnding("good"); });
    on("btnDelete", function () { self.showEnding("bad"); });
    on("btnEndBack", function () { self.toTitle(); });
  },

  buildPauseEl: function () {
    var d = document.createElement("div");
    d.className = "overlay dark hidden";
    d.id = "pauseScreen";
    d.innerHTML = '<div class="title-wrap"><div class="ending-label">暂停</div>' +
      '<p class="choice-body">直播还在继续，观众在等你回来。<br><br>按 ESC 继续。</p></div>';
    document.getElementById("app").appendChild(d);
    this.pauseEl = d;
  },

  /* ================= 开关局 ================= */
  startRun: function () {
    AudioSys.resume();
    AudioSys.startAmbience();

    this.hideAllOverlays();
    this.clues = { tape: false, letter: false, phone: false };
    this.clueCount = 0;
    this.lightOn = true;
    this.flashRed = 0;
    this.shake = 0;
    this.noises = [];
    this.curRoom = null;
    this.ghostWoken = false;
    this.busy = false;

    // 玩家出生在一层大厅门口
    var sx = 10.5 * CFG.TILE, sy = 13 * CFG.TILE;
    this.player.reset(sx, sy);
    this.checkpoint = { x: sx, y: sy };

    // 影子沉睡在体育器材室
    this.ghost.spawn(9 * CFG.TILE, 30 * CFG.TILE);

    this.live.reset();
    this.updateClueUi();
    this.updateObjective();
    Input.clear();
    this.heatHinted = false;

    this.cam.x = this.clampCamX(sx - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(sy - CFG.VIEW_H / 2);

    this.state = "play";
    this.inGame = true;
    this.roomNameT = 0;
    this.showRoom("一层大厅入口");
    var self = this;
    setTimeout(function () {
      if (self.inGame) self.toast("23:47 · 一层大厅", "找到 3 件线索，然后去北侧楼梯间");
    }, 700);
  },

  toTitle: function () {
    this.state = "title";
    this.inGame = false;
    AudioSys.ambienceLevel(0);
    this.hideAllOverlays();
    document.getElementById("titleScreen").classList.remove("hidden");
  },

  hideAllOverlays: function () {
    ["titleScreen", "docScreen", "deadScreen", "endingScreen", "choiceScreen"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    if (this.pauseEl) this.pauseEl.classList.add("hidden");
  },

  togglePause: function () {
    if (this.state === "play") {
      this.state = "paused";
      this.pauseEl.classList.remove("hidden");
    } else if (this.state === "paused") {
      this.state = "play";
      this.pauseEl.classList.add("hidden");
      this.last = performance.now();
    }
  },

  /* ================= 主循环 ================= */
  loop: function (ts) {
    var dt = (ts - this.last) / 1000;
    this.last = ts;
    if (dt > 0.06) dt = 0.06;
    if (dt < 0) dt = 0;
    this.dt = dt;

    if (this.state === "play" || this.state === "title") {
      this.time += dt;
    }

    if (this.state === "play") this.update(dt);
    else if (this.state === "title") this.updateIdle(dt);

    if (this.inGame) Renderer.draw(this);
    else this.drawTitleBg();

    var self = this;
    requestAnimationFrame(function (t) { self.loop(t); });
  },

  drawTitleBg: function () {
    // 标题界面静态黑底，避免闪烁
    var c = Renderer.ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#050505";
    c.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
  },

  updateIdle: function (dt) {
    // 标题界面也让弹幕滚动
    this.live.update(dt, this);
  },

  update: function (dt) {
    var p = this.player, g = this.ghost;

    p.update(dt, this);

    // 互动目标
    if (!p.hidden) {
      this.target = World.nearestProp(p.x, p.y, 52);
    } else {
      this.target = p.hidingProp;
    }
    this.updatePrompt();

    // 动作
    if (Input.takeAction()) this.doAction();
    if (Input.takeLive()) this.live.toggle(this);
    if (Input.keys["f"] && !this.fKeyLock) {
      this.fKeyLock = true;
      this.lightOn = !this.lightOn;
      this.toast(this.lightOn ? "手电筒：开" : "手电筒：关", this.lightOn ? "" : "看不见路，但它也很难发现你", 1800);
      AudioSys.step(false, false);
    }
    if (!Input.keys["f"]) this.fKeyLock = false;

    g.update(dt, this);
    this.live.update(dt, this);

    // 房间变化
    var room = World.roomAt(p.x, p.y);
    if (room && (!this.curRoom || room.id !== this.curRoom.id)) {
      this.curRoom = room;
      this.checkpoint = { x: p.x, y: p.y };
      this.showRoom(room.name);
      if (this.ghostWoken) this.live.say(room.name + "……进这里干嘛", "hot");
    }

    // 摄像机
    var tx = this.clampCamX(p.x - CFG.VIEW_W / 2);
    var ty = this.clampCamY(p.y - CFG.VIEW_H / 2);
    var k = Math.min(1, dt * 9);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;

    // 近距离心跳
    if (g.active) {
      var dx = p.x - g.x, dy = p.y - g.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 340) {
        var near = 1 - d / 340;
        this.heartT -= dt;
        if (this.heartT <= 0) {
          this.heartT = Math.max(0.42, 1.35 - near * 1.0);
          AudioSys.heart(0.5 + near);
          if (near > 0.55 && Math.random() < 0.4) AudioSys.breath();
          this.shake = Math.min(1, this.shake + near * 0.05);
        }
      }
      // 灯管闪烁
      this.flickerT -= dt;
      if (this.flickerT <= 0) {
        this.flickerT = 2.2 + Math.random() * 4;
        this.lightFlicker = Math.random() < (0.15 + this.live.heat / 260);
        var self = this;
        setTimeout(function () { self.lightFlicker = false; }, 90 + Math.random() * 160);
      }
    }

    // 消散效果
    this.flashRed = Math.max(0, this.flashRed - dt * 0.9);
    this.shake = Math.max(0, this.shake - dt * 0.85);
    Renderer.shake = this.shake;

    AudioSys.ambienceLevel(this.live.heat / 100);

    // 热度第一次飙升时的提示
    if (!this.heatHinted && this.live.heat > 62) {
      this.heatHinted = true;
      this.toast("热度上来了", "人越多，它越兴奋 —— 按 L 可以关播降温", 3200);
    }

    // 噪音列表清理
    for (var i = this.noises.length - 1; i >= 0; i--) {
      this.noises[i].ttl -= dt;
      if (this.noises[i].ttl <= 0) this.noises.splice(i, 1);
    }
  },

  clampCamX: function (x) {
    return Math.max(0, Math.min(CFG.MAP_W * CFG.TILE - CFG.VIEW_W, x));
  },
  clampCamY: function (y) {
    return Math.max(0, Math.min(CFG.MAP_H * CFG.TILE - CFG.VIEW_H, y));
  },

  /* ================= 噪音 ================= */
  emitNoise: function (x, y, r, strong) {
    if (this.ghost.active) this.ghost.hear(this, { x: x, y: y, r: r });
    this.noises.push({ x: x, y: y, r: r, ttl: 0.5 });
    if (this.noises.length > 24) this.noises.shift();
  },

  /* ================= 互动 ================= */
  updatePrompt: function () {
    var el = document.getElementById("prompt");
    if (!el) return;
    var p = this.player;
    if (p.hidden) {
      var txt = "<b>空格</b> / 互动：钻出来";
      if (p.hidingProp && p.hidingProp.danger) txt = "它就在柜门外 —— <b>空格</b> 出来跑！";
      el.innerHTML = txt;
      el.classList.remove("hidden");
      return;
    }
    var t = this.target;
    if (!t) { el.classList.add("hidden"); return; }
    var label = t.label || "互动";
    var key = Input.touchMode ? "互动" : "空格";
    if (t.clue) {
      if (this.clues[t.clue]) { el.classList.add("hidden"); return; }
      el.innerHTML = "<b>" + key + "</b> " + label;
    } else if (t.t === "exit") {
      el.innerHTML = "<b>" + key + "</b> " + label;
    } else if (t.hide) {
      el.innerHTML = "<b>" + key + "</b> " + label;
    } else {
      el.innerHTML = "<b>" + key + "</b> " + label;
    }
    el.classList.remove("hidden");
  },

  doAction: function () {
    var p = this.player, t = this.target;
    if (this.state !== "play") return;

    if (p.hidden) {
      var prop = p.hidingProp;
      // 它正在外面等着：起身即立刻进入搜索
      p.unhide();
      AudioSys.hide(false);
      this.flashRed = 0.25;
      this.emitNoise(p.x, p.y, CFG.NOISE_ACT, true);
      if (prop) { prop.danger = false; }
      this.ghost.huntProp = null;
      if (this.ghost.state === "hunt") {
        this.ghost.state = "chase";
        this.ghost.path = [];
      }
      return;
    }

    if (!t) return;

    if (t.clue) {
      if (this.clues[t.clue]) return;
      this.collectClue(t);
      return;
    }
    if (t.t === "exit") {
      if (this.clueCount >= 3) this.openChoice();
      else {
        AudioSys.stinger("locker", 0.6);
        this.toast("门上着锁", "先把三件线索找齐（" + this.clueCount + "/3）");
      }
      return;
    }
    if (t.hide) {
      this.doHide(t);
      return;
    }
    if (t.decor) {
      this.sayFlavor(t);
      return;
    }
  },

  doHide: function (prop) {
    var p = this.player, g = this.ghost;
    // 它有没有看见你躲进去？
    var seen = false;
    if (g.active) {
      var dx = p.x - g.x, dy = p.y - g.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < Math.min(g.sightRange(this), 260) && World.los(g.x, g.y, p.x, p.y)) seen = true;
    }
    p.hide(prop);
    AudioSys.hide(true);
    this.emitNoise(p.x, p.y, CFG.NOISE_ACT * 0.7, true);
    prop.danger = false;

    if (seen) {
      g.witnessedHide(this, prop);
      AudioSys.stinger("locker", 1);
      this.toast("它看见你躲进去了", "快出来！躲着只会让它找上门", 2600);
      this.live.say("它看见了！！", "panic");
      this.live.addHeat(6);
    } else {
      this.toast("别出声", "空格 / 互动 起身", 2200);
    }
  },

  collectClue: function (prop) {
    var key = prop.clue;
    var clue = CLUES[key];
    this.clues[key] = true;
    this.clueCount++;
    AudioSys.pickup();
    this.live.event("clue");
    this.updateClueUi();
    this.updateObjective();
    this.toast(clue.toast, "", 2400);
    this.showDoc(key);

    if (!this.ghostWoken) {
      this.ghostWoken = true;
      var self = this;
      this.pendingWake = true;
    }
  },

  showDoc: function (key) {
    var c = CLUES[key];
    this.state = "doc";
    document.getElementById("docKind").textContent = "线索 " + c.order + " / 3";
    document.getElementById("docTitle").textContent = c.title;
    var body = c.body.map(function (p) { return "<p>" + p + "</p>"; }).join("");
    document.getElementById("docBody").innerHTML = body;
    document.getElementById("docBody").scrollTop = 0;
    document.getElementById("docScreen").classList.remove("hidden");
    AudioSys.resume();
  },

  closeDoc: function () {
    document.getElementById("docScreen").classList.add("hidden");
    this.state = "play";
    this.last = performance.now();
    Input.clear();
    if (this.pendingWake) {
      this.pendingWake = false;
      this.wakeGhost();
    }
  },

  wakeGhost: function () {
    if (this.ghost.active) return;
    this.ghost.wake();
    AudioSys.stinger("wake");
    this.live.event("wake");
    var self = this;
    setTimeout(function () {
      if (self.inGame && self.state === "play") {
        self.toast("她醒了", "器材室的门自己开了");
      }
    }, 900);
    this.shake = 0.6;
  },

  sayFlavor: function (prop) {
    var map = {
      board: STORY.flavor.board,
      banner: STORY.flavor.banner,
      sink: STORY.flavor.sink,
      box: STORY.flavor.box,
      counter: ""
    };
    var txt = map[prop.t] || "没什么特别的。";
    // 走廊照片
    if (prop.t === "board" && prop.x === 14) txt = STORY.flavor.wallPhoto;
    if (prop.t === "banner" && prop.x === 7) txt = STORY.flavor.reward;
    if (prop.t === "box") txt = STORY.flavor.box;
    this.toast("", txt, 4200);
  },

  /* ================= 死亡 / 复活 ================= */
  die: function (reason) {
    if (this.state !== "play") return;
    this.state = "dead";
    this.deadReason = reason || "";
    this.flashRed = 1;
    this.shake = 1.4;
    Renderer.shake = 1.4;
    AudioSys.stinger("dead");
    if (this.live.on) this.live.viewers += 120 + this.live.heat * 3;
    this.live.event("death");
    this.emitNoise(this.player.x, this.player.y, 400, true);

    var dv = document.getElementById("deadViewers");
    if (dv) dv.textContent = Math.floor(this.live.viewers).toLocaleString("en-US");

    var chatBox = document.getElementById("deadChat");
    if (chatBox) {
      var lines = STORY.deadChat.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 5);
      chatBox.innerHTML = lines.map(function (l) {
        return '<div>' + l + "</div>";
      }).join("");
    }

    var self = this;
    setTimeout(function () {
      if (self.state !== "dead") return;
      var el = document.getElementById("deadScreen");
      if (el) el.classList.remove("hidden");
      self.live.sayPool("death");
      self.live.sayPool("death");
    }, 850);
  },

  retry: function () {
    var cp = this.checkpoint || { x: 10.5 * CFG.TILE, y: 13 * CFG.TILE };
    this.hideAllOverlays();
    this.player.reset(cp.x, cp.y);
    this.player.stamina = 100;

    var g = this.ghost;
    g.x = g.spawnX; g.y = g.spawnY;
    g.path = []; g.pathI = 0; g.trail = []; g.huntProp = null;
    g.state = this.ghostWoken ? "patrol" : "sleep";
    g.active = this.ghostWoken;
    g.stuckT = 0;
    g.freezeT = 0;

    for (var i = 0; i < World.props.length; i++) {
      World.props[i].danger = false;
      World.props[i].hiddenInside = false;
    }

    this.target = null;
    this.curRoom = World.roomAt(cp.x, cp.y);
    this.live.heat = Math.min(this.live.heat, 30);
    this.cam.x = this.clampCamX(cp.x - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(cp.y - CFG.VIEW_H / 2);
    this.flashRed = 0;
    this.shake = 0;
    this.state = "play";
    this.last = performance.now();
    this.updatePrompt();
    Input.clear();
    this.toast("重新连接", "它记住了你的味道，但没记住你从哪来", 2600);
  },

  /* ================= 天台抉择 / 结局 ================= */
  openChoice: function () {
    this.state = "choice";
    AudioSys.stinger("door");
    var el = document.getElementById("choiceScreen");
    if (el) el.classList.remove("hidden");
    this.live.heat = Math.max(this.live.heat, 62);
    this.live.syncHud();
  },

  showEnding: function (kind) {
    var e = STORY.endings[kind];
    this.hideAllOverlays();
    this.state = "ending";

    document.getElementById("endingLabel").textContent = e.label;
    document.getElementById("endingTitle").textContent = e.title;
    var html = e.paras.map(function (p) { return "<p>" + p + "</p>"; }).join("");
    html += '<div class="final">' + e.final + "</div>";
    document.getElementById("endingBody").innerHTML = html;
    document.getElementById("endingScreen").classList.remove("hidden");

    AudioSys.ambienceLevel(0);
    try {
      localStorage.setItem("schoolHorror_cleared", kind);
      localStorage.setItem("schoolHorror_time", String(Math.floor(this.time)));
    } catch (err) { /* 隐私模式下忽略 */ }

    var pool = DANMAKU[kind === "good" ? "endingGood" : "endingBad"];
    var self = this;
    for (var i = 0; i < 6; i++) {
      (function (n) {
        setTimeout(function () {
          if (self.state === "ending") self.live.say(pool[Math.floor(Math.random() * pool.length)]);
        }, 400 + n * 900);
      })(i);
    }
  },

  /* ================= 界面小工具 ================= */
  toast: function (big, small, ms) {
    var el = document.getElementById("toast");
    if (!el) return;
    var html = "";
    if (big) html += '<span class="big">' + big + "</span>";
    if (small) html += small;
    el.innerHTML = html;
    el.classList.add("show");
    if (this.toastT) clearTimeout(this.toastT);
    this.toastT = setTimeout(function () {
      el.classList.remove("show");
    }, ms || 2600);
  },

  showRoom: function (name) {
    var el = document.getElementById("roomName");
    if (!el) return;
    el.textContent = name;
    el.classList.add("show");
    if (this.roomT) clearTimeout(this.roomT);
    this.roomT = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  },

  updateClueUi: function () {
    var chips = document.querySelectorAll(".clue-chip");
    for (var i = 0; i < chips.length; i++) {
      var key = chips[i].getAttribute("data-clue");
      var got = !!this.clues[key];
      chips[i].classList.toggle("found", got);
      chips[i].textContent = got ? String(CLUES[key].order) : "?";
    }
  },

  updateObjective: function () {
    var el = document.getElementById("objective");
    if (!el) return;
    var left = 3 - this.clueCount;
    if (left <= 0) el.textContent = STORY.objective.done;
    else if (left === 3) el.textContent = STORY.objective.start;
    else el.textContent = STORY.objective.halfway.replace("{n}", left);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { Game.init(); });
} else {
  Game.init();
}
