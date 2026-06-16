// 检查 express.static 的 setHeaders 是否被调用
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use("/uploads", express.static("uploads", {
  setHeaders: (res, p) => {
    console.log("[setHeaders] path =", p);
    if (p.toLowerCase().endsWith(".webm")) {
      res.setHeader("Content-Type", "audio/webm");
      console.log("[setHeaders] override to audio/webm");
    }
  },
}));

app.get("/test", (req, res) => res.send("hi"));

app.listen(3001, async () => {
  // 写一个 .webm 文件
  fs.writeFileSync("uploads/test.webm", "FAKEWEBM");
  // 用 fetch 拉一下
  const r = await fetch("http://localhost:3001/uploads/test.webm");
  console.log("status =", r.status);
  console.log("Content-Type =", r.headers.get("content-type"));
  process.exit(0);
});
