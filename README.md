# Voice Bounce

仿 TikTok 拍摄特效的声控小游戏：对着手机发声，音高控制板子左右移动，接住弹跳的表情；整局可以录成竖屏视频。

**在线试玩：** https://hannahzz000.github.io/voice-bounce/ （手机 Safari / Chrome 打开，允许摄像头和麦克风）

- **Voice Bounce**（黑色图标，默认）：低音 → 板子往左，高音 → 板子往右；没接住掉进海里，游戏结束。
- **Sing Along**（粉色图标，在特效轮盘上往右滑）：跟着伴奏唱，表情在每句的 “you” 上落到板子上。示例曲为 Happy Birthday。建议戴耳机。

## 目录结构

```
index.html            页面结构（入口）
css/style.css         样式
js/game.js            全部游戏逻辑：音高检测、渲染、录制、音效、两种模式
assets/
  ui/                 TikTok 界面覆盖层（camera / rec / paused / panel / feed）和头像
  effects/            特效轮盘图标
  game/               表情、星星、钢琴
  sfx/                音效（pop 接住、splash 落水，均为 CC0）
design/exports/       给设计稿用的 SVG 导出（文字已转轮廓，可直接拖进 Figma）
tools/
  serve.py            本地无缓存预览服务器
  export/             SVG 导出脚本和字体（Python + fontTools）
tests/                自动化测试（puppeteer + Headless Chrome）
docs/DEVELOPMENT.md   开发、测试、部署说明
.github/workflows/    推送 main 后自动部署到 GitHub Pages
```

## 快速开始

```bash
npm install          # 只为测试安装 puppeteer-core；游戏本身没有构建步骤
npm run serve        # 打开 http://localhost:3000/
npm test             # 跑全部测试（需要先 npm run serve，本机需装 Chrome）
```

改完代码推送到 `main`，GitHub Actions 会自动发布，约 1 分钟后线上生效。详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
