// content.js - 负责在 YouTube 页面上注入和管理 UI

// 使用一个全局变量作为“哨兵”，防止脚本被重复注入和执行
if (typeof window.summarizerInjected === 'undefined') {
  window.summarizerInjected = true;

  const SUMMARY_CONTAINER_ID = 'youtube-summarizer-container';
  const STYLE_ID = 'youtube-summarizer-styles';

  /**
   * 注入自定义样式，用于美化摘要内容的显示。
   */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SUMMARY_CONTAINER_ID} ul {
        padding-left: 20px;
        margin: 8px 0;
      }
      #${SUMMARY_CONTAINER_ID} li {
        margin-bottom: 10px;
        line-height: 1.4;
      }
      #${SUMMARY_CONTAINER_ID} code {
        font-size: 0.9em;
        background-color: var(--yt-spec-badge-chip-background);
        padding: 2px 5px;
        border-radius: 4px;
        font-family: "Roboto Mono", monospace;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 创建或获取已存在的摘要 UI 容器。
   * @returns {HTMLElement|null} 摘要容器元素或 null。
   */
  function getOrCreateSummaryBox() {
    let container = document.getElementById(SUMMARY_CONTAINER_ID);
    if (container) {
      return container;
    }

    // 注入样式
    injectStyles();

    const secondary = document.getElementById('secondary');
    if (!secondary) {
      console.error('YouTube Summarizer: 无法找到用于注入 UI 的侧边栏。');
      return null;
    }

    // --- 创建 UI 元素 ---
    container = document.createElement('div');
    container.id = SUMMARY_CONTAINER_ID;

    const title = document.createElement('h3');
    title.textContent = '✨ 视频摘要';

    const content = document.createElement('div');
    content.id = 'youtube-summarizer-content';
    content.textContent = '正在请求摘要...';

    // --- 添加样式 (适配 YouTube 暗色/亮色主题) ---
    Object.assign(container.style, {
      border: '1px solid var(--yt-spec-10-percent-layer)',
      borderRadius: '12px',
      padding: '16px',
      margin: '0 0 16px 0',
      backgroundColor: 'var(--yt-spec-brand-background-solid)',
      color: 'var(--yt-spec-text-primary)',
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
    });
    Object.assign(title.style, {
      fontSize: '18px',
      fontWeight: 'bold',
      margin: '0 0 12px 0',
    });
    Object.assign(content.style, {
      whiteSpace: 'pre-wrap', // 保留总结中的换行
      wordWrap: 'break-word',
    });

    // --- 组装并注入页面 ---
    container.appendChild(title);
    container.appendChild(content);
    secondary.prepend(container); // 插入到相关视频列表的顶部

    return container;
  }

  /**
   * 更新摘要框中的内容。
   * @param {string} text - 要显示的文本。
   * @param {boolean} isError - 如果是错误信息，则显示为红色。
   */
  function updateSummaryContent(text, isError = false) {
    const container = getOrCreateSummaryBox();
    if (!container) return;

    const contentDiv = container.querySelector('#youtube-summarizer-content');
    if (!contentDiv) return;

    contentDiv.style.color = isError ? 'var(--yt-spec-error-indicator)' : 'var(--yt-spec-text-primary)';

    if (isError) {
      // 对于错误信息，直接显示纯文本
      contentDiv.textContent = text;
    } else {
      // 对于总结内容，将 Markdown 格式转换为 HTML
      const lines = text.split('\n');
      let htmlOutput = '';
      let listOpen = false;

      for (const line of lines) {
        const trimmedLine = line.trim();
        // 检查是否为项目符号列表
        if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
          if (!listOpen) {
            htmlOutput += '<ul>';
            listOpen = true;
          }
          // 转换行内 Markdown (加粗和时间戳)
          const itemContent = trimmedLine.substring(2)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/(\[([0-9]{2}:){2}[0-9]{2}\])/g, '<code>$1</code>');
          htmlOutput += `<li>${itemContent}</li>`;
        } else {
          if (listOpen) {
            htmlOutput += '</ul>';
            listOpen = false;
          }
          if (trimmedLine) {
            htmlOutput += `<p>${trimmedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
          }
        }
      }

      if (listOpen) htmlOutput += '</ul>';
      contentDiv.innerHTML = htmlOutput;
    }
  }

  /**
   * 轮询函数，用于定期检查任务状态。现在这个函数在 content.js 中运行，生命周期和页面一样长。
   * @param {string} taskId - 要查询的任务 ID
   * @param {number} attempts - 当前尝试次数
   */
  async function pollForResult(taskId, attempts = 0) {
    const MAX_ATTEMPTS = 360; // 最多尝试 360 次 (约 30 分钟)
    const POLLING_INTERVAL = 5000; // 每 5 秒轮询一次

    if (attempts >= MAX_ATTEMPTS) {
      const errorMsg = "总结任务超时，请稍后再试。";
      console.error(`Task ${taskId} timed out.`);
      updateSummaryContent(errorMsg, true);
      return;
    }

    try {
      // content.js 直接请求后端，因为 manifest.json 中有 host_permissions
      const response = await fetch(`http://localhost:3000/status/${taskId}`);
      const task = await response.json();

      if (task.status === 'complete') {
        updateSummaryContent(task.data.summary);
      } else if (task.status === 'error') {
        updateSummaryContent(`总结失败: ${task.data.error}`, true);
      } else if (task.status === 'processing') {
        // 任务仍在进行中，设定下一次轮询
        setTimeout(() => pollForResult(taskId, attempts + 1), POLLING_INTERVAL);
      } else {
        updateSummaryContent("总结失败: 未知的任务状态。", true);
      }
    } catch (error) {
      console.error("轮询时出错:", error);
      updateSummaryContent(`总结失败: 轮询状态时出错: ${error.message}`, true);
    }
  }

  // 监听来自 background.js 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_LOADING') {
      // 确保UI已创建并显示加载信息
      updateSummaryContent('正在为您总结，请稍候... 这可能需要几分钟。');
    } else if (request.type === 'START_POLLING') {
      // 收到 background.js 的指令，开始轮询
      pollForResult(request.taskId);
    } else if (request.type === 'SHOW_ERROR') {
      // 处理来自 background.js 的初始错误（例如，启动任务失败）
      updateSummaryContent(`总结失败: ${request.error}`, true);
    }
  });
}