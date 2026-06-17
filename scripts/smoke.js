// 简单的接口自测脚本
// 用法：node scripts/smoke.js

const BASE = process.env.BASE || "http://localhost:3000";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("OK  :", msg);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (e) { body = text; }
  }
  return { status: res.status, body };
}

(async () => {
  console.log("=== smoke test @", BASE);

  // 1) 登录 zjl
  const login = await req("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "zjl", password: "040923" }),
  });
  if (login.status !== 200) fail("login zjl " + JSON.stringify(login));
  if (!login.body.token) fail("login token missing");
  if (login.body.user.username !== "zjl") fail("login user.username expected 'zjl', got " + login.body.user.username);
  ok("login zjl: token + username present");
  const token = login.body.token;

  // 2) /api/home 校验 me 包含 username
  const home = await req("/api/home", { headers: { "x-auth-token": token } });
  if (home.status !== 200) fail("/api/home " + JSON.stringify(home));
  if (home.body.me.username !== "zjl") fail("/api/home me.username missing");
  if (home.body.partner && home.body.partner.username !== "wq") fail("/api/home partner.username");
  if (!Array.isArray(home.body.recentRedeems)) fail("/api/home recentRedeems not array");
  const sample = home.body.recentRedeems[0];
  if (sample && (sample.applicantUserId === undefined || sample.costPoints === undefined || sample.remark === undefined || sample.reviewComment === undefined)) {
    fail("/api/home recentRedeems missing fields: " + JSON.stringify(sample));
  }
  ok("/api/home me/partner have username; recentRedeems has full fields");

  // 3) /api/affection-records 列表是 list 不是 items
  const affList = await req("/api/affection-records?page=1&pageSize=5", { headers: { "x-auth-token": token } });
  if (affList.status !== 200) fail("/api/affection-records " + JSON.stringify(affList));
  if (!Array.isArray(affList.body.list)) fail("/api/affection-records.list missing");
  if (affList.body.items !== undefined) fail("/api/affection-records still has items field");
  ok("/api/affection-records returns list, no items");

  // 4) POST /api/affection-records 用 isContentVisibleToPartner=false
  const fd = new FormData();
  fd.set("score", "3");
  fd.set("textContent", "smoke 私密测试");
  fd.set("isContentVisibleToPartner", "false");
  const affCreateRes = await fetch(BASE + "/api/affection-records", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: fd,
  });
  const affCreateText = await affCreateRes.text();
  const affCreate = JSON.parse(affCreateText);
  if (affCreateRes.status !== 201) fail("POST /api/affection-records: " + affCreateText);
  if (!affCreate.ok) fail("POST /api/affection-records ok missing");
  if (!affCreate.record || !affCreate.record.id) fail("POST /api/affection-records record missing");
  if (!affCreate.me || affCreate.me.username !== "zjl") fail("POST /api/affection-records me missing");
  if (affCreate.record.isContentVisibleToPartner !== false) fail("POST /api/affection-records visibility expected false");
  ok("POST /api/affection-records returns {ok,record,me} and respects isContentVisibleToPartner=false");

  // 4b) POST /api/affection-records 附语音 + duration_voice
  const voiceBytes = new TextEncoder().encode("FAKEAUDIO");
  const voiceBlob = new Blob([voiceBytes], { type: "audio/webm" });
  const fd2 = new FormData();
  fd2.set("score", "2");
  fd2.set("textContent", "smoke 录音测试");
  fd2.set("isContentVisibleToPartner", "true");
  fd2.set("voice", voiceBlob, "recording.webm");
  fd2.set("duration_voice", "12");
  const voiceRes = await fetch(BASE + "/api/affection-records", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: fd2,
  });
  const voiceBody = await voiceRes.json();
  if (voiceRes.status !== 201) fail("POST voice: " + JSON.stringify(voiceBody));
  if (!voiceBody.record.voiceUrl) fail("voice record 缺 voiceUrl: " + JSON.stringify(voiceBody.record));
  if (voiceBody.record.voiceDuration !== 12) fail("voice record.voiceDuration 期望 12, 实际 " + voiceBody.record.voiceDuration);
  // 验证文件可访问
  const audioRes = await fetch(BASE + voiceBody.record.voiceUrl);
  if (audioRes.status !== 200) fail("voice 文件 200 期望, got " + audioRes.status);
  // 验证 server 端的 Content-Type 是 audio/webm 而不是 video/webm
  if (!/audio\/webm/i.test(audioRes.headers.get("content-type") || "")) {
    fail("voice Content-Type 期望 audio/webm, got " + audioRes.headers.get("content-type"));
  }
  ok("POST /api/affection-records 带语音：voiceUrl + voiceDuration=12 + 文件可下载 + Content-Type=audio/webm");

  // 4c) 上传带 codecs 后缀的 MIME 也得能通过 fileFilter
  const voiceBlob2 = new Blob([voiceBytes], { type: "audio/webm;codecs=opus" });
  const fd3 = new FormData();
  fd3.set("score", "1");
  fd3.set("textContent", "smoke codec 测试");
  fd3.set("isContentVisibleToPartner", "true");
  fd3.set("voice", voiceBlob2, "recording2.webm");
  const voiceRes2 = await fetch(BASE + "/api/affection-records", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: fd3,
  });
  const voiceBody2 = await voiceRes2.json();
  if (voiceRes2.status !== 201) fail("POST voice codec: " + JSON.stringify(voiceBody2));
  if (!voiceBody2.record.voiceUrl) fail("codec voice 缺 voiceUrl: " + JSON.stringify(voiceBody2.record));
  ok("POST voice 带 audio/webm;codecs=opus 也能成功上传");

  // 5) POST /api/redeem-requests 返回 {ok, request}
  const redeemCreate = await req("/api/redeem-requests", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ content: "smoke 兑换测试", costPoints: 5, remark: "r" }),
  });
  if (redeemCreate.status !== 201) fail("POST /api/redeem-requests " + JSON.stringify(redeemCreate));
  if (!redeemCreate.body.ok || !redeemCreate.body.request) fail("POST /api/redeem-requests response shape wrong");
  if (redeemCreate.body.request.status !== "pending") fail("new redeem status not pending");
  if (redeemCreate.body.request.applicantUserId !== "user-a") fail("new redeem applicantUserId wrong");
  ok("POST /api/redeem-requests returns {ok, request} full shape");

  // 新需求：发起人应看到 redeem_submitted，对方应看到 redeem_pending
  const applicantMine = await req("/api/notifications?filter=mine", { headers: { "x-auth-token": token } });
  if (applicantMine.status !== 200) fail("applicant filter=mine " + JSON.stringify(applicantMine));
  const submitted = (applicantMine.body.list || []).find((n) => n.type === "redeem_submitted" && n.relatedId === redeemCreate.body.request.id);
  if (!submitted) fail("applicant 没有看到 redeem_submitted: " + JSON.stringify(applicantMine.body));
  ok("applicant 在 '我的申请' 中看到 redeem_submitted");

  const applicantPending = await req("/api/notifications?filter=pending", { headers: { "x-auth-token": token } });
  if ((applicantPending.body.list || []).some((n) => n.relatedId === redeemCreate.body.request.id)) {
    fail("applicant 不应该在 '待处理' 中看到自己的申请: " + JSON.stringify(applicantPending.body));
  }
  ok("applicant 在 '待处理' 中看不到自己的申请");

  // 6) 登录 wq 来审批/检查
  const login2 = await req("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "wq", password: "060107" }),
  });
  if (login2.status !== 200) fail("login wq " + JSON.stringify(login2));
  const token2 = login2.body.token;

  // wq 在 待处理 看到 redeem_pending
  const partnerPending = await req("/api/notifications?filter=pending", { headers: { "x-auth-token": token2 } });
  const pending = (partnerPending.body.list || []).find((n) => n.type === "redeem_pending" && n.relatedId === redeemCreate.body.request.id);
  if (!pending) fail("partner 没有在 '待处理' 看到 redeem_pending: " + JSON.stringify(partnerPending.body));
  ok("partner 在 '待处理' 中看到 redeem_pending");

  // wq 在 我的申请 中看不到这个申请（不是他发起的）
  const partnerMine = await req("/api/notifications?filter=mine", { headers: { "x-auth-token": token2 } });
  if ((partnerMine.body.list || []).some((n) => n.relatedId === redeemCreate.body.request.id)) {
    fail("partner 不应该在 '我的申请' 中看到这个申请: " + JSON.stringify(partnerMine.body));
  }
  ok("partner 在 '我的申请' 中看不到对方发起的申请");

  // 7) POST /api/redeem-requests/:id/cancel 由非发起人调用应 403
  const cancelByPartner = await req(`/api/redeem-requests/${redeemCreate.body.request.id}/cancel`, {
    method: "POST",
    headers: { "x-auth-token": token2 },
  });
  if (cancelByPartner.status !== 403) fail("非发起人 cancel 期望 403, got " + cancelByPartner.status);
  ok("非发起人 cancel 被拒 (403)");

  // 8) 发起人自己 cancel
  const cancelByApplicant = await req(`/api/redeem-requests/${redeemCreate.body.request.id}/cancel`, {
    method: "POST",
    headers: { "x-auth-token": token },
  });
  if (cancelByApplicant.status !== 200) fail("applicant cancel: " + JSON.stringify(cancelByApplicant));
  if (!cancelByApplicant.body.ok || cancelByApplicant.body.request.status !== "cancelled") {
    fail("applicant cancel 响应: " + JSON.stringify(cancelByApplicant.body));
  }
  ok("applicant cancel 成功，返回 {ok, request.status=cancelled}");

  // 9) 再次 cancel 应 400
  const cancelAgain = await req(`/api/redeem-requests/${redeemCreate.body.request.id}/cancel`, {
    method: "POST",
    headers: { "x-auth-token": token },
  });
  if (cancelAgain.status !== 400) fail("重复 cancel 期望 400, got " + cancelAgain.status);
  ok("重复 cancel 被拒 (400)");

  // 10) 申请人在 '我的申请' 中应看到一条 redeem_cancelled
  const afterCancelMine = await req("/api/notifications?filter=mine", { headers: { "x-auth-token": token } });
  const cancelledMine = (afterCancelMine.body.list || []).find((n) => n.type === "redeem_cancelled" && n.relatedId === redeemCreate.body.request.id);
  if (!cancelledMine) fail("applicant 取消后没有看到 redeem_cancelled: " + JSON.stringify(afterCancelMine.body));
  ok("applicant 在 '我的申请' 中看到 redeem_cancelled");

  // 11) 申请人在 '待处理' 中不再看到该申请（之前的 redeem_submitted 应被删除）
  const afterCancelPending = await req("/api/notifications?filter=pending", { headers: { "x-auth-token": token } });
  if ((afterCancelPending.body.list || []).some((n) => n.relatedId === redeemCreate.body.request.id)) {
    fail("applicant 取消后仍能看到该申请: " + JSON.stringify(afterCancelPending.body));
  }
  ok("applicant 取消后 '待处理' 中不再有该申请");

  // 12) 对方在 普通提醒 中看到 redeem_cancelled
  const afterCancelPartner = await req("/api/notifications?filter=notice", { headers: { "x-auth-token": token2 } });
  const cancelledPartner = (afterCancelPartner.body.list || []).find((n) => n.type === "redeem_cancelled" && n.relatedId === redeemCreate.body.request.id);
  if (!cancelledPartner) fail("partner 看不到 redeem_cancelled: " + JSON.stringify(afterCancelPartner.body));
  ok("partner 在 '普通提醒' 中看到 redeem_cancelled");

  // 13) 再开一个申请用于走完 review 流程，验 redeem_submitted 在 review 后被删
  const redeemCreate2 = await req("/api/redeem-requests", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ content: "smoke 兑换 2", costPoints: 4, remark: "" }),
  });
  if (redeemCreate2.status !== 201) fail("create2: " + JSON.stringify(redeemCreate2));

  const review = await req(`/api/redeem-requests/${redeemCreate2.body.request.id}/review`, {
    method: "POST",
    headers: { "x-auth-token": token2 },
    body: JSON.stringify({ action: "approved", reviewComment: "smoke OK" }),
  });
  if (review.status !== 200) fail("review2: " + JSON.stringify(review));
  if (review.body.request.status !== "approved") fail("review2 status: " + JSON.stringify(review.body));
  ok("review 返回 {ok, request.status=approved}");

  // review 后 applicant 在 '我的申请' 中看到 redeem_approved，redeem_submitted 应被删
  const afterReviewMine = await req("/api/notifications?filter=mine", { headers: { "x-auth-token": token } });
  const approvedMine = (afterReviewMine.body.list || []).find((n) => n.type === "redeem_approved" && n.relatedId === redeemCreate2.body.request.id);
  if (!approvedMine) fail("applicant review 后没看到 redeem_approved: " + JSON.stringify(afterReviewMine.body));
  if ((afterReviewMine.body.list || []).some((n) => n.type === "redeem_submitted" && n.relatedId === redeemCreate2.body.request.id)) {
    fail("applicant review 后 redeem_submitted 应被删: " + JSON.stringify(afterReviewMine.body));
  }
  ok("review 后 applicant '我的申请' 中 redeem_approved 存在，redeem_submitted 已删");

  // 14) /api/kiss 加减
  const kissAdd = await req("/api/kiss/logs", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ mode: "add", amount: 2, textContent: "smoke 吻+" }),
  });
  if (kissAdd.status !== 201) fail("POST /api/kiss/logs add: " + JSON.stringify(kissAdd));
  if (!kissAdd.body.ok || typeof kissAdd.body.kissBalance !== "number" || !kissAdd.body.log) {
    fail("kiss add response shape: " + JSON.stringify(kissAdd.body));
  }
  if (kissAdd.body.log.changeAmount !== 2) fail("kiss add changeAmount wrong");
  ok("POST /api/kiss/logs add returns {ok, kissBalance, log}");

  const kissGet = await req("/api/kiss", { headers: { "x-auth-token": token } });
  if (!Array.isArray(kissGet.body.kissLogs)) fail("/api/kiss kissLogs not array");
  ok("/api/kiss returns {kissBalance, kissLogs}");

  const kissMinusBig = await req("/api/kiss/logs", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ mode: "minus", amount: 9999, textContent: "超额" }),
  });
  if (kissMinusBig.status !== 400) fail("kiss minus overflow expected 400, got " + kissMinusBig.status);
  if (!kissMinusBig.body.error || !/小于/.test(kissMinusBig.body.error)) fail("kiss minus overflow error message: " + JSON.stringify(kissMinusBig.body));
  ok("kiss minus 超过余额会被后端拒绝");

  // 15) notifications list
  const notif = await req("/api/notifications?filter=all", { headers: { "x-auth-token": token } });
  if (!Array.isArray(notif.body.list)) fail("/api/notifications.list missing");
  if (notif.body.items !== undefined) fail("/api/notifications still has items");
  ok("/api/notifications returns list");

  // 16) 改密码
  const pwd = await req("/api/users/me", {
    method: "PUT",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ currentPassword: "040923", newPassword: "newpass1" }),
  });
  if (pwd.status !== 200) fail("PUT /api/users/me change password: " + JSON.stringify(pwd));
  if (!pwd.body.user || pwd.body.user.username !== "zjl") fail("PUT /api/users/me response.user missing username");
  ok("PUT /api/users/me 改密码：currentPassword 校验通过");

  const relogin = await req("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "zjl", password: "newpass1" }),
  });
  if (relogin.status !== 200) fail("relogin with new password failed: " + JSON.stringify(relogin));
  ok("新密码能登录");

  const newToken = relogin.body.token;
  const pwd2 = await req("/api/users/me", {
    method: "PUT",
    headers: { "x-auth-token": newToken },
    body: JSON.stringify({ currentPassword: "newpass1", newPassword: "040923" }),
  });
  if (pwd2.status !== 200) fail("PUT /api/users/me restore password: " + JSON.stringify(pwd2));
  ok("已把密码改回原值");

  const pwdBad = await req("/api/users/me", {
    method: "PUT",
    headers: { "x-auth-token": token },
    body: JSON.stringify({ currentPassword: "wrong", newPassword: "x" }),
  });
  if (pwdBad.status !== 401) fail("wrong currentPassword expected 401, got " + pwdBad.status);
  ok("错误当前密码会被拒 (401)");

  // 17) forgot-password
  const forgot = await req("/api/forgot-password", {
    method: "POST",
    body: JSON.stringify({ username: "zjl", birthday: "060107", newPassword: "040923" }),
  });
  if (forgot.status !== 200) fail("forgot-password 失败: " + JSON.stringify(forgot));
  ok("forgot-password 流程仍正常");

  console.log("=== ALL SMOKE TESTS PASSED ===");
})().catch((e) => {
  console.error("UNEXPECTED ERROR:", e);
  process.exit(1);
});
