// background.js - 插件的后台服务工作者

/**
 * 当用户点击插件图标时触发
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes("youtube.com/watch")) {
    try {
      // 1. 立即向 content.js 发送消息，让它显示加载 UI。
      // 我们假设 content.js 已由 manifest.json 自动注入。
      await chrome.tabs.sendMessage(tab.id, { type: "SHOW_LOADING" });

      // 2. 调用后端 /summarize API，获取任务 ID
      const response = await fetch("http://localhost:3000/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: tab.url }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      const { taskId } = await response.json();
      // 3. 将任务 ID 发送给 content.js，由它接管轮询任务
      await chrome.tabs.sendMessage(tab.id, { type: "START_POLLING", taskId: taskId });
    } catch (error) {
      console.error("启动总结任务时出错:", error);
      // 如果在启动阶段就出错，也通知 content.js 显示错误
      await chrome.tabs.sendMessage(tab.id, { type: "SHOW_ERROR", error: error.message });
    }
  }
});