/* ================= 世界：地图、碰撞、视线、寻路 ================= */
"use strict";

var World = {
  T: 32,
  grid: null,       // 0 墙 / 1 地板
  solid: null,      // 物件占位
  props: null,
  rooms: null,

  build: function () {
    var W = CFG.MAP_W, H = CFG.MAP_H, i, j;
    this.T = CFG.TILE;
    this.grid = [];
    this.solid = [];
    for (j = 0; j < H; j++) {
      this.grid.push([]);
      this.solid.push([]);
      for (i = 0; i < W; i++) { this.grid[j].push(0); this.solid[j].push(0); }
    }

    // 挖出房间
    this.rooms = ROOMS.map(function (r) {
      var o = { id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, tint: r.tint };
      o.cx = (r.x + r.w / 2) * CFG.TILE;
      o.cy = (r.y + r.h / 2) * CFG.TILE;
      return o;
    });
    this.rooms.forEach(function (r) {
      for (var y = r.y; y < r.y + r.h; y++)
        for (var x = r.x; x < r.x + r.w; x++)
          this.grid[y][x] = 1;
    }, this);

    // 门洞
    DOORWAYS.forEach(function (d) {
      var w = d.w || 1;
      for (var k = 0; k < w; k++) this.grid[d.y][d.x + k] = 1;
    }, this);

    // 物件
    this.props = PROPS.map(function (p, idx) {
      var solid = !(p.decor || p.t === "clue");
      var o = {
        idx: idx, t: p.t, x: p.x, y: p.y, w: p.w || 1, h: p.h || 1,
        hide: !!p.hide, decor: !!p.decor, clue: p.clue || null,
        label: p.label || "",
        px: (p.x + (p.w || 1) / 2) * CFG.TILE,
        py: (p.y + (p.h || 1) / 2) * CFG.TILE,
        solid: solid,
        hiddenInside: false
      };
      return o;
    });
    this.props.forEach(function (p) {
      if (!p.solid) return;
      for (var y = Math.floor(p.y); y < Math.ceil(p.y + p.h); y++)
        for (var x = Math.floor(p.x); x < Math.ceil(p.x + p.w); x++)
          if (this.inBounds(x, y)) this.solid[y][x] = 1;
    }, this);

    return this;
  },

  inBounds: function (x, y) {
    return x >= 0 && y >= 0 && x < CFG.MAP_W && y < CFG.MAP_H;
  },

  /* 瓦片是否阻挡（墙 或 物件） */
  blocked: function (tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    return this.grid[ty][tx] === 0 || this.solid[ty][tx] === 1;
  },

  /* 仅墙阻挡（视线用，物件也能挡视线） */
  opaque: function (tx, ty) {
    return this.blocked(tx, ty);
  },

  /* 圆与地图碰撞：返回是否碰撞 */
  circleHits: function (x, y, r) {
    var T = this.T;
    var x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T);
    var y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (!this.blocked(tx, ty)) continue;
        // 圆与矩形
        var rx = tx * T, ry = ty * T;
        var cx = Math.max(rx, Math.min(x, rx + T));
        var cy = Math.max(ry, Math.min(y, ry + T));
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  },

  /* 分轴移动，返回新坐标 */
  moveCircle: function (x, y, r, dx, dy) {
    var nx = x + dx;
    if (!this.circleHits(nx, y, r)) x = nx;
    var ny = y + dy;
    if (!this.circleHits(x, ny, r)) y = ny;
    return { x: x, y: y };
  },

  roomAt: function (px, py) {
    var tx = px / this.T, ty = py / this.T;
    for (var i = 0; i < this.rooms.length; i++) {
      var r = this.rooms[i];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  },

  /* 视线：沿线段采样，遇阻即断 */
  los: function (x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return true;
    var steps = Math.ceil(dist / 10);
    var T = this.T;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var tx = Math.floor((x1 + dx * t) / T);
      var ty = Math.floor((y1 + dy * t) / T);
      if (this.opaque(tx, ty)) return false;
    }
    return true;
  },

  /* BFS 路径：返回像素路点数组（不含起点） */
  findPath: function (sx, sy, gx, gy) {
    var T = this.T;
    var stx = Math.floor(sx / T), sty = Math.floor(sy / T);
    var gtx = Math.floor(gx / T), gty = Math.floor(gy / T);
    if (!this.inBounds(gtx, gty) || this.blocked(gtx, gty)) {
      // 目标在实体里：找附近可走的格子
      var found = null;
      for (var rr = 1; rr <= 2 && !found; rr++) {
        for (var dy = -rr; dy <= rr && !found; dy++) {
          for (var dx = -rr; dx <= rr && !found; dx++) {
            if (!this.blocked(gtx + dx, gty + dy)) found = { x: gtx + dx, y: gty + dy };
          }
        }
      }
      if (!found) return [];
      gtx = found.x; gty = found.y;
    }
    if (this.blocked(stx, sty)) return [];

    var W = CFG.MAP_W, H = CFG.MAP_H;
    var prev = new Int32Array(W * H).fill(-1);
    var seen = new Uint8Array(W * H);
    var q = new Int32Array(W * H);
    var head = 0, tail = 0;
    var s = sty * W + stx, g = gty * W + gtx;
    q[tail++] = s; seen[s] = 1;

    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var hit = false;
    while (head < tail) {
      var cur = q[head++];
      if (cur === g) { hit = true; break; }
      var cx = cur % W, cy = (cur - cx) / W;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (!this.inBounds(nx, ny) || this.blocked(nx, ny)) continue;
        var ni = ny * W + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        q[tail++] = ni;
      }
    }
    if (!hit) return [];

    var path = [];
    var node = g;
    var guard = 0;
    while (node !== s && node !== -1 && guard++ < W * H) {
      var nx2 = node % W, ny2 = (node - nx2) / W;
      path.push({ x: nx2 * T + T / 2, y: ny2 * T + T / 2 });
      node = prev[node];
    }
    path.reverse();
    return path;
  },

  /* 最近的互动物件 */
  nearestProp: function (px, py, range) {
    var best = null, bestD = range * range;
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      if (!(p.hide || p.clue || p.decor || p.t === "exit")) continue;
      // 用物件矩形边缘距离
      var rx = p.x * this.T, ry = p.y * this.T;
      var rw = p.w * this.T, rh = p.h * this.T;
      var cx = Math.max(rx, Math.min(px, rx + rw));
      var cy = Math.max(ry, Math.min(py, ry + rh));
      var dx = px - cx, dy = py - cy;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
};
