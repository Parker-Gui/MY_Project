import { clearBluetoothDebugLogs, getBluetoothDebugInfo } from '../../services/bluetooth'

type DebugLogView = {
  id: string
  time: string
  direction: string
  status: string
  hex: string
  message: string
}

Page({
  data: {
    deviceName: '未连接',
    deviceId: '无',
    services: ['无'],
    characteristics: ['无'],
    logs: [] as DebugLogView[],
  },

  onShow() {
    this.loadDebugInfo()
  },

  loadDebugInfo() {
    const debugInfo = getBluetoothDebugInfo()
    const connectionInfo = debugInfo.connectionInfo
    const services = debugInfo.services.length
      ? debugInfo.services
      : [connectionInfo ? connectionInfo.serviceId : '无']
    const characteristics = debugInfo.characteristics.length
      ? debugInfo.characteristics
      : connectionInfo
        ? [connectionInfo.writeCharacteristicId, connectionInfo.notifyCharacteristicId]
        : ['无']

    this.setData({
      deviceName: connectionInfo ? connectionInfo.name : '未连接',
      deviceId: connectionInfo ? connectionInfo.deviceId : '无',
      services,
      characteristics,
      logs: debugInfo.logs.map((log, index) => ({
        id: `${log.time}-${index}`,
        time: log.time,
        direction: log.direction.toUpperCase(),
        status: log.status === 'ok' ? '成功' : '失败',
        hex: log.hex || '-',
        message: log.message || '',
      })),
    })
  },

  handleRefresh() {
    this.loadDebugInfo()

    wx.showToast({
      title: '已刷新',
      icon: 'none',
    })
  },

  handleClearLogs() {
    wx.showModal({
      title: '清空日志',
      content: '确定清空最近蓝牙调试日志吗？',
      confirmText: '清空',
      confirmColor: '#f31b33',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        clearBluetoothDebugLogs()
        this.loadDebugInfo()

        wx.showToast({
          title: '已清空',
          icon: 'none',
        })
      },
    })
  },
})
