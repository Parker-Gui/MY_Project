// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() {
    // 记录启动日志，保留给 logs 页面展示。
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    wx.login({
      success: () => {},
    })
  },
})
