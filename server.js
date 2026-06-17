const express = require("express");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { db, hashPassword } = require("./sqlite");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------- 低内存/性能开关 ----------
app.disable("x-powered-by");          // 省几个字节 + 信息安全
app.set("etag", false);               // 不用默认 etag（会缓存 body hash）
app.use(cors());
app.use(compression({ threshold: 1024 })); // 1KB 以上就 gzip，输出小了压力小
app.use(express.json({ limit: "100kb" })); // 防止大 JSON 吃内存

// ---------- uploads 目录 & 静态服务 ----------
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// 静态资源（uploads 优先于根目录，否则根目录 static 会先截胡 /uploads/）
app.use("/uploads", express.static(UPLOADS_DIR, {
  maxAge: "1d",
  immutable: true,
  setHeaders: (res, filePath) => {
    // 浏览器对 .webm 默认 mime 是 video/webm，但 uploads 里其实都是语音，
    // <audio> 拿到 video/* 经常会拒播。显式改成 audio/webm。
    if (filePath.toLowerCase().endsWith(".webm")) {
      res.setHeader("Content-Type", "audio/webm");
    }
  },
}));

// 静态资源（前端）
app.use(express.static(__dirname, {
  maxAge: "1h",
  index: "index.html",
  setHeaders: (res, filePath) => {
    // uploads 目录的文件走独立的缓存策略
    if (filePath.startsWith(UPLOADS_DIR)) {
      res.setHeader("Cache-Control", "public, max-age=86400, immutable"); // 一天强缓存，上传后文件名带 hash
    }
  },
}));

// ---------- 工具 ----------
function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    totalAffectionPoints: row.total_affection_points,
    availableAffectionPoints: row.available_affection_points,
  };
}

function truthyField(value) {
  // 兼容 true/false、1/0、"true"/"false"、"1"/"0"
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return true;
}

function getPartnerId(userId) {
  const row = db.prepare("SELECT id FROM users WHERE id != ? LIMIT 1").get(userId);
  return row ? row.id : null;
}

// ---------- 文件上传（流式落盘，不进内存） ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = new Date();
    const sub = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const dir = path.join(UPLOADS_DIR, sub);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 文件名 = 短 hash + 原扩展名，防覆盖、防路径穿越
    const ext = path.extname(file.originalname || "").slice(0, 8).toLowerCase();
    const hash = crypto.randomBytes(6).toString("hex");
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,  // 单文件 8MB；你可以调得更小
    files: 5,                    // 一次最多 5 个文件
  },
  fileFilter: (req, file, cb) => {
    // 去掉 codecs=... 这类参数；multer 拿到的 mimetype 经常带 codecs/采样率后缀
    const main = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
    const allowed = /^(image\/(png|jpeg|jpg|gif|webp)|audio\/(mpeg|wav|ogg|m4a|webm|mp3|mp4|x-m4a|aac|opus)|video\/webm|application\/octet-stream)$/;
    if (allowed.test(main)) cb(null, true);
    else cb(new Error("不支持的文件类型: " + file.mimetype));
  },
});

function fileToUrl(absPath) {
  // "/uploads/2026-06/17xxxxxx-abc.jpg"
  return "/uploads/" + path.relative(UPLOADS_DIR, absPath).split(path.sep).join("/");
}

// ---------- 鉴权（基于 session token） ----------
function nowString() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createToken() {
  return "tk_" + crypto.randomBytes(18).toString("hex");
}

function auth(req, res, next) {
  const token = (req.headers["x-auth-token"] || "").toString().trim();
  if (!token) return res.status(401).json({ error: "未登录" });
  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录" });
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!row) return res.status(401).json({ error: "账户不存在" });
  req.user = rowToUser(row);
  next();
}

// ---- 登录：验证用户名+密码，创建 session token ----
app.post("/api/login", (req, res) => {
  const username = ((req.body && req.body.username) || "").toString().trim().toLowerCase();
  const password = ((req.body && req.body.password) || "").toString();
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row) return res.status(401).json({ error: "用户名或密码错误" });

  const expected = hashPassword(username, password);
  if (row.password_hash !== expected) return res.status(401).json({ error: "用户名或密码错误" });

  // 每个用户只保留最近 3 个 session，其余清理
  const oldSessions = db.prepare("SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC").all(row.id);
  if (oldSessions.length >= 3) {
    for (const s of oldSessions.slice(2)) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(s.token);
    }
  }

  const token = createToken();
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, row.id, nowString());

  res.json({ token, user: rowToUser(row) });
});

