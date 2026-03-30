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
      #${SUMMARY_CONTAINER_ID} p {
        margin-bottom: 12px;
        line-height: 1.5;
      }
      #${SUMMARY_CONTAINER_ID} strong {
        font-weight: bold;
      }
      .youtube-summarizer-timestamp {
        cursor: pointer;
        color: var(--yt-spec-call-to-action);
        font-weight: bold;
        text-decoration: none;
      }
      .youtube-summarizer-timestamp:hover {
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 将时间戳字符串（如 [01:35] 或 [01:02:15]）转换为总秒数。
   * @param {string} ts - 时间戳字符串。
   * @returns {number} 总秒数。
   */
  function timestampToSeconds(ts) {
    if (!ts) return 0;
    const timeString = ts.replace(/[^\d:]/g, '');
    const parts = timeString.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) { // [HH:MM:SS]
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) { // [MM:SS]
      seconds = parts[0] * 60 + parts[1];
    }
    return seconds;
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

    injectStyles();

    const secondary = document.getElementById('secondary');
    if (!secondary) {
      console.error('YouTube Summarizer: 无法找到用于注入 UI 的侧边栏。');
      return null;
    }

    container = document.createElement('div');
    container.id = SUMMARY_CONTAINER_ID;

    const title = document.createElement('h3');
    title.textContent = '✨ 视频摘要';

    const content = document.createElement('div');
    content.id = 'youtube-summarizer-content';
    content.textContent = '正在请求摘要...';

    Object.assign(container.style, {
      border: '1px solid var(--yt-spec-10-percent-layer)',
      borderRadius: '12px',
      padding: '16px',
      margin: '0 0 16px 0',
      backgroundColor: 'var(--yt-spec-brand-background-solid)',
      color: 'var(--yt-spec-text-primary)',
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '14px',
    });
    Object.assign(title.style, {
      fontSize: '18px',
      fontWeight: 'bold',
      margin: '0 0 12px 0',
    });
    Object.assign(content.style, {
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
      maxHeight: '400px',
      overflowY: 'auto',
    });

    container.appendChild(title);
    container.appendChild(content);
    secondary.prepend(container);

    content.addEventListener('click', (event) => {
      if (event.target.classList.contains('youtube-summarizer-timestamp')) {
        event.preventDefault();
        const timestamp = event.target.dataset.time;
        const seconds = timestampToSeconds(timestamp);
        
        const player = document.querySelector('video') || document.querySelector('.html5-main-video');
        if (player) {
          player.currentTime = seconds;
          player.play();
        } else {
          console.error('YouTube Summarizer: 无法找到播放器。');
        }
      }
    });

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
      contentDiv.textContent = text;
    } else {
      // 1. Convert **bold** to <strong>bold</strong>
      let processedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      
      // 2. Convert timestamps to clickable links
      processedText = processedText.replace(/(?:\[)?(\b\d{1,2}:\d{2}(?::\d{2})?\b)(?:\])?/g, (match, timeStr) => {
        return `<a href="#" class="youtube-summarizer-timestamp" data-time="${match}">${match}</a>`;
      });
      
      // 3. Wrap each line in a <p> tag
      contentDiv.innerHTML = processedText.split('\n').map(line => `<p>${line}</p>`).join('');
    }
  }

  /**
   * 轮询函数，用于定期检查任务状态。
   * @param {string} taskId - 要查询的任务 ID
   * @param {number} attempts - 当前尝试次数
   */
  async function pollForResult(taskId, attempts = 0) {
    const MAX_ATTEMPTS = 360; // ~30 分钟
    const POLLING_INTERVAL = 5000; // 5 秒

    if (attempts >= MAX_ATTEMPTS) {
      updateSummaryContent("总结任务超时，请稍后再试。", true);
      return;
    }

    try {
      const response = await fetch(`http://localhost:3000/status/${taskId}`);
      const task = await response.json();

      if (task.status === 'complete') {
        updateSummaryContent(task.data.summary);
      } else if (task.status === 'error') {
        updateSummaryContent(`总结失败: ${task.data.error}`, true);
      } else if (task.status === 'processing') {
        setTimeout(() => pollForResult(taskId, attempts + 1), POLLING_INTERVAL);
      } else {
        updateSummaryContent("总结失败: 未知的任务状态。", true);
      }
    } catch (error) {
      console.error("轮询时出错:", error);
      updateSummaryContent(`总结失败: 轮询状态时出错: ${error.message}`, true);
    }
  }
  
  /**
   * 在 YouTube SPA 导航时移除摘要框。
   */
  function handleNavigation() {
    const summaryContainer = document.getElementById(SUMMARY_CONTAINER_ID);
    if (summaryContainer) {
      summaryContainer.remove();
    }
  }
  
  // 监听 YouTube 的 "navigate" 事件
  document.body.addEventListener('yt-navigate-finish', handleNavigation, true);


  // 监听来自 background.js 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_LOADING') {
      updateSummaryContent('正在为您总结，请稍候... 这可能需要几分钟。');
    } else if (request.type === 'START_POLLING') {
      pollForResult(request.taskId);
    } else if (request.type === 'SHOW_ERROR') {
      updateSummaryContent(`总结失败: ${request.error}`, true);
    }
  });
}