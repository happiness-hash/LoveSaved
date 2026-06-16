const state = {
  route: "home",
  token: localStorage.getItem("lovers_saved_token") || "",
  user: null,
  home: null,
  records: [],
  redeemRequests: [],
  notifications: [],
  kiss: null,
  loading: false,
  selectedRecordId: null,
  redeemFilter: "all",
  notificationFilter: "all",
  pendingFocus: null, // { type, id } 通知点击后要定位的目标
};

const routeMeta = {
  home: { title: "首页", action: null },
  moment: { title: "心动", action: { label: "记录这次心动", handler: openMomentComposer } },
  redeem: { title: "兑换", action: { label: "发起兑换", handler: openRedeemComposer } },
  kiss: { title: "我们的吻", action: { label: "记一笔", handler: openKissComposer } },
  messages: { title: "消息", action: { label: "全部已读", handler: markAllNotificationsRead } },
};

const screen = document.getElementById("screen");
const modalLayer = document.getElementById("modal-layer");
const pageTitle = document.getElementById("page-title");
const headerAction = document.getElementById("header-action");
const tabbarItems = Array.from(document.querySelectorAll(".tabbar-item"));

boot();

async function boot() {
  bindEvents();
  render();
  if (!state.token) return;

  try {
    await api("/api/me");
    await refreshCurrentRoute();
  } catch (error) {
    clearSession();
    renderLogin("登录已失效，请重新登录");
  }
}

function bindEvents() {
  tabbarItems.forEach((button) => {
    button.addEventListener("click", async () => {
      state.route = button.dataset.route;
      renderHeader();

      if (!state.token) {
        renderLogin();
        return;
      }

      await refreshCurrentRoute();
    });
  });

  headerAction.addEventListener("click", () => {
    const meta = routeMeta[state.route];
    if (meta && meta.action) {
      meta.action.handler();
    }
  });

  modalLayer.addEventListener("click", (event) => {
    if (event.target === modalLayer) {
      closeModal();
    }
  });
}

function render() {
  renderHeader();

  if (!state.token) {
    renderLogin();
    return;
  }

  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.route === "home") renderHome();
  if (state.route === "moment") renderMoment();
  if (state.route === "redeem") renderRedeem();
  if (state.route === "kiss") renderKiss();
  if (state.route === "messages") renderMessages();
}

function renderHeader() {
  const meta = routeMeta[state.route] || routeMeta.home;
  pageTitle.textContent = state.token ? meta.title : "登录";

  if (!state.token || !meta.action) {
    headerAction.hidden = true;
  } else {
    headerAction.hidden = false;
    headerAction.textContent = meta.action.label;
  }

  tabbarItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.route === state.route);
  });

  renderUserSwitcher();
}

function renderUserSwitcher() {
  let switcher = document.querySelector(".user-switcher");
  if (!switcher) {
    switcher = document.createElement("div");
    switcher.className = "user-switcher";
    document.querySelector(".topbar").appendChild(switcher);
  }

  if (!state.token || !state.user) {
    switcher.innerHTML = "";
    return;
  }

  switcher.innerHTML = `
    <span class="user-chip" id="user-chip">${escapeHtml(state.user.nickname || "用户")}</span>
    <button class="ghost-btn" id="settings-btn">设置</button>
    <button class="ghost-btn logout-btn" id="logout-btn">退出登录</button>
  `;

  document.getElementById("user-chip").addEventListener("click", openSettings);
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
}

function renderLoading() {
  screen.innerHTML = `
    <section class="card">
      <p>加载中...</p>
    </section>
  `;
}

function renderLogin(errorMessage = "") {
  screen.innerHTML = `
    <section class="card hero-card">
      <p class="eyebrow">双人轻量记录</p>
      <h2 class="hero-title">登录后查看你们的心意、兑换和消息。</h2>
    </section>

    <section class="card">
      <h3 class="section-title">账号登录</h3>
      <form id="login-form" class="screen">
        <input name="username" placeholder="用户名" autocomplete="username" required />
        <input name="password" type="password" placeholder="密码" autocomplete="current-password" required />
        ${errorMessage ? `<p style="color:#b43c2f;margin:0;">${escapeHtml(errorMessage)}</p>` : ""}
        <button class="primary-btn" type="submit">登录</button>
      </form>
      <button id="forgot-password" style="background:none;border:none;color:#b85c38;margin-top:12px;cursor:pointer;">忘记密码？</button>
    </section>
  `;

  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("forgot-password").addEventListener("click", openForgotPassword);
}

function renderHome() {
  const home = state.home;
  const me = home && home.me ? home.me : null;
  const partner = home && home.partner ? home.partner : null;

  if (!me) {
    renderLoading();
    return;
  }

  screen.innerHTML = `
    <section class="card hero-card">
      <p class="eyebrow">双人轻量记录</p>
      <h2 class="hero-title">${escapeHtml(me.nickname)}，今天想把哪份心动记下来？</h2>
      <div class="couple-row">
        ${renderAvatarCard(me.nickname, me.avatarUrl, "我")}
        <div class="heart">❤</div>
        ${partner ? renderAvatarCard(partner.nickname, partner.avatarUrl, "TA") : ""}
      </div>
    </section>

    <section class="grid-two">
      <article class="card soft-card">
        <p class="eyebrow">我的可用心意</p>
        <div class="accent-number">${Number(me.availableAffectionPoints || 0)}</div>
      </article>
      <article class="card soft-card light">
        <p class="eyebrow">我们的吻</p>
        <div class="accent-number">${Number(home.kissBalance || 0)}</div>
      </article>
    </section>

    <section class="card">
      <div class="line-row">
        <span>我的总心意</span>
        <strong>${Number(me.totalAffectionPoints || 0)}</strong>
      </div>
      ${
        partner
          ? `
        <div class="line-row">
          <span>${escapeHtml(partner.nickname)} 的可用心意</span>
          <strong>${Number(partner.availableAffectionPoints || 0)}</strong>
        </div>
      `
          : ""
      }
    </section>

    ${
      home.recentRecords && home.recentRecords.length > 0
        ? `
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">最近心动</h3>
        <button class="ghost-btn" onclick="navigateTo('moment')">查看全部</button>
      </div>
      ${home.recentRecords.slice(0, 3).map(r => `
        <div class="line-row">
          <span>${escapeHtml(r.actorName || "")} · ${escapeHtml(r.createdAt || "")}</span>
          <strong>+${Number(r.score || 0)}</strong>
        </div>
      `).join("")}
    </section>
    `
        : ""
    }

    ${
      home.recentRedeems && home.recentRedeems.length > 0
        ? `
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">最近兑换</h3>
        <button class="ghost-btn" onclick="navigateTo('redeem')">查看全部</button>
      </div>
      ${home.recentRedeems.slice(0, 3).map(r => `
        <div class="line-row">
          <span>${escapeHtml(r.applicantName || "")} · ${escapeHtml(r.content || "")}</span>
          <strong>${escapeHtml(statusText(r.status))}</strong>
        </div>
      `).join("")}
    </section>
    `
        : ""
    }

    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">快捷操作</h3>
      </div>
      <div class="action-row">
        <button class="secondary-btn" data-quick="moment">记录心动</button>
        <button class="secondary-btn" data-quick="redeem">发起兑换</button>
        <button class="secondary-btn" data-quick="kiss">增加一个吻</button>
      </div>
    </section>
  `;

  window.navigateTo = (route) => {
    state.route = route;
    renderHeader();
    refreshCurrentRoute();
  };

  screen.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.quick;
      if (type === "moment") openMomentComposer();
      if (type === "redeem") openRedeemComposer();
      if (type === "kiss") openKissComposer();
    });
  });
}

function renderMoment() {
  const items = state.records || [];

  // 通知跳转定位：详情模式
  if (state.selectedRecordId && items.length > 0) {
    renderMomentDetail();
    return;
  }

  // 通知跳转定位：relatedId 可能在当前页找不到
  if (state.pendingFocus && state.pendingFocus.type === "record" && state.pendingFocus.id) {
    const focusId = state.pendingFocus.id;
    const inList = items.find((r) => r.id === focusId);
    if (inList) {
      state.selectedRecordId = focusId;
      renderMomentDetail();
      return;
    }
    // 不在当前页，先拉单条详情
    api(`/api/affection-records/${encodeURIComponent(focusId)}`)
      .then((rec) => {
        if (rec && rec.id) {
          state.records = [rec, ...items.filter((r) => r.id !== rec.id)];
          state.selectedRecordId = rec.id;
          state.pendingFocus = null;
          render();
        }
      })
      .catch(() => {});
    return;
  }

  screen.innerHTML = `
    <section class="card">
      <div class="title-row">
        <h3 class="section-title">心动记录</h3>
        <span>${items.length} 条</span>
      </div>
      ${items.length ? items.map(renderRecordCard).join("") : "<p>还没有记录，先写下第一条。</p>"}
    </section>
  `;

  // 点击记录卡片打开详情
  screen.querySelectorAll("[data-record-id]").forEach(card => {
    card.addEventListener("click", () => {
      state.selectedRecordId = card.dataset.recordId;
      render();
    });
  });
}

