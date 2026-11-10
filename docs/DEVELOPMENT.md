# 开发与维护说明

## 技术概况

纯静态网页，没有框架、没有构建步骤：`index.html` + `css/style.css` + `js/game.js`，浏览器原生 Canvas 2D、Web Audio、MediaRecorder。

- **设计基准**：390 设计单位宽（iPhone 13/14），按屏幕宽度等比缩放；可用高度低于 640 时按高度缩放并居中。
- **字体**：Poppins ExtraBold Italic（界面字）、Bangers（数字），来自 Google Fonts。
- **主色**：黄 `#FFE600`、品红 `#FF2E93`、青 `#00C2FF` / `#25F4EE`、红 `#FF2A2A` / `#FE2C55`、黑 `#111111`。
- **本地存储**（localStorage）：`vb_center3` 声控中心音高，`vb_sing_lo` / `vb_sing_hi` 唱歌音域，`vb_best` / `vb_best_sing` 最高分。

## js/game.js 结构

文件按区块组织，每块以 `// ====` 注释分隔，顺序如下：

| 区块 | 内容 |
| --- | --- |
| 配置 | 设计尺寸、音高范围 `RANGE`、速度、板子尺寸等常量 |
| DOM / 布局 | `layout()`：屏幕适配，计算缩放 `S`、偏移 `dCam` / `dBot` |
| 音高检测 | YIN → 八度折叠与纠错 → 中值 → One Euro 滤波 → `pitchToT()` 映射到板子位置；`adaptCenter()` / `endNote()` 按音符校准中心音高 |
| 摄像头 / 麦克风 | `initMedia()` 申请权限并给出提示；`setupMic()` 唱歌模式开回声消除 |
| 录制 | 离屏 canvas 合成画面 + 混音，MediaRecorder 录制 |
| 界面流程 | `setScreen()`：camera → rec ⇄ paused → edit / feed；`actions` 是所有按钮的处理函数 |
| 游戏 | `newRound()`、`launch()`、`bounce()`、`updateBall()`（碰撞判定）、`updatePaddle()` |
| 唱歌模式 | 合成伴奏、节拍时钟、落点判定 |
| 绘制 | 大海、钢琴舞台、撞击特效、结算气泡、记分板、波点 |
| 主循环 | `loop()`：每帧更新音高 → 板子 → 球 → 特效 → 绘制 → 录制帧 |

## 本地开发

```bash
npm run serve                                   # http://localhost:3000/ ，禁用缓存
npx -y cloudflared tunnel --url http://localhost:3000   # 手机测试：摄像头/麦克风必须 HTTPS
```

调试：网址加 `?debug` 显示实时音高面板（Hz、距中心半音数、中心音高、音高轨迹）。

## 测试

需要先启动 `npm run serve`，本机装有 Chrome（其他路径用 `CHROME_PATH` 指定，其他地址用 `BASE_URL` 指定）。测试通过 `?qa` 读取游戏内部状态，用假摄像头和可控音高的假麦克风驱动游戏。

| 命令 | 覆盖内容 |
| --- | --- |
| `npm run test:viewport` | 7 种手机尺寸不溢出、按钮在屏幕内、横屏提示；截图存到 `tests/output/` |
| `npm run test:permissions` | 全允许 / 拒绝麦克风 / 拒绝摄像头 / 都拒绝 / 非 HTTPS，提示文案与手指拖动兜底 |
| `npm run test:flow` | 录制、停止、继续、Retry（含连点）、模式切换、回声消除开关、成片页 |
| `npm run test:collision` | 完美玩家能接到 40 分（含最高速度）；躲开必掉水 |
| `npm run test:pitch` | 高 → 低、隔空低音、超低音到最左；保存的中心音高偏了能自动纠正 |

改动音高或碰撞逻辑后务必跑对应测试；真人声音和 iOS 特有问题仍需真机验证。

## 部署

推送到 `main` 即自动部署（`.github/workflows/deploy.yml`）：

1. 只把 `index.html`、`css/`、`js/`、`assets/` 打包发布，`design/`、`tools/`、`tests/` 不上线。
2. `index.html` 里 css/js 链接的 `__BUILD__` 会替换成提交哈希，用户刷新就能拿到新版本，不会被缓存卡住。
3. 在 GitHub 仓库的 Actions 页可以看到进度，失败可点 Re-run；也可手动触发 “Deploy to GitHub Pages”。

GitHub 仓库设置 → Pages → Source 需为 **GitHub Actions**。

## 素材与导出

- 新素材放进 `assets/` 对应子目录，并在代码里改路径；替换同名文件时把引用处的 `?v=` 数字加一，避免手机缓存旧图。
- 音效需为 mp3（iPhone 不支持 ogg），音频来源须为 CC0 或已获授权，商业歌曲不能放进仓库。
- 重新生成设计导出：`pip install fonttools pillow` 后运行 `npm run export`，输出到 `design/exports/`。

## 设计导出清单（design/exports/）

| 路径 | 内容 |
| --- | --- |
| `sea.svg` | 大海 |
| `score-card.svg`、`score-card-parts/` | 结算气泡整体与拆件（气泡、数字 1–20、下划线、Score 字） |
| `sticker-*.svg` | 评级贴纸 |
| `hud/` | 顶部记分板 0–20、左右上角波点 |
| `impact/` | 撞击特效 4 级及分解图 |
| `sing/` | 钢琴舞台、歌词、倒计时、落点提示、音符 |
| `retry-button*.svg` | Retry 按钮（常态 / 按下） |
