import { connectDevice, getBluetoothDebugInfo, onConnectionStateChange } from '../../services/bluetooth'

type HistoryDevice = {
  id: string
  name: string
  isBound: boolean
}

const HISTORY_STORAGE_KEY = 'historyDevices'
const CURRENT_DEVICE_STORAGE_KEY = 'currentDevice'

Page({
  data: {
    devices: [] as HistoryDevice[],
  },

  onShow() {
    this.loadHistoryDevices()
    this.bindConnectionState()
  },

  /**
   * 蓝牙断开后同步历史记录里的连接状态。
   */
  bindConnectionState() {
    onConnectionStateChange((state) => {
      if (state.connected || !state.reconnectFailed) {
        return
      }

      this.saveHistoryDevices(
        this.data.devices.map((device) => {
          if (device.id !== state.deviceId) {
            return device
          }

          return {
            ...device,
            isBound: false,
          }
        }),
      )
    })
  },

  /**
   * 从本地缓存读取历史设备，数据由引导页连接成功时写入。
   */
  loadHistoryDevices() {
    const devices = (wx.getStorageSync(HISTORY_STORAGE_KEY) || []) as HistoryDevice[]

    this.setData({
      devices,
    })
  },

  /**
   * 更新页面状态并同步写回本地缓存。
   */
  saveHistoryDevices(devices: HistoryDevice[]) {
    wx.setStorageSync(HISTORY_STORAGE_KEY, devices)

    this.setData({
      devices,
    })
  },

  /**
   * 保存当前进入主页的设备，保持历史记录和引导页入口一致。
   */
  saveCurrentDevice(device: HistoryDevice) {
    wx.setStorageSync(CURRENT_DEVICE_STORAGE_KEY, {
      id: device.id,
      name: device.name,
      deviceId: device.id,
    })
  },

  /**
   * 本地交互：已绑定设备点击后解绑，已解绑设备点击后重新绑定并进入主页。
   */
  async handleDeviceAction(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const currentDevice = this.data.devices.find((device) => device.id === id)

    if (!currentDevice) {
      return
    }

    if (!currentDevice.isBound) {
      try {
        wx.showLoading({
          title: '连接中',
          mask: true,
        })

        await connectDevice({
          deviceId: currentDevice.id,
          name: currentDevice.name,
        })

        this.saveCurrentDevice(currentDevice)
        this.saveHistoryDevices(
          this.data.devices.map((device) => {
            if (device.id !== id) {
              return device
            }

            return {
              ...device,
              isBound: true,
            }
          }),
        )

        wx.hideLoading()
        wx.navigateTo({
          url: '/pages/home/home',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '连接设备失败'
        const debugInfo = getBluetoothDebugInfo()

        wx.hideLoading()
        wx.showToast({
          title: '连接失败',
          icon: 'none',
        })

        wx.showModal({
          title: '蓝牙调试信息',
          content: [
            message,
            `设备：${currentDevice.name}`,
            `deviceId：${currentDevice.id}`,
            `services：${debugInfo.services.join('，') || '无'}`,
            `characteristics：${debugInfo.characteristics.join('，') || '无'}`,
            `最近日志：${debugInfo.logs.slice(0, 3).map((log) => `${log.time} ${log.direction} ${log.status} ${log.message || log.hex}`).join('；') || '无'}`,
          ].join('\n'),
          showCancel: false,
          confirmText: '知道了',
        })
      }

      return
    }

    this.saveHistoryDevices(
      this.data.devices.map((device) => {
        if (device.id !== id) {
          return device
        }

        return {
          ...device,
          isBound: false,
        }
      }),
    )
  },

  /**
   * 本地交互：从历史记录中删除设备并同步缓存。
   */
  handleDeleteDevice(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string

    this.saveHistoryDevices(this.data.devices.filter((device) => device.id !== id))
  },

  /**
   * 清空全部历史设备，确认后同步清空本地缓存。
   */
  handleClearHistory() {
    wx.showModal({
      title: '清空历史记录',
      content: '确定要清空全部历史设备吗？',
      confirmText: '清空',
      confirmColor: '#f31b33',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.saveHistoryDevices([])
      },
    })
  },
})