function renderMomentDetail() {
  const items = state.records || [];
  const currentIndex = items.findIndex(r => r.id === state.selectedRecordId);
  const current = items[currentIndex];
  
  if (!current) {
    state.selectedRecordId = null;
    renderMoment();
    return;
  }
  
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;
  
  screen.innerHTML = `
    <section class="card">
      <div class="title-row">
        <button class="ghost-btn" id="back-to-list">← 返回列表</button>
      </div>
    </section>
    
    <section class="card">
      <div class="record-head">
        <strong>${escapeHtml(current.actorName || "")}</strong>
        <span class="moment-score">+${Number(current.score || 0)}</span>
      </div>
      <p>${escapeHtml(current.textContent || "这条内容对另一半不可见。")}</p>
      ${
        current.imageList && current.imageList.length > 0
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${current.imageList.map(img => `<img src="${escapeAttr(img)}" alt="记录图片" style="width:120px;height:120px;object-fit:cover;border-radius:12px;" />`).join("")}</div>`
          : ""
      }
      ${
        current.voiceUrl
          ? `<div style="margin-top:10px;padding:12px 14px;background:#fff1de;border-radius:12px;color:#7a6356;">
              <div style="margin-bottom:6px;">🎤 语音${current.voiceDuration ? ` ${current.voiceDuration} 秒` : ""}${current.voiceLabel ? ` - ${escapeHtml(current.voiceLabel)}` : ""}</div>
              <audio controls preload="metadata" src="${escapeAttr(current.voiceUrl)}" style="width:100%;"></audio>
            </div>`
          : ""
      }
      <div class="moment-footer" style="margin-top:12px;">
        <span>${escapeHtml(current.createdAt || "")}</span>
        <span>${current.isContentVisibleToPartner ? "双方可见" : "仅自己可见"}</span>
      </div>
    </section>
    
    <section class="card">
      <div class="action-row" style="justify-content:center;gap:20px;">
        <button class="secondary-btn" id="prev-record" ${!hasPrev ? "disabled" : ""}>← 上一条</button>
        <span style="color:#7a6356;">${currentIndex + 1} / ${items.length}</span>
        <button class="secondary-btn" id="next-record" ${!hasNext ? "disabled" : ""}>下一条 →</button>
      </div>
    </section>
  `;
  
  document.getElementById("back-to-list").addEventListener("click", () => {
    state.selectedRecordId = null;
    render();
  });
  
  if (hasPrev) {
    document.getElementById("prev-record").addEventListener("click", () => {
      state.selectedRecordId = items[currentIndex - 1].id;
      render();
    });
  }
  
  if (hasNext) {
    document.getElementById("next-record").addEventListener("click", () => {
      state.selectedRecordId = items[currentIndex + 1].id;
      render();
    });
  }
}

function renderRedeem() {
  const items = state.redeemRequests || [];
  const currentFilter = state.redeemFilter || "all";

  screen.innerHTML = `
    <section class="card">
      <div class="title-row">
        <h3 class="section-title">兑换申请</h3>
        <button class="secondary-btn" id="open-redeem">发起兑换</button>
      </div>
      <div class="filter-tabs" style="margin:12px 0;">
        <button class="filter-tab ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
        <button class="filter-tab ${currentFilter === 'mine' ? 'active' : ''}" data-filter="mine">我发起的</button>
        <button class="filter-tab ${currentFilter === 'partner' ? 'active' : ''}" data-filter="partner">TA发起的</button>
        <button class="filter-tab ${currentFilter === 'pending' ? 'active' : ''}" data-filter="pending">待我处理</button>
      </div>
      ${items.length ? items.map(renderRedeemCard).join("") : "<p>还没有兑换申请。</p>"}
    </section>
  `;

  // 筛选按钮事件
  screen.querySelectorAll(".filter-tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.redeemFilter = btn.dataset.filter;
      const result = await api(`/api/redeem-requests?filter=${state.redeemFilter}`);
      state.redeemRequests = result.list || [];
      render();
    });
  });

  document.getElementById("open-redeem").addEventListener("click", openRedeemComposer);

  screen.querySelectorAll("[data-review-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openReviewComposer(button.dataset.reviewId, button.dataset.reviewAction);
    });
  });

  applyPendingFocus();
}

function renderKiss() {
  const kiss = state.kiss;
  const balance = kiss ? Number(kiss.kissBalance || 0) : 0;
  const logs = kiss && Array.isArray(kiss.kissLogs) ? kiss.kissLogs : [];

  screen.innerHTML = `
    <section class="card hero-card">
      <p class="eyebrow">我们的吻</p>
      <h2 class="hero-title">当前共享余额</h2>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:12px;">
        <div class="accent-number">${balance}</div>
        <span style="color:#7a6356;">个吻</span>
      </div>
    </section>

    <section class="card">
      <div class="title-row">
        <h3 class="section-title">吻流水</h3>
        <span>${logs.length} 条</span>
      </div>
      ${
        logs.length
          ? logs.map(renderKissLogItem).join("")
          : "<p>还没有吻记录，顶部按钮记第一笔。</p>"
      }
    </section>
  `;

  applyPendingFocus();
}

function renderKissLogItem(item) {
  const amount = Number(item.changeAmount || 0);
  const sign = amount > 0 ? "+" : "";
  return `
    <article class="card soft-card" style="margin-top:14px;" data-focus-id="${escapeAttr(item.id)}">
      <div class="record-head">
        <strong>${escapeHtml(item.textContent || "吻记录")}</strong>
        <span class="moment-score">${sign}${amount}</span>
      </div>
      <div class="line-row">
        <span>${escapeHtml(item.operatorName || "")} · ${escapeHtml(item.createdAt || "")}</span>
        <strong>余额 ${Number(item.balanceAfter || 0)}</strong>
      </div>
    </article>
  `;
}

function renderMessages() {
  const items = state.notifications || [];
  const currentFilter = state.notificationFilter || "all";

  screen.innerHTML = `
    <section class="card">
      <div class="title-row">
        <h3 class="section-title">消息提醒</h3>
        <button class="secondary-btn" id="read-all">全部已读</button>
      </div>
      <div class="filter-tabs" style="margin:12px 0;">
        <button class="filter-tab ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
        <button class="filter-tab ${currentFilter === 'pending' ? 'active' : ''}" data-filter="pending">待处理</button>
        <button class="filter-tab ${currentFilter === 'mine' ? 'active' : ''}" data-filter="mine">我的申请</button>
        <button class="filter-tab ${currentFilter === 'notice' ? 'active' : ''}" data-filter="notice">普通提醒</button>
      </div>
      ${items.length ? items.map((n) => renderNoticeCard(n, currentFilter)).join("") : "<p>暂时没有消息。</p>"}
    </section>
  `;

  // 筛选按钮事件
  screen.querySelectorAll(".filter-tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.notificationFilter = btn.dataset.filter;
      const result = await api(`/api/notifications?filter=${state.notificationFilter}`);
      state.notifications = result.list || [];
      render();
    });
  });

  document.getElementById("read-all").addEventListener("click", markAllNotificationsRead);

  screen.querySelectorAll("[data-read-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      markNotificationRead(button.dataset.readId);
    });
  });

  // 通知点击跳转
  screen.querySelectorAll("[data-notice-id]").forEach(card => {
    card.addEventListener("click", () => {
      handleNotificationClick(card.dataset.noticeId);
    });
  });

  // 快捷操作按钮
  screen.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleQuickAction(button.dataset.quickAction, button.dataset.noticeId, button.dataset.relatedId);
    });
  });
}

function handleQuickAction(action, noticeId, relatedId) {
  if (action === "approve" || action === "reject") {
    const status = action === "approve" ? "approved" : "rejected";
    api(`/api/redeem-requests/${encodeURIComponent(relatedId)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: status, reviewComment: "" }),
    })
      .then(() => refreshCurrentRoute())
      .catch((e) => alert(e.message || "操作失败"));
  } else if (action === "cancel") {
    if (!confirm("确认撤回这个兑换申请吗？")) return;
    api(`/api/redeem-requests/${encodeURIComponent(relatedId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then(() => refreshCurrentRoute())
      .catch((e) => alert(e.message || "撤回失败"));
  }
}

function handleNotificationClick(noticeId) {
  const notification = state.notifications.find(n => n.id === noticeId);
  if (!notification) return;

  // 标记已读
  if (!notification.isRead) {
    markNotificationRead(noticeId);
  }

  const relatedId = notification.relatedId || "";

  // 按 type 决定跳到哪 + 顺便设定 pendingFocus
  if (notification.type === "affection_new") {
    state.pendingFocus = { type: "record", id: relatedId };
    state.route = "moment";
  } else if (notification.type === "kiss_changed") {
    state.pendingFocus = { type: "kiss", id: relatedId };
    state.route = "kiss";
  } else if (
    notification.type === "redeem_pending" ||
    notification.type === "redeem_submitted" ||
    notification.type === "redeem_approved" ||
    notification.type === "redeem_rejected" ||
    notification.type === "redeem_cancelled"
  ) {
    state.pendingFocus = { type: "redeem", id: relatedId };
    state.route = "redeem";
    state.redeemFilter = notification.type === "redeem_pending" ? "pending" : "all";
  } else {
    return;
  }

  renderHeader();
  refreshCurrentRoute();
}

// 根据 pendingFocus 把目标记录/申请/吻日志滚到视口里并高亮
function applyPendingFocus() {
  const focus = state.pendingFocus;
  if (!focus || !focus.id) return;
  state.pendingFocus = null;

  const el = document.querySelector(`[data-focus-id="${cssEscape(focus.id)}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("focus-target");
    setTimeout(() => el.classList.remove("focus-target"), 2200);
  }
}

function cssEscape(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function renderRecordCard(item) {
  const images = item.imageList || [];
  return `
    <article class="card soft-card" style="margin-top:14px;cursor:pointer;" data-record-id="${escapeAttr(item.id)}" data-focus-id="${escapeAttr(item.id)}">
      <div class="record-head">
        <strong>${escapeHtml(item.actorName || "")}</strong>
        <span class="moment-score">+${Number(item.score || 0)}</span>
      </div>
      <p>${escapeHtml(item.textContent || "这条内容对另一半不可见。")}</p>
      ${images.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${images.map(img => `<img src="${escapeAttr(img)}" alt="记录图片" style="width:80px;height:80px;object-fit:cover;border-radius:12px;" />`).join("")}</div>` : ""}
      ${
        item.voiceUrl
          ? `<div style="margin-top:10px;padding:10px 14px;background:#fff1de;border-radius:12px;color:#7a6356;">
              <div style="margin-bottom:6px;">🎤 语音${item.voiceDuration ? ` ${item.voiceDuration} 秒` : ""}${item.voiceLabel ? ` - ${escapeHtml(item.voiceLabel)}` : ""}</div>
              <audio controls preload="metadata" src="${escapeAttr(item.voiceUrl)}" style="width:100%;"></audio>
            </div>`
          : ""
      }
      <div class="moment-footer" style="margin-top:12px;">
        <span>${escapeHtml(item.createdAt || "")}</span>
        <span>${item.isContentVisibleToPartner ? "双方可见" : "仅自己可见"}</span>
      </div>
    </article>
  `;
}

function renderRedeemCard(item) {
  const canReview = item.status === "pending" && state.user && item.applicantUserId !== state.user.id;

  return `
    <article class="card soft-card" style="margin-top:14px;" data-focus-id="${escapeAttr(item.id)}">
      <div class="record-head">
        <strong>${escapeHtml(item.content || "")}</strong>
        <span class="moment-score">-${Number(item.costPoints || 0)}</span>
      </div>
      <p>${escapeHtml(item.remark || "无备注")}</p>
      <div class="line-row">
        <span>${escapeHtml(item.applicantName || "")} · ${escapeHtml(item.createdAt || "")}</span>
        <strong>${escapeHtml(statusText(item.status))}</strong>
      </div>
      ${item.reviewComment ? `<p>${escapeHtml(item.reviewComment)}</p>` : ""}
      ${
        canReview
          ? `
        <div class="action-row">
          <button class="tiny-btn approve-btn" data-review-id="${escapeAttr(item.id)}" data-review-action="approved">通过</button>
          <button class="tiny-btn reject-btn" data-review-id="${escapeAttr(item.id)}" data-review-action="rejected">拒绝</button>
        </div>
      `
          : ""
      }
    </article>
  `;
}

function renderNoticeCard(item, currentFilter) {
  // 快捷操作：根据通知类型判断
  const relatedId = escapeAttr(item.relatedId || "");
  let quickActions = "";
  if (item.type === "redeem_pending") {
    quickActions = `
      <div class="action-row" style="margin-top:10px;">
        <button class="tiny-btn approve-btn" data-quick-action="approve" data-notice-id="${escapeAttr(item.id)}" data-related-id="${relatedId}">通过</button>
        <button class="tiny-btn reject-btn" data-quick-action="reject" data-notice-id="${escapeAttr(item.id)}" data-related-id="${relatedId}">拒绝</button>
      </div>
    `;
  } else if (item.type === "redeem_submitted") {
    // redeem_submitted 仍存在代表申请还在 pending，后端 approve/reject/cancel 时会同步删除
    quickActions = `
      <div class="action-row" style="margin-top:10px;">
        <button class="tiny-btn reject-btn" data-quick-action="cancel" data-notice-id="${escapeAttr(item.id)}" data-related-id="${relatedId}">撤回</button>
      </div>
    `;
  }

  return `
    <article class="card soft-card" style="margin-top:14px;opacity:${item.isRead ? "0.72" : "1"};cursor:pointer;" data-notice-id="${escapeAttr(item.id)}">
      <div class="notice-head">
        <strong>${escapeHtml(item.title || "")}</strong>
        ${
          item.isRead
            ? "<span>已读</span>"
            : `<button class="tiny-btn secondary-btn" data-read-id="${escapeAttr(item.id)}">标记已读</button>`
        }
      </div>
      <p>${escapeHtml(item.summary || "")}</p>
      <div class="line-row">
        <span>${escapeHtml(item.createdAt || "")}</span>
        <span>${escapeHtml(item.type || "")}</span>
      </div>
      ${quickActions}
    </article>
  `;
}

function renderAvatarCard(name, avatarUrl, label) {
  return `
    <div class="avatar-card">
      <img class="avatar" src="${escapeAttr(avatarUrl || "")}" alt="${escapeAttr(name || "")}" />
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(name || "")}</span>
    </div>
  `;
}

function openMomentComposer() {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">记录心动</h3>
        <button class="secondary-btn" id="close-modal">取消</button>
      </div>
      <form id="moment-form" class="screen">
        <input name="score" type="number" min="1" placeholder="增加几点心意" required />
        <textarea name="textContent" placeholder="写下这次心动"></textarea>
        <div style="display:flex;gap:12px;align-items:center;">
          <button type="button" id="add-image" class="secondary-btn" style="flex:1;">📷 添加图片</button>
          <span id="image-count" style="color:#7a6356;font-size:14px;"></span>
        </div>
        <input name="images" type="file" accept="image/*" multiple hidden id="image-input" />
        <div id="image-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"></div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:12px;">
          <button type="button" id="record-voice" class="secondary-btn" style="flex:1;">🎤 录制语音</button>
          <span id="record-status" style="color:#7a6356;font-size:14px;"></span>
        </div>
        <input name="voice" type="hidden" />
        <input name="duration_voice" type="hidden" />
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px;">
          <input name="visible" type="checkbox" checked style="width:auto;" />
          <span>让对方可见</span>
        </label>
        <button class="primary-btn" type="submit">保存</button>
      </form>
    </section>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("moment-form").addEventListener("submit", submitMomentForm);
  
  setupVoiceRecorder();
  setupImageUploader();
}

let selectedImages = [];

function setupImageUploader() {
  const addBtn = document.getElementById("add-image");
  const input = document.getElementById("image-input");
  const preview = document.getElementById("image-preview");
  const countEl = document.getElementById("image-count");

  if (!addBtn || !input) return;

  addBtn.addEventListener("click", () => input.click());

  input.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach(file => {
      if (file.type.startsWith("image/") && selectedImages.length < 9) {
        selectedImages.push(file);
      }
    });
    updateImagePreview();
    input.value = "";
  });

  function updateImagePreview() {
    preview.innerHTML = selectedImages.map((file, index) => `
      <div style="position:relative;width:60px;height:60px;">
        <img src="${URL.createObjectURL(file)}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;" />
        <button type="button" onclick="removeImage(${index})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;background:#b85c38;color:#fff;border-radius:50%;border:none;font-size:12px;cursor:pointer;">×</button>
      </div>
    `).join("");
    countEl.textContent = selectedImages.length > 0 ? `${selectedImages.length} 张图片` : "";
  }

  window.removeImage = (index) => {
    selectedImages.splice(index, 1);
    updateImagePreview();
  };
}

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTs = 0;

// 读 blob 的真实时长（秒）；拿不到就回 null
function readAudioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
    };
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      cleanup();
      resolve(Number.isFinite(d) ? d : null);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}

function setupVoiceRecorder() {
  const recordBtn = document.getElementById("record-voice");
  const statusEl = document.getElementById("record-status");

  if (!recordBtn) return;

  recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      recordBtn.textContent = "🎤 录制语音";
      statusEl.textContent = "";
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        recordingStartTs = Date.now();

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });

          const voiceInput = document.querySelector("#moment-form input[name='voice']");
          if (voiceInput) voiceInput.value = URL.createObjectURL(audioBlob);

          // 用真正的 audio.duration 拿真实时长（不靠估算，最准）
          const realSeconds = await readAudioDuration(audioBlob);
          const seconds = Math.max(1, Math.round(realSeconds || (Date.now() - recordingStartTs) / 1000));
          const durationInput = document.querySelector("#moment-form input[name='duration_voice']");
          if (durationInput) durationInput.value = String(seconds);

          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        recordBtn.textContent = "⏹️ 停止录制";
        statusEl.textContent = "正在录制...";
      } catch (error) {
        alert("无法获取麦克风权限，请在浏览器设置中开启麦克风权限");
      }
    }
  });
}

function openRedeemComposer() {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">发起兑换</h3>
        <button class="secondary-btn" id="close-modal">取消</button>
      </div>
      <form id="redeem-form" class="screen">
        <input name="content" placeholder="想兑换什么" required />
        <input name="costPoints" type="number" min="1" placeholder="消耗几点心意" required />
        <textarea name="remark" placeholder="备注"></textarea>
        <button class="primary-btn" type="submit">提交申请</button>
      </form>
    </section>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("redeem-form").addEventListener("submit", submitRedeemForm);
}

function openReviewComposer(id, status) {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">${status === "approved" ? "通过申请" : "拒绝申请"}</h3>
        <button class="secondary-btn" id="close-modal">取消</button>
      </div>
      <form id="review-form" class="screen">
        <textarea name="reviewComment" placeholder="填写处理说明"></textarea>
        <button class="primary-btn" type="submit">确认</button>
      </form>
    </section>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const result = await api(`/api/redeem-requests/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: status,
        reviewComment: String(form.get("reviewComment") || "").trim(),
      }),
    });

    // 同步本地 redeem 列表状态
    if (result && result.request) {
      state.redeemRequests = (state.redeemRequests || []).map((r) =>
        r.id === result.request.id
          ? { ...r, status: result.request.status, reviewComment: result.request.reviewComment }
          : r
      );
      if (state.home && state.home.recentRedeems) {
        state.home.recentRedeems = state.home.recentRedeems.map((r) =>
          r.id === result.request.id
            ? { ...r, status: result.request.status, reviewComment: result.request.reviewComment }
            : r
        );
      }
    }

    closeModal();
    render();
  });
}

