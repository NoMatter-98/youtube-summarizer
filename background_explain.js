// background.js - 插件的后台服务工作者

/**
 * 当用户点击插件图标时触发
 */
chrome.action.onClicked.addListener(async (tab) => { 
  // chrome 是一个由浏览器注入的全局对象（你可以把它想象成一个巨大的工具箱）。
  // action 是 chrome 对象中的一个属性，代表了插件图标的行为。
  // onClicked 是 action 的一个事件监听对象，当用户“点击”插件图标时会触发这个事件。
  // addListener 是一个函数（方法），用来注册一个事件监听器（也就是说，当click事件发生时，执行async (tab) => { ... }这个函数）。
  // async (tab) => { ... } 是一个异步函数，参数 tab 代表了当前标签页的信息。
  


  if (tab.url && tab.url.includes("youtube.com/watch")) {
    // 检查当前网页地址是否存在，且是否是 YouTube 视频页
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