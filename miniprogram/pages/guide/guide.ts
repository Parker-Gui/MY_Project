import {
  BluetoothDeviceItem,
  connectDevice,
  getBluetoothDebugInfo,
  startDiscovery,
  stopDiscovery,
} from '../../services/bluetooth'

type GuideDevice = {
  id: string
  name: string
  tip: string
  status: string
  isConnected: boolean
  isConnecting: boolean
  deviceId?: string
}

type HistoryDevice = {
  id: string
  name: string
  isBound: boolean
}

const HISTORY_STORAGE_KEY = 'historyDevices'
const CURRENT_DEVICE_STORAGE_KEY = 'currentDevice'
const RESET_GUIDE_STORAGE_KEY = 'shouldResetGuide'

const createDefaultMockDevices = (): GuideDevice[] => [
  {
    id: 'ym-device',
    name: 'Ym设备',
    tip: '点击右边连接设备',
    status: '未连接',
    isConnected: false,
    isConnecting: false,
  },
  {
    id: 'demo-device',
    name: '3254545设备',
    tip: '点击右边连接设备',
    status: '未连接',
    isConnected: false,
    isConnecting: false,
  },
]

Page({
  data: {
    isScanning: false,
    // 页面初始占位数据；开始扫描后会替换为真实 BLE 扫描结果。
    mockDevices: createDefaultMockDevices(),
  },

  onShow() {
    if (!wx.getStorageSync(RESET_GUIDE_STORAGE_KEY)) {
      return
    }

    wx.removeStorageSync(RESET_GUIDE_STORAGE_KEY)
    this.resetGuideState()
  },

  /**
   * 从主页返回后恢复引导页初始状态，历史记录缓存不受影响。
   */
  resetGuideState() {
    this.setData({
      isScanning: false,
      mockDevices: createDefaultMockDevices(),
    })
  },

  /**
   * 记录连接成功的设备到本地历史。
   */
  saveHistoryDevice(device: GuideDevice) {
    const history = (wx.getStorageSync(HISTORY_STORAGE_KEY) || []) as HistoryDevice[]
    const nextHistory = [
      {
        id: device.id,
        name: device.name,
        isBound: true,
      },
      ...history.filter((item) => item.id !== device.id),
    ]

    wx.setStorageSync(HISTORY_STORAGE_KEY, nextHistory)
  },

  /**
   * 保存当前进入主页的设备，主页用它展示设备名称。
   */
  saveCurrentDevice(device: GuideDevice) {
    wx.setStorageSync(CURRENT_DEVICE_STORAGE_KEY, {
      id: device.id,
      name: device.name,
      deviceId: device.deviceId || device.id,
    })
  },

  /**
   * 开启 BLE 扫描，扫描结果会实时追加到设备列表。
   */
  async handleStartScan() {
    this.setData({
      isScanning: true,
      mockDevices: [],
    })

    try {
      await startDiscovery((device) => {
        this.appendScannedDevice(device)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '蓝牙扫描失败'

      wx.showToast({
        title: message,
        icon: 'none',
      })

      this.setData({
        isScanning: false,
      })
    }
  },

  /**
   * 停止扫描时回到空数据页。
   */
  async handleStopScan() {
    await stopDiscovery()

    this.setData({
      isScanning: false,
    })
  },

  handleOpenHistory() {
    wx.navigateTo({
      url: '/pages/history/history',
    })
  },

  /**
   * 扫描到设备后追加到当前列表，同一 deviceId 只保留一条。
   */
  appendScannedDevice(device: BluetoothDeviceItem) {
    const exists = this.data.mockDevices.some((item) => item.id === device.deviceId)

    if (exists) {
      return
    }

    this.setData({
      mockDevices: [
        ...this.data.mockDevices,
        {
          id: device.deviceId,
          deviceId: device.deviceId,
          name: device.name,
          tip: '点击右边连接设备',
          status: '未连接',
          isConnected: false,
          isConnecting: false,
        },
      ],
    })
  },

  /**
   * 点击设备后建立 BLE 连接，查找服务和特征值，开启 notify 后进入主页。
   */
  async handleConnectDevice(e: WechatMiniprogram.TouchEvent) {
    const deviceId = e.currentTarget.dataset.id as string
    const currentDevice = this.data.mockDevices.find((device) => device.id === deviceId)

    if (!currentDevice || currentDevice.isConnecting || currentDevice.isConnected) {
      return
    }

    this.setData({
      mockDevices: this.data.mockDevices.map((device) => {
        const isTarget = device.id === deviceId

        return {
          ...device,
          tip: isTarget ? '正在连接设备...' : device.tip,
          status: isTarget ? '连接中' : device.status,
          isConnecting: isTarget,
        }
      }),
    })

    try {
      await connectDevice({
        deviceId: currentDevice.deviceId || currentDevice.id,
        name: currentDevice.name,
      })

      const connectedDevice = {
        ...currentDevice,
        tip: '设备已连接',
        status: '已连接',
        isConnected: true,
        isConnecting: false,
      }

      this.saveHistoryDevice(connectedDevice)
      this.saveCurrentDevice(connectedDevice)

      wx.navigateTo({
        url: '/pages/home/home',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接设备失败'
      const debugInfo = getBluetoothDebugInfo()

      wx.showToast({
        title: '连接失败',
        icon: 'none',
      })

      wx.showModal({
        title: '蓝牙调试信息',
        content: [
          message,
          `设备：${currentDevice.name}`,
          `deviceId：${currentDevice.deviceId || currentDevice.id}`,
          `services：${debugInfo.services.join('，') || '无'}`,
          `characteristics：${debugInfo.characteristics.join('，') || '无'}`,
          `最近日志：${debugInfo.logs.slice(0, 3).map((log) => `${log.time} ${log.direction} ${log.status} ${log.message || log.hex}`).join('；') || '无'}`,
        ].join('\n'),
        showCancel: false,
        confirmText: '知道了',
      })

      this.setData({
        mockDevices: this.data.mockDevices.map((device) => {
          const isTarget = device.id === deviceId

          return {
            ...device,
            tip: isTarget ? '点击右边连接设备' : device.tip,
            status: isTarget ? '未连接' : device.status,
            isConnecting: false,
            isConnected: false,
          }
        }),
      })
    }
  },

  async onUnload() {
    await stopDiscovery()
  },
})
