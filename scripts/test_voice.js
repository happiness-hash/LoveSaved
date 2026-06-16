// 测试录音上传 + 校验 duration 进入数据库
const BASE = process.env.BASE || "http://localhost:3000";

(async () => {
  // 登录
  const login = await fetch(BASE + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "zjl", password: "040923" }),
  });
  const loginBody = await login.json();
  if (!loginBody.token) {
    console.error("login fail", loginBody);
    return;
  }
  const token = loginBody.token;

  // 模拟录音
  const fakeAudioBytes = Buffer.from("RIFFFAKEAUDIO");
  const audioBlob = new Blob([fakeAudioBytes], { type: "audio/webm" });

  const fd = new FormData();
  fd.set("score", "5");
  fd.set("textContent", "录音测试 + duration");
  fd.set("isContentVisibleToPartner", "true");
  fd.set("voice", audioBlob, "recording.webm");
  fd.set("duration_voice", "12");

  const res = await fetch(BASE + "/api/affection-records", {
    method: "POST",
    headers: { "x-auth-token": token },
    body: fd,
  });
  const body = await res.json();
  console.log("status =", res.status);
  console.log("voiceDuration =", body.record && body.record.voiceDuration);
  console.log("voiceLabel =", body.record && body.record.voiceLabel);
  console.log("voiceUrl =", body.record && body.record.voiceUrl);
})();