// ---- 登出：删除当前 session ----
app.post("/api/logout", auth, (req, res) => {
  const token = (req.headers["x-auth-token"] || "").toString().trim();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.json({ ok: true });
});

// ---- 忘记密码：通过生日验证重置密码 ----
const birthdayAnswers = {
  "wq": "040923",  
  "zjl": "060107", 
};

app.post("/api/forgot-password", (req, res) => {
  const body = req.body || {};
  const username = ((body.username || "").toString().trim()).toLowerCase();
  const birthday = (body.birthday || "").toString().trim();
  const newPassword = (body.newPassword || "").toString();

  if (!username || !birthday || !newPassword) {
    return res.status(400).json({ error: "请填写完整信息" });
  }

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row) return res.status(404).json({ error: "用户名不存在" });

  const correctBirthday = birthdayAnswers[username];
  if (!correctBirthday || birthday !== correctBirthday) {
    return res.status(401).json({ error: "安全问题答案错误" });
  }

  const newHash = hashPassword(username, newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(newHash, username);

  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);

  res.json({ ok: true });
});

// ---- 当前用户信息（前端登录后立刻调一次） ----
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

// ---- 修改用户信息 ----
app.put("/api/users/me", auth, (req, res) => {
  const body = req.body || {};
  const updates = [];
  const params = [];

  if (body.nickname) {
    updates.push("nickname = ?");
    params.push(body.nickname);
  }

  if (body.currentPassword && body.newPassword) {
    const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "用户不存在" });

    const expected = hashPassword(req.user.username, body.currentPassword);
    if (user.password_hash !== expected) {
      return res.status(401).json({ error: "当前密码不正确" });
    }

    updates.push("password_hash = ?");
    params.push(hashPassword(req.user.username, body.newPassword));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "没有需要修改的内容" });
  }

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: rowToUser(updated) });
});

// ---------- 路由 ----------
app.get("/api/users", (req, res) => {
  const rows = db.prepare("SELECT id, nickname, avatar_url FROM users").all();
  res.json(rows.map((r) => ({ id: r.id, nickname: r.nickname, avatarUrl: r.avatar_url })));
});

app.get("/api/home", auth, (req, res) => {
  const partner = db.prepare("SELECT * FROM users WHERE id != ?").get(req.user.id);
  const kissRow = db.prepare("SELECT balance FROM kiss_balance WHERE id = 1").get();
  const unread = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0").get();

  // 获取最近心动记录（3条）
  const recentRecords = db.prepare(
    "SELECT * FROM affection_records ORDER BY created_at DESC, id DESC LIMIT 3"
  ).all().map(r => hydrateRecord(r, req.user.id));

  // 获取最近兑换申请（3条）：返回完整字段
  const recentRedeems = db.prepare(
    "SELECT * FROM redeem_requests ORDER BY created_at DESC LIMIT 3"
  ).all().map(r => ({
    id: r.id,
    applicantUserId: r.applicant_user_id,
    applicantName: r.applicant_name,
    content: r.content,
    costPoints: r.cost_points,
    remark: r.remark,
    status: r.status,
    reviewComment: r.review_comment,
    createdAt: r.created_at,
  }));

  res.json({
    me: req.user,
    partner: partner ? rowToUser(partner) : null,
    kissBalance: kissRow ? kissRow.balance : 0,
    unreadNotificationCount: unread.c,
    recentRecords,
    recentRedeems,
  });
});

// ---- 心动记录 ----
function hydrateRecord(row, forUserId) {
  if (!row) return null;
  const files = db.prepare(
    "SELECT id, kind, file_path, file_name, size, duration FROM affection_files WHERE record_id = ?"
  ).all(row.id);

  const visible = row.actor_user_id === forUserId || row.is_content_visible_to_partner === 1;

  const urls = files.map((f) => ({
    id: f.id,
    kind: f.kind,
    url: fileToUrl(path.join(UPLOADS_DIR, f.file_path)),
    name: f.file_name,
    size: f.size,
    duration: f.duration,
  }));
  const images = urls.filter((f) => f.kind === "image").map((f) => f.url);
  const voices = urls.filter((f) => f.kind === "voice");

  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    score: row.score,
    createdAt: row.created_at,
    textContent: visible ? row.text_content : "",
    imageList: visible ? images : [],
    voiceDuration: visible && voices[0] ? (voices[0].duration || 1) : 0,
    voiceLabel: visible && voices[0] ? (voices[0].name || "语音") : "",
    voiceUrl: visible && voices[0] ? voices[0].url : null,
    isContentVisibleToPartner: row.is_content_visible_to_partner === 1,
  };
}

