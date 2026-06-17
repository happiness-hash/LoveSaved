const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DB_FILE = path.join(__dirname, "app.db");

// 简易密码哈希：sha256(username + ":" + password)，够用的小体量 demo
function hashPassword(username, password) {
  return crypto.createHash("sha256").update(`${username}:${password}`).digest("hex");
}

// 若已有老数据库，需要在启动前删除以重建 schema；否则直接打开
const db = new Database(DB_FILE, { readonly: false, fileMustExist: false });
db.pragma("journal_mode = WAL");
db.pragma("cache_size = -512");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  nickname TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  total_affection_points INTEGER NOT NULL DEFAULT 0,
  available_affection_points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS affection_records (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  text_content TEXT,
  is_content_visible_to_partner INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS affection_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'image' | 'voice'
  file_path TEXT NOT NULL,       -- 相对 uploads 的路径，如 '2026/06/abc.jpg'
  file_name TEXT,                -- 原始文件名
  size INTEGER,                  -- 字节
  duration INTEGER,              -- 语音秒数（仅 voice 有）
  FOREIGN KEY(record_id) REFERENCES affection_records(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redeem_requests (
  id TEXT PRIMARY KEY,
  applicant_user_id TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  content TEXT NOT NULL,
  cost_points INTEGER NOT NULL,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending / approved / rejected
  review_comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- affection_new / redeem_pending / redeem_submitted / redeem_approved / redeem_rejected / redeem_cancelled / kiss_changed
  title TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  related_id TEXT,
  user_id TEXT                   -- 接收方 user.id；NULL 表示老数据，不被任何人看到
);

CREATE TABLE IF NOT EXISTS kiss_logs (
  id TEXT PRIMARY KEY,
  change_amount INTEGER NOT NULL,
  text_content TEXT,
  operator_name TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kiss_balance (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- 永远只有一行
  balance INTEGER NOT NULL DEFAULT 0
);
`);

// 对老数据库做补列（幂等）
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

// 初始化用户 & 吻余额（幂等）
function initIfEmpty() {
  ensureColumn("users", "username", "TEXT UNIQUE");
  ensureColumn("users", "password_hash", "TEXT");
  ensureColumn("notifications", "user_id", "TEXT");

  const AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="80" fill="#ffe9d5"/><circle cx="80" cy="62" r="26" fill="#fff7f0"/><path d="M36 134c8-26 28-39 44-39s36 13 44 39" fill="#fff7f0"/></svg>`
    );

  const upsertUser = db.prepare(`
    INSERT INTO users (id, username, nickname, password_hash, avatar_url, total_affection_points, available_affection_points)
    VALUES (@id, @username, @nickname, @password_hash, @avatar_url, @total, @available)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      nickname = excluded.nickname,
      password_hash = excluded.password_hash,
      avatar_url = excluded.avatar_url
  `);

  // 账户 1：zjl / 040923（原 user-a）
  upsertUser.run({
    id: "user-a",
    username: "zjl",
    nickname: "zjler",
    password_hash: hashPassword("zjl", "040923"),
    avatar_url: AVATAR,
    total: 128,
    available: 74,
  });

  // 账户 2：wq / 060107（原 user-b）
  upsertUser.run({
    id: "user-b",
    username: "wq",
    nickname: "wq同学",
    password_hash: hashPassword("wq", "060107"),
    avatar_url: AVATAR,
    total: 97,
    available: 52,
  });

  // 如果数据库里只有"老用户"但没有密码（老数据），给他们分配新用户名
  const legacyFix = db.prepare(`UPDATE users SET username = ?, password_hash = ?, nickname = ? WHERE id = ? AND (username IS NULL OR password_hash IS NULL)`);
  legacyFix.run("zjl", hashPassword("zjl", "040923"), "zjler", "user-a");
  legacyFix.run("wq", hashPassword("wq", "060107"), "wq同学", "user-b");

  const kb = db.prepare("SELECT COUNT(*) AS c FROM kiss_balance").get();
  if (kb.c === 0) {
    db.prepare("INSERT INTO kiss_balance (id, balance) VALUES (1, 12)").run();
  }
}
initIfEmpty();

module.exports = { db, hashPassword };
