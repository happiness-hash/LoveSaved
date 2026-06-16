const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

const AVATAR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffe9d5" />
          <stop offset="100%" stop-color="#f0b799" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="80" fill="url(#g)" />
      <circle cx="80" cy="62" r="26" fill="#fff7f0" />
      <path d="M36 134c8-26 28-39 44-39s36 13 44 39" fill="#fff7f0" />
    </svg>
  `);

function initialData() {
  const now = Date.now();
  const fmt = (offsetMin) => {
    const d = new Date(now - offsetMin * 60 * 1000);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return {
    users: [
      {
        id: "user-a",
        nickname: "我",
        avatarUrl: AVATAR_SVG,
        totalAffectionPoints: 128,
        availableAffectionPoints: 74,
      },
      {
        id: "user-b",
        nickname: "TA",
        avatarUrl: AVATAR_SVG,
        totalAffectionPoints: 97,
        availableAffectionPoints: 52,
      },
    ],
    kissBalance: 12,
    affectionRecords: [
      {
        id: "aff-1",
        actorUserId: "user-a",
        actorName: "我",
        score: 8,
        createdAt: fmt(30),
        textContent: "你记得我随口提过的小蛋糕，真的会让我开心很久。",
        imageList: ["https://dummyimage.com/600x400/f4d6cc/8d4f34&text=Moment+Photo"],
        voiceDuration: 12,
        voiceLabel: "一段晚上的语音",
        isContentVisibleToPartner: true,
      },
      {
        id: "aff-2",
        actorUserId: "user-b",
        actorName: "TA",
        score: 5,
        createdAt: fmt(60 * 3),
        textContent: "这条内容没有公开。",
        imageList: [],
        voiceDuration: 0,
        voiceLabel: "",
        isContentVisibleToPartner: false,
      },
      {
        id: "aff-3",
        actorUserId: "user-a",
        actorName: "我",
        score: 11,
        createdAt: fmt(60 * 18),
        textContent: "早上那句加油比咖啡还有用。",
        imageList: [],
        voiceDuration: 7,
        voiceLabel: "一段早安语音",
        isContentVisibleToPartner: true,
      },
    ],
    redeemRequests: [
      {
        id: "redeem-1",
        applicantUserId: "user-b",
        applicantName: "TA",
        content: "周末火锅",
        costPoints: 20,
        remark: "想去上次没排到的那家。",
        status: "pending",
        reviewComment: "",
        createdAt: fmt(45),
      },
      {
        id: "redeem-2",
        applicantUserId: "user-a",
        applicantName: "我",
        content: "一起看电影",
        costPoints: 30,
        remark: "科幻片优先。",
        status: "approved",
        reviewComment: "周六晚上去。",
        createdAt: fmt(60 * 5),
      },
      {
        id: "redeem-3",
        applicantUserId: "user-b",
        applicantName: "TA",
        content: "晚安拥抱",
        costPoints: 8,
        remark: "今天太困了也想要。",
        status: "rejected",
        reviewComment: "先欠着，明天补双倍。",
        createdAt: fmt(60 * 24),
      },
    ],
    notifications: [
      {
        id: "notice-1",
        type: "redeem_pending",
        title: "收到新的兑换申请",
        summary: "TA 想兑换：周末火锅",
        createdAt: fmt(45),
        isRead: false,
        relatedId: "redeem-1",
      },
      {
        id: "notice-2",
        type: "affection_new",
        title: "TA 记录了一次心动",
        summary: "新增了 5 分心意值",
        createdAt: fmt(60 * 3),
        isRead: false,
        relatedId: "aff-2",
      },
      {
        id: "notice-3",
        type: "kiss_changed",
        title: "我们的吻有新记录",
        summary: "TA 增加了 2 个吻：晚安吻",
        createdAt: fmt(60 * 4),
        isRead: true,
        relatedId: "kiss-2",
      },
      {
        id: "notice-4",
        type: "redeem_rejected",
        title: "你的兑换申请已被拒绝",
        summary: "申请内容：晚安拥抱",
        createdAt: fmt(60 * 24),
        isRead: true,
        relatedId: "redeem-3",
      },
    ],
    kissLogs: [
      {
        id: "kiss-1",
        changeAmount: 3,
        textContent: "午安吻",
        operatorName: "我",
        balanceAfter: 12,
        createdAt: fmt(20),
      },
      {
        id: "kiss-2",
        changeAmount: 2,
        textContent: "晚安吻",
        operatorName: "TA",
        balanceAfter: 9,
        createdAt: fmt(60 * 4),
      },
      {
        id: "kiss-3",
        changeAmount: -1,
        textContent: "兑换一个见面吻",
        operatorName: "我",
        balanceAfter: 7,
        createdAt: fmt(60 * 26),
      },
    ],
  };
}

let data = null;

function load() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      data = JSON.parse(raw);
      return;
    } catch (e) {
      console.warn("读取 data.json 失败，使用初始数据。", e.message);
    }
  }
  data = initialData();
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn("保存 data.json 失败。", e.message);
  }
}

function nowString() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getUser(userId) {
  return data.users.find((u) => u.id === userId);
}

function getPartner(userId) {
  return data.users.find((u) => u.id !== userId);
}

function getStore() {
  return data;
}

module.exports = { load, save, nowString, getUser, getPartner, getStore };