app.get("/api/affection-records", auth, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const total = db.prepare("SELECT COUNT(*) AS c FROM affection_records").get().c;
  const rows = db.prepare(
    "SELECT * FROM affection_records ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(pageSize, (page - 1) * pageSize);
  res.json({
    list: rows.map((r) => hydrateRecord(r, req.user.id)),
    total, page, pageSize,
  });
});

app.get("/api/affection-records/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM affection_records WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "记录不存在" });
  res.json(hydrateRecord(row, req.user.id));
});

// 新增心动：multipart/form-data，支持图片和语音
app.post("/api/affection-records", auth, upload.any(), (req, res) => {
  const score = Number(req.body.score);
  if (!score || score <= 0) return res.status(400).json({ error: "score 必须是正整数" });
  const textContent = (req.body.textContent || "").toString().trim();
  // 字段统一为 isContentVisibleToPartner，兼容 true/false、1/0
  const visible = truthyField(req.body.isContentVisibleToPartner) ? 1 : 0;

  const files = req.files || [];

  const recordId = `aff-${Date.now()}`;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO affection_records (id, actor_user_id, actor_name, score, created_at, text_content, is_content_visible_to_partner)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(recordId, req.user.id, req.user.nickname, score, nowString(), textContent, visible);

    const insertFile = db.prepare(
      `INSERT INTO affection_files (record_id, kind, file_path, file_name, size, duration)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const f of files) {
      const relPath = path.relative(UPLOADS_DIR, f.path).split(path.sep).join("/");
      const kind = f.mimetype.startsWith("image/") ? "image" : "voice";
      const duration = Number(req.body[`duration_${f.fieldname}`]) || null;
      insertFile.run(recordId, kind, relPath, f.originalname, f.size, duration);
    }

    db.prepare(
      `UPDATE users SET total_affection_points = total_affection_points + ?, available_affection_points = available_affection_points + ? WHERE id = ?`
    ).run(score, score, req.user.id);

    const partnerId = getPartnerId(req.user.id);
    if (partnerId) {
      db.prepare(
        `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        `notice-${Date.now()}`,
        "affection_new",
        `${req.user.nickname} 记录了一次心动`,
        `新增了 ${score} 分心意值`,
        nowString(),
        recordId,
        partnerId
      );
    }

    // 重新读取最新的 me
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    return { me: rowToUser(updated) };
  });
  const { me } = tx();

  const row = db.prepare("SELECT * FROM affection_records WHERE id = ?").get(recordId);
  res.status(201).json({
    ok: true,
    record: hydrateRecord(row, req.user.id),
    me,
  });
});

// ---- 兑换申请 ----
app.get("/api/redeem-requests", auth, (req, res) => {
  const filter = req.query.filter || "all";
  const meId = req.user.id;
  let rows;
  if (filter === "mine") rows = db.prepare("SELECT * FROM redeem_requests WHERE applicant_user_id = ? ORDER BY created_at DESC").all(meId);
  else if (filter === "partner") rows = db.prepare("SELECT * FROM redeem_requests WHERE applicant_user_id != ? ORDER BY created_at DESC").all(meId);
  else if (filter === "pending") rows = db.prepare("SELECT * FROM redeem_requests WHERE applicant_user_id != ? AND status = 'pending' ORDER BY created_at DESC").all(meId);
  else rows = db.prepare("SELECT * FROM redeem_requests ORDER BY created_at DESC").all();
  res.json({
    list: rows.map((r) => ({
      id: r.id,
      applicantUserId: r.applicant_user_id,
      applicantName: r.applicant_name,
      content: r.content,
      costPoints: r.cost_points,
      remark: r.remark,
      status: r.status,
      reviewComment: r.review_comment,
      createdAt: r.created_at,
    })),
  });
});

app.post("/api/redeem-requests", auth, (req, res) => {
  const body = req.body || {};
  const content = (body.content || "").toString().trim();
  const costPoints = Number(body.costPoints);
  const remark = (body.remark || "").toString().trim();
  if (!content) return res.status(400).json({ error: "content 不能为空" });
  if (!costPoints || costPoints <= 0) return res.status(400).json({ error: "costPoints 必须是正整数" });
  if (costPoints > req.user.availableAffectionPoints) return res.status(400).json({ error: "可用心意值不足" });

  const id = `redeem-${Date.now()}`;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO redeem_requests (id, applicant_user_id, applicant_name, content, cost_points, remark, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, req.user.id, req.user.nickname, content, costPoints, remark, nowString());

    const ts = nowString();
    // 通知：发起人（"我提交了兑换申请"）
    db.prepare(
      `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
       VALUES (?, 'redeem_submitted', ?, ?, ?, 0, ?, ?)`
    ).run(
      `notice-${Date.now()}-self`,
      "你提交了兑换申请",
      `等待对方处理：${content}`,
      ts,
      id,
      req.user.id
    );
    // 通知：对方（"收到新的兑换申请"）
    const partnerId = getPartnerId(req.user.id);
    if (partnerId) {
      db.prepare(
        `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
         VALUES (?, 'redeem_pending', ?, ?, ?, 0, ?, ?)`
      ).run(
        `notice-${Date.now()}-partner`,
        "收到新的兑换申请",
        `${req.user.nickname} 想兑换：${content}`,
        ts,
        id,
        partnerId
      );
    }
  });
  tx();

  res.status(201).json({
    ok: true,
    request: {
      id,
      applicantUserId: req.user.id,
      applicantName: req.user.nickname,
      content,
      costPoints,
      remark,
      status: "pending",
      reviewComment: "",
      createdAt: nowString(),
    },
  });
});

app.post("/api/redeem-requests/:id/review", auth, (req, res) => {
  const action = req.body.action;
  const reviewComment = (req.body.reviewComment || "").toString().trim();
  if (!["approved", "rejected"].includes(action)) return res.status(400).json({ error: "action 必须是 approved 或 rejected" });

  const record = db.prepare("SELECT * FROM redeem_requests WHERE id = ?").get(req.params.id);
  if (!record) return res.status(404).json({ error: "申请不存在" });
  if (record.status !== "pending") return res.status(400).json({ error: "该申请已处理" });
  if (record.applicant_user_id === req.user.id) return res.status(400).json({ error: "不能审批自己发起的申请" });

  const tx = db.transaction(() => {
    if (action === "approved") {
      const applicant = db.prepare("SELECT * FROM users WHERE id = ?").get(record.applicant_user_id);
      if (!applicant || applicant.available_affection_points < record.cost_points) {
        throw new Error("申请人可用心意值不足");
      }
      db.prepare(
        "UPDATE users SET available_affection_points = available_affection_points - ? WHERE id = ?"
      ).run(record.cost_points, record.applicant_user_id);
    }
    const finalComment = reviewComment || (action === "approved" ? "可以，安排。" : "这次先欠着。");
    db.prepare(
      `UPDATE redeem_requests SET status = ?, review_comment = ? WHERE id = ?`
    ).run(action, finalComment, record.id);

    // 删除"我提交了兑换申请"那条自助通知（已被本条结果通知取代）
    db.prepare(
      `DELETE FROM notifications WHERE related_id = ? AND type = 'redeem_submitted'`
    ).run(record.id);

    db.prepare(
      `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      `notice-${Date.now()}`,
      action === "approved" ? "redeem_approved" : "redeem_rejected",
      `兑换申请${action === "approved" ? "已同意" : "已拒绝"}`,
      `申请内容：${record.content}`,
      nowString(),
      record.id,
      record.applicant_user_id
    );
    return finalComment;
  });
  try {
    const finalComment = tx();
    res.json({
      ok: true,
      request: {
        id: record.id,
        status: action,
        reviewComment: finalComment,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 发起人自行撤销兑换申请
app.post("/api/redeem-requests/:id/cancel", auth, (req, res) => {
  const record = db.prepare("SELECT * FROM redeem_requests WHERE id = ?").get(req.params.id);
  if (!record) return res.status(404).json({ error: "申请不存在" });
  if (record.applicant_user_id !== req.user.id) return res.status(403).json({ error: "只有发起人可以撤销" });
  if (record.status !== "pending") return res.status(400).json({ error: "该申请已处理，无法撤销" });

  const tx = db.transaction(() => {
    db.prepare("UPDATE redeem_requests SET status = 'cancelled' WHERE id = ?").run(record.id);

    // 删除"我提交了兑换申请"那条自助通知
    db.prepare(
      `DELETE FROM notifications WHERE related_id = ? AND type = 'redeem_submitted'`
    ).run(record.id);

    // 给对方发一条 cancelled 通知
    const partnerId = getPartnerId(req.user.id);
    if (partnerId) {
      db.prepare(
        `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
         VALUES (?, 'redeem_cancelled', ?, ?, ?, 0, ?, ?)`
      ).run(
        `notice-${Date.now()}`,
        "对方撤回了兑换申请",
        `申请内容：${record.content}`,
        nowString(),
        record.id,
        partnerId
      );
    }

    // 给发起人也补一条 cancelled 通知，方便"我的申请"展示完整轨迹
    db.prepare(
      `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
       VALUES (?, 'redeem_cancelled', ?, ?, ?, 0, ?, ?)`
    ).run(
      `notice-${Date.now()}-self`,
      "你撤回了兑换申请",
      `申请内容：${record.content}`,
      nowString(),
      record.id,
      req.user.id
    );
  });

  try {
    tx();
    res.json({
      ok: true,
      request: {
        id: record.id,
        status: "cancelled",
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 通知 ----
app.get("/api/notifications", auth, (req, res) => {
  const filter = req.query.filter || "all";
  // 始终按当前用户过滤；老数据 (user_id IS NULL) 对所有人都不可见
  const baseWhere = "WHERE user_id = ?";
  const baseArgs = [req.user.id];

  let where = baseWhere;
  let args = baseArgs.slice();
  if (filter === "pending") {
    // 对方发来的待我处理
    where += " AND type = 'redeem_pending'";
  } else if (filter === "mine") {
    // 我的申请：自己提交或与自己兑换申请相关
    where += " AND type IN ('redeem_submitted','redeem_approved','redeem_rejected','redeem_cancelled')";
  } else if (filter === "notice") {
    // 普通提醒：心动 / 吻 / 对方发来的撤回
    where += " AND type NOT IN ('redeem_pending','redeem_submitted','redeem_approved','redeem_rejected')";
  }

  const rows = db.prepare(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC`
  ).all(...args);

  res.json({
    list: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary,
      createdAt: r.created_at,
      isRead: r.is_read === 1,
      relatedId: r.related_id,
    })),
  });
});

