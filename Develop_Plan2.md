# 开发计划 V2 - 功能增强与体验优化

这是基于项目现有功能，为后续开发制定的计划。

---

## 阶段一：工作流改进与数据库缓存

**目标：** 简化项目启动流程，并引入数据库缓存以提高效率、节省 API 调用成本。

- [X] **创建一键启动脚本**
  - [X] 在项目根目录创建 `start.bat` 文件。
  - [X] 在脚本中添加命令，实现自动执行以下两步操作：
    1.  激活 Python 虚拟环境 (`.\.venv\Scripts\activate`)
    2.  启动 Node.js 后端服务 (`node .\server.js`)
  - [X] 编写说明，告知用户通过 `Ctrl+C` 或关闭窗口即可停止服务并释放端口。

- [ ] **集成数据库缓存**
  - [X] 为 Node.js 环境安装 `sqlite3` 驱动: `npm install sqlite3`
  - [X] **后端改造 (`server.js`)**
    - [X] 添加数据库初始化逻辑：在服务启动时连接到 SQLite 数据库文件（例如 `db.sqlite`)。
    - [X] 创建一个 `summaries` 表，至少包含 `video_id` (主键), `summary`, `created_at` 三个字段。
    - [X] **重构 `/summarize` 接口逻辑:**
      - [X] **查询缓存:** 收到请求后，根据 `video_id` 优先查询 `summaries` 表。
      - [X] **命中缓存:** 如果数据库中存在记录，则直接返回缓存的 `summary`，不再执行后续流程。
      - [X] **未命中缓存:** 如果数据库中不存在记录，则执行现有的“获取/生成字幕 -> 总结”流程。
      - [X] **写入缓存:** 在成功生成新的 `summary` 后，将其和 `video_id` 一同存入 `summaries` 表，然后再返回给前端。

---

## 阶段二：获取带时间戳的精确字幕

**目标：** 改造现有流程，无论是已有字幕还是AI生成，都能获取到带时间戳的字幕数据。

- [X] **方案A: 针对“有字幕”的视频**
  - [X] **修改 `get_transcript.py`:**
    - [X] 改造脚本，使其不再只返回纯文本。
    - [X] 调用 `youtube_transcript_api` 后，直接返回其原始的 JSON 格式结果，该结果应为一个包含 `text`, `start`, `duration` 字段的数组。
  - [X] **修改 `server.js`:**
    - [X] 调整调用 Python 脚本后的处理逻辑，使其能够正确解析返回的 JSON 数组。



## 横插一个：放到github上
  - [X] git init
  - [X] 写.gitignore
  - [X] 写requirements.txt :   .\.venv\Scripts\python.exe -m pip freeze > requirements.txt
        对于 Node.js 部分，我们不需要额外再创建说明文件，因为这个功能已经由 package.json（npm安装的大包,只有范围版本） 和 package-lock.json(node_modules下的各个小包的精确版本)，在npm install命令时就会自动用这俩去安装了。
        - MAJOR.MINOR.PATCH  主版本（破坏性更新）.次版本（新增功能）.补丁（bug修复）
        - ^1.2.3 即<2.0.0 ，最常见
        - ~1.2.3 即<1.3.0 ， 更稳
        - '*' 无限版本 ， 没人用
 

  - [X] 写README.md
  - [X] 写LICENSE文件，用MIT许可证
  - [X] 上传

- [X] **方案B: 针对“无字幕”的视频**
  - [X] **替换转写引擎:**
    - [X] 决策选择一个支持时间戳功能的语音转文本（STT）服务（**推荐: OpenAI Whisper API**）。
    段级（segment-level）时间戳，openai 默认的whisper是可以支持的，生成字幕足够用
    逐词（word-level）时间戳，是没有的。WhisperX在 Whisper 后面加一步：用 wav2vec 做 forced alignment所以 word-level。WhisperX不是一个“独立的语音识别模型”,他是一条流水线工厂：音频 → Whisper → 文本 → 对齐模型 → 精确时间戳
    - [X] npm install openai
    - [X] 移除 `server.js` 中调用 `gemini-3-flash-preview` **进行转写**的部分。不要什么`gemini-1.5-flash`了！！！
    - [X] 将其替换为调用新的 STT 服务的 API。
  - [X] **实现新 API 的调用:**
    - [X] 确保在调用新 API 时，配置了可以返回详细时间戳的参数（例如 Whisper API 的 `response_format="verbose_json"`）。
    - [X] 调整代码，以正确处理和拼接从新 API 返回的、带时间戳的字幕数据。

---

## 阶段三：前端交互升级 - 可点击的时间戳

**目标：** 实现摘要中的时间戳与视频播放的联动。

- [X] **生成包含时间戳的摘要**
  - [X] **设计 Prompt:** 调整向 Gemini **进行总结**的 Prompt。在输入中包含我们从阶段二获取到的带时间戳的字幕，并要求它在生成总结时，能在段落开头附上对应的时间点（例如 `[02:15]`），再加本段一句话结论，再是本段的小结，这样的结构。

- [X] **前端脚本改造 (`background.js` 或 `content.js`)**
  - [X] **解析时间戳:** 在注入前端的脚本中，增加一个函数，用于通过正则表达式查找并解析摘要文本中的时间戳（例如 `[HH:MM:SS]` 或 `[MM:SS]` 格式）。
  - [X] **创建超链接:** 将所有解析出的时间戳文本，动态地渲染成可点击的 `<a>` 标签。
  - [X] **添加点击事件:**
    - [ ] 为这些 `<a>` 标签绑定点击事件。
    - [ ] 在事件处理函数中，将时间戳文本（如 `[01:35]`）转换为总秒数（95秒）。
    - [ ] 获取页面中的 YouTube 播放器对象，并调用其 `seekTo()` 方法，将视频播放位置跳转到对应的秒数。

- [ ] **界面美化**
  - [ ] **Enhance text formatting----markdown加载样式**
  - [ ] **Modify the summary box style----container/box四面框线、border 固定窗口大小，scrollbar 可以上下滑动**
  - [ ] **Ensure the summary resets 加载到下一个视频时候，摘要窗口要退场**