function openKissComposer() {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">记录一个吻</h3>
        <button class="secondary-btn" id="close-modal">取消</button>
      </div>
      <form id="kiss-form" class="screen">
        <div class="mode-row" style="margin-top:4px;">
          <button type="button" class="mode-btn active" data-mode="add">增加</button>
          <button type="button" class="mode-btn" data-mode="minus">减少</button>
        </div>
        <input name="amount" type="number" min="1" placeholder="数量（正整数）" required />
        <textarea name="textContent" placeholder="原因 / 备注"></textarea>
        <button class="primary-btn" type="submit">保存</button>
      </form>
    </section>
  `);

  let currentMode = "add";
  document.querySelectorAll("#kiss-form .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll("#kiss-form .mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("kiss-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitKissForm(event, currentMode);
  });
}

function openModal(content) {
  modalLayer.innerHTML = `<div style="padding:16px;max-width:480px;margin:0 auto;">${content}</div>`;
  modalLayer.classList.remove("hidden");
}

function closeModal() {
  modalLayer.classList.add("hidden");
  modalLayer.innerHTML = "";
  selectedImages = [];
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const result = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      skipAuth: true,
      body: JSON.stringify({
        username: String(form.get("username") || "").trim(),
        password: String(form.get("password") || ""),
      }),
    });

    state.token = result.token || "";
    state.user = result.user || null;
    localStorage.setItem("lovers_saved_token", state.token);

    await refreshCurrentRoute();
  } catch (error) {
    renderLogin(error.message || "登录失败");
  }
}

async function submitMomentForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = new FormData();

  payload.set("score", String(form.get("score") || ""));
  payload.set("textContent", String(form.get("textContent") || ""));
  payload.set("isContentVisibleToPartner", form.get("visible") ? "true" : "false");

  const voiceUrl = form.get("voice");
  if (voiceUrl && typeof voiceUrl === "string" && voiceUrl.startsWith("blob:")) {
    try {
      const response = await fetch(voiceUrl);
      const blob = await response.blob();
      payload.set("voice", blob, "recording.webm");
      // 录制时长（秒），录制器填入
      const seconds = Number(form.get("duration_voice") || 0);
      if (seconds > 0) payload.set("duration_voice", String(seconds));
    } catch (error) {
      console.warn("Failed to attach voice recording:", error);
    }
  }

  if (selectedImages.length > 0) {
    selectedImages.forEach((file, index) => {
      payload.append("images", file, `image_${index}.jpg`);
    });
  }

  const result = await api("/api/affection-records", {
    method: "POST",
    body: payload,
  });

  // 同步更新当前用户和首页数据
  if (result && result.me) {
    state.user = { ...state.user, ...result.me };
  }
  if (state.home) {
    if (result && result.me) {
      state.home.me = { ...state.home.me, ...result.me };
    }
    if (result && result.record) {
      state.home.recentRecords = [result.record, ...(state.home.recentRecords || []).filter((r) => r.id !== result.record.id)].slice(0, 3);
    }
  }

  selectedImages = [];
  closeModal();
  await refreshCurrentRoute();
}

async function submitRedeemForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  const result = await api("/api/redeem-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: String(form.get("content") || "").trim(),
      costPoints: Number(form.get("costPoints") || 0),
      remark: String(form.get("remark") || "").trim(),
    }),
  });

  // 同步首页 recentRedeems
  if (state.home && result && result.request) {
    state.home.recentRedeems = [result.request, ...(state.home.recentRedeems || []).filter((r) => r.id !== result.request.id)].slice(0, 3);
  }

  closeModal();
  await refreshCurrentRoute();
}

async function submitKissForm(event, mode) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const amount = Number(form.get("amount") || 0);

  // 前端校验：数量必须 > 0
  if (!Number.isFinite(amount) || amount <= 0) {
    alert("数量必须是正整数");
    return;
  }

  const result = await api("/api/kiss/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: mode === "minus" ? "minus" : "add",
      amount,
      textContent: String(form.get("textContent") || "").trim(),
    }),
  });

  // 同步本地 kiss 状态
  if (state.kiss && result) {
    state.kiss.kissBalance = Number(result.kissBalance ?? state.kiss.kissBalance ?? 0);
    if (result.log) {
      state.kiss.kissLogs = [result.log, ...(state.kiss.kissLogs || []).filter((l) => l.id !== result.log.id)];
    }
  }
  if (state.home && result && typeof result.kissBalance === "number") {
    state.home.kissBalance = result.kissBalance;
  }

  closeModal();
  render();
}

async function markAllNotificationsRead() {
  await api("/api/notifications/read-all", { method: "POST" });
  await refreshCurrentRoute();
}

async function markNotificationRead(id) {
  await api(`/api/notifications/${id}/read`, { method: "POST" });
  await refreshCurrentRoute();
}

async function refreshCurrentRoute() {
  state.loading = true;
  render();

  try {
    const meResult = await api("/api/me");
    state.user = meResult.user || null;

    if (state.route === "home") {
      state.home = await api("/api/home");
    } else if (state.route === "moment") {
      state.selectedRecordId = null;
      const result = await api("/api/affection-records?page=1&pageSize=20");
      state.records = result.list || [];
      if (!state.home) state.home = await api("/api/home");
    } else if (state.route === "redeem") {
      const filter = state.redeemFilter || "all";
      const result = await api(`/api/redeem-requests?filter=${filter}`);
      state.redeemRequests = result.list || [];
      if (!state.home) state.home = await api("/api/home");
    } else if (state.route === "kiss") {
      state.kiss = await api("/api/kiss");
      if (!state.home) state.home = await api("/api/home");
    } else if (state.route === "messages") {
      const filter = state.notificationFilter || "all";
      const result = await api(`/api/notifications?filter=${filter}`);
      state.notifications = result.list || [];
      if (!state.home) state.home = await api("/api/home");
    }

    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    clearSession();
    renderLogin(error.message || "登录已失效");
  }
}

async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = new Headers(options.headers || {});
  
  if (state.token && !options.skipAuth && !isFormData) {
    headers.set("x-auth-token", state.token);
  }

  const fetchOptions = {
    method: options.method || "GET",
    body: options.body,
  };

  if (isFormData) {
    fetchOptions.headers = {};
    if (state.token && !options.skipAuth) {
      fetchOptions.headers["x-auth-token"] = state.token;
    }
  } else {
    fetchOptions.headers = headers;
  }

  const response = await fetch(url, fetchOptions);
  
  if (isFormData) {
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    } else {
      try {
        const err = JSON.parse(text);
        throw new Error(err.error || "请求失败");
      } catch {
        throw new Error("请求失败");
      }
    }
  }

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("接口返回了非 JSON 内容");
    }
  }

  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }

  return data;
}

function handleLogout() {
  clearSession();
  render();
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("lovers_saved_token");
}

function openSettings() {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">个人设置</h3>
        <button class="secondary-btn" id="close-modal">关闭</button>
      </div>
      <form id="settings-form" class="screen">
        <input name="nickname" placeholder="修改昵称" value="${state.user ? escapeAttr(state.user.nickname || "") : ""}" />
        <input name="currentPassword" type="password" placeholder="当前密码" />
        <input name="newPassword" type="password" placeholder="新密码" />
        <button class="primary-btn" type="submit">保存修改</button>
      </form>
    </section>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("settings-form").addEventListener("submit", submitSettingsForm);
}

async function submitSettingsForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const nickname = String(form.get("nickname") || "").trim();
  const currentPassword = String(form.get("currentPassword") || "");
  const newPassword = String(form.get("newPassword") || "");

  if (!nickname && !currentPassword && !newPassword) {
    alert("请至少修改一项");
    return;
  }

  try {
    const payload = {};
    if (nickname) payload.nickname = nickname;
    if (currentPassword && newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    } else if (currentPassword || newPassword) {
      alert("请同时输入当前密码和新密码");
      return;
    }

    const result = await api("/api/users/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (result.user) {
      state.user = result.user;
      alert("修改成功");
    }
  } catch (error) {
    alert(error.message || "修改失败");
  }

  closeModal();
  render();
}

function openForgotPassword() {
  openModal(`
    <section class="card">
      <div class="title-row">
        <h3 class="mini-title">忘记密码</h3>
        <button class="secondary-btn" id="close-modal">取消</button>
      </div>
      <form id="forgot-form" class="screen">
        <input name="username" placeholder="用户名" required />
        <div style="margin:12px 0;">
          <p style="color:#7a6356;font-size:14px;margin-bottom:8px;">安全问题：对方的生日是什么时候？（格式：060107）</p>
          <input name="birthday" placeholder="例如：060107" maxlength="6" />
        </div>
        <input name="newPassword" type="password" placeholder="新密码" required />
        <button class="primary-btn" type="submit">重置密码</button>
      </form>
    </section>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("forgot-form").addEventListener("submit", submitForgotPassword);
}

async function submitForgotPassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("username") || "").trim();
  const birthday = String(form.get("birthday") || "").trim();
  const newPassword = String(form.get("newPassword") || "");

  try {
    const result = await api("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      skipAuth: true,
      body: JSON.stringify({ username, birthday, newPassword }),
    });

    alert("密码重置成功，请使用新密码登录");
    closeModal();
  } catch (error) {
    alert(error.message || "密码重置失败");
  }
}

function statusText(status) {
  if (status === "pending") return "待处理";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已拒绝";
  if (status === "cancelled") return "已撤回";
  return status || "未知";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