app.post("/api/notifications/read-all", auth, (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

app.post("/api/notifications/:id/read", auth, (req, res) => {
  const n = db.prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!n) return res.status(404).json({ error: "通知不存在" });
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- 吻 ----
app.get("/api/kiss", auth, (req, res) => {
  const balanceRow = db.prepare("SELECT balance FROM kiss_balance WHERE id = 1").get();
  const logs = db.prepare("SELECT * FROM kiss_logs ORDER BY created_at DESC LIMIT 100").all();
  res.json({
    kissBalance: balanceRow ? balanceRow.balance : 0,
    kissLogs: logs.map((l) => ({
      id: l.id,
      changeAmount: l.change_amount,
      textContent: l.text_content,
      operatorName: l.operator_name,
      balanceAfter: l.balance_after,
      createdAt: l.created_at,
    })),
  });
});

app.post("/api/kiss/logs", auth, (req, res) => {
  const body = req.body || {};
  const mode = body.mode === "minus" ? "minus" : "add";
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: "amount 必须是正整数" });
  const textContent = (body.textContent || "").toString().trim() || "没有备注";

  const tx = db.transaction(() => {
    const current = db.prepare("SELECT balance FROM kiss_balance WHERE id = 1").get();
    const delta = mode === "minus" ? -amount : amount;
    const nextBalance = (current ? current.balance : 0) + delta;
    if (nextBalance < 0) throw new Error("吻余额不能小于 0");

    db.prepare("UPDATE kiss_balance SET balance = ? WHERE id = 1").run(nextBalance);
    const logId = `kiss-${Date.now()}`;
    const createdAt = nowString();
    db.prepare(
      `INSERT INTO kiss_logs (id, change_amount, text_content, operator_name, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(logId, delta, textContent, req.user.nickname, nextBalance, createdAt);

    const partnerId = getPartnerId(req.user.id);
    if (partnerId) {
      db.prepare(
        `INSERT INTO notifications (id, type, title, summary, created_at, is_read, related_id, user_id)
         VALUES (?, 'kiss_changed', ?, ?, ?, 0, ?, ?)`
      ).run(
        `notice-${Date.now()}`,
        "我们的吻有新记录",
        textContent,
        createdAt,
        logId,
        partnerId
      );
    }
    return {
      logId,
      nextBalance,
      log: {
        id: logId,
        changeAmount: delta,
        textContent,
        operatorName: req.user.nickname,
        balanceAfter: nextBalance,
        createdAt,
      },
    };
  });

  try {
    const { nextBalance, log } = tx();
    res.status(201).json({
      ok: true,
      kissBalance: nextBalance,
      log,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 启动 ----------
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[心意] http://localhost:${PORT}  (SQLite + 文件上传)`);
});

// 优雅退出：关闭 SQLite 与 WAL 合并
function shutdown() {
  try { db.pragma("wal_checkpoint(TRUNCATE)"); db.close(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
