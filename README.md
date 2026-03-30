# YouTube Summarizer - Chrome 插件

一个功能强大的 Chrome 扩展程序，旨在为您节省时间。它可以一键总结任何 YouTube 视频的核心内容，无论视频是否提供字幕。

## ✨ 核心功能

- **一键快速总结**：在观看视频时，直接从浏览器工具栏启动，无需离开当前页面。
- **广泛的视频支持**：
    - **对于有字幕的视频**：利用 `youtube_transcript_api` 直接提取官方或自动生成的字幕进行总结。
    - **对于无字幕的视频**：自动下载视频音轨，通过 AI 模型（计划中：Whisper）进行高精度语音转文字，然后再进行总结。
- **智能缓存系统**：所有总结结果都会被缓存在本地的 SQLite 数据库中。对于已经总结过的视频，可以实现秒级响应，并有效节省 API 调用成本。
- **（计划中）精准时间戳导航**：总结的要点将附带可点击的时间戳，点击后可直接跳转到视频的相应位置。
- **异步处理**：后端采用任务队列处理耗时操作，前端可轮询状态，避免了长时间的等待和请求超时。

## 🛠️ 技术栈

- **前端**: Chrome Extension APIs (Manifest V3), JavaScript
- **后端**: Node.js, Express.js
- **AI / ML**:
    - **总结**: Google Gemini 1.5 Flash API
    - **转录**: YouTube Transcript API / OpenAI Whisper API (计划中)
- **数据库**: SQLite (`sqlite3`)
- **Python 脚本**: 用于与 `youtube_transcript_api` 交互
- **音频处理**: `yt-dlp-exec`, `fluent-ffmpeg`

## 🚀 安装与设置

请按照以下步骤在本地设置和运行项目：

### 1. 克隆仓库

```bash
git clone <你的仓库URL>
cd youtube-summarizer
```

### 2. 配置环境变量

复制 `.env.example` 文件并重命名为 `.env`。

```bash
# 在 Windows 上
copy .env.example .env
```

然后，在 `.env` 文件中填入你的 API 密钥。

```ini
# 谷歌 Gemini API 密钥，用于文本总结
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE

# (可选) OpenAI Whisper API 密钥，用于为无字幕视频生成带时间戳的转录
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
```

### 3. 安装后端依赖 (Node.js)

确保你已安装 [Node.js](https://nodejs.org/)。然后在项目根目录运行：

```bash
npm install 或者 npm ci
```

### 4. 安装 Python 环境

确保你已安装 [Python](https://www.python.org/) (推荐 3.9+)。

```bash
# 创建一个虚拟环境
python -m venv .venv

# 激活虚拟环境
# Windows
.\.venv\Scripts\activate
# macOS / Linux
# source .venv/bin/activate

# 安装 Python 依赖
pip install -r requirements.txt
```

### 5. 加载 Chrome 扩展

1.  打开 Chrome 浏览器，访问 `chrome://extensions`。
2.  开启右上角的 “**开发者模式**” (Developer mode)。
3.  点击 “**加载已解压的扩展程序**” (Load unpacked)。
4.  选择本项目所在的 `youtube-summarizer` 文件夹。
5.  你应该能在工具栏看到插件的图标。

## ▶️ 使用方法

1.  **启动后端服务器**：
    在项目根目录，直接运行 `start.bat` 文件。它会自动激活 Python 环境并启动 Node.js 服务器。
    ```bash
    .\start.bat
    ```
    你应该会看到服务器在 `http://localhost:3000` 上监听的日志。

2.  **使用插件**：
    - 打开一个 YouTube 视频页面。
    - 点击浏览器工具栏上的插件图标。
    - 插件会开始处理，你可以通过 `GET /status/:taskId` 查看后台任务状态。完成后，摘要将显示在页面上。

## 📝 开发计划

本项目的详细开发历史和未来计划记录在以下文件中：
- [**Develop_Plan.md**](./Develop_Plan.md): 初始 MVP 和音频处理功能的开发记录。
- [**Develop_Plan2.md**](./Develop_Plan2.md): 当前和未来的功能增强计划（数据库、时间戳、UI改进等）。
