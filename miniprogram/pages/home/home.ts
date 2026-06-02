import {
  disconnect as disconnectBluetooth,
  onConnectionStateChange,
  onReceive,
} from '../../services/bluetooth'
import { sendCommand } from '../../services/device-control'
import { parseFrameData } from '../../services/parser'
import {
  buildChildLock,
  buildCountdown,
  buildCustomScene,
  buildLightSwitch,
  buildMusicControl,
  buildMusicSwitch,
  buildSceneDataRefresh,
  buildSceneUpdate,
} from '../../services/protocol'

let childLockTipTimer: number | undefined
let countdownTimer: number | undefined
let initialSyncTimer: number | undefined
const SCENE_STORAGE_KEY = 'localSceneList'
const RESET_GUIDE_STORAGE_KEY = 'shouldResetGuide'
const CURRENT_DEVICE_STORAGE_KEY = 'currentDevice'
const HISTORY_STORAGE_KEY = 'historyDevices'
const DEVICE_REPORT_COMMAND = 0x07

type LocalSceneItem = {
  id: number
  name: string
}

type CurrentDevice = {
  id: string
  name: string
}

type HistoryDevice = {
  id: string
  name: string
  isBound: boolean
}

type DeviceReportChannel = {
  channel: number
  volume: number
  song: number
  status: number
  enabled: boolean
}

type DeviceReportScene = {
  sceneIndex: number
  channels: DeviceReportChannel[]
}

type ChannelItem = {
  id: number
  volume: number
  status: number
  enabled: boolean
  removable: boolean
  coverIndex: number
}

type ChannelConfig = {
  totalVolume: number
  selectedCoverIndex: number
  channels: ChannelItem[]
}

type SceneChannelView = ChannelItem & {
  statusText: string
}

const getChannelConfigKey = (sceneNumber: number) => `channelConfig:${sceneNumber}`

const getSongIdFromName = (songName: string) => {
  const matched = songName.match(/^(\d+)/)
  const songId = matched ? Number(matched[1]) : 1

  return Math.max(0, Math.min(songId, 33))
}

const getChannelStatusText = (status: number) => {
  const statusTextMap: Record<number, string> = {
    0: '关闭',
    1: '开启',
    2: '暂停',
  }

  return statusTextMap[status] || '关闭'
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const restSeconds = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}:${pad(restSeconds)}`
}

const createDefaultScenes = (): LocalSceneItem[] => [
  { id: 1, name: '场景1' },
  { id: 2, name: '场景2' },
  { id: 3, name: '场景3' },
  { id: 4, name: '场景4' },
  { id: 5, name: '场景5' },
  { id: 6, name: '场景6' },
]

const readLocalScenes = () => {
  const storedScenes = wx.getStorageSync(SCENE_STORAGE_KEY) as LocalSceneItem[] | ''

  if (Array.isArray(storedScenes) && storedScenes.length) {
    return storedScenes
  }

  const defaultScenes = createDefaultScenes()
  wx.setStorageSync(SCENE_STORAGE_KEY, defaultScenes)

  return defaultScenes
}

const createChannelConfigFromReport = (channels: DeviceReportChannel[]): ChannelConfig => {
  const normalizedChannels = channels.map((channel) => ({
    id: channel.channel,
    volume: channel.volume,
    status: channel.status,
    enabled: channel.enabled,
    removable: channel.channel > 3,
    coverIndex: channel.song,
  }))
  const enabledChannels = normalizedChannels.filter((channel) => channel.enabled)
  const volumeSource = enabledChannels.length ? enabledChannels : normalizedChannels
  const totalVolume = volumeSource.length
    ? Math.round(volumeSource.reduce((sum, channel) => sum + channel.volume, 0) / volumeSource.length)
    : 0

  return {
    totalVolume,
    selectedCoverIndex: normalizedChannels[0]?.coverIndex || 0,
    channels: normalizedChannels,
  }
}

const mergeChannelConfig = (config: ChannelConfig | '', reportChannel: DeviceReportChannel): ChannelConfig => {
  const baseConfig: ChannelConfig = config && typeof config === 'object'
    ? config
    : createChannelConfigFromReport([])
  const nextChannel: ChannelItem = {
    id: reportChannel.channel,
    volume: reportChannel.volume,
    status: reportChannel.status,
    enabled: reportChannel.enabled,
    removable: reportChannel.channel > 3,
    coverIndex: reportChannel.song,
  }
  const hasChannel = baseConfig.channels.some((channel) => channel.id === reportChannel.channel)
  const channels = hasChannel
    ? baseConfig.channels.map((channel) => (channel.id === reportChannel.channel ? nextChannel : channel))
    : [...baseConfig.channels, nextChannel].sort((a, b) => a.id - b.id)

  return {
    ...baseConfig,
    totalVolume: nextChannel.volume,
    selectedCoverIndex: nextChannel.coverIndex,
    channels,
  }
}

Page({
  data: {
    currentDeviceId: '',
    currentDeviceName: '已连接设备',
    scenes: ['场景1', '场景2', '场景3', '场景4', '场景5', '场景6'],
    selectedSceneIndex: 0,
    volume: 100,
    lastVolume: 100,
    isMuted: false,
    timerText: '00:00:00',
    remainingSeconds: 0,
    showTimeSheet: false,
    selectedTimeIndex: -1,
    timerOptions: [
      { label: '5分钟', seconds: 5 * 60 },
      { label: '15分钟', seconds: 15 * 60 },
      { label: '30分钟', seconds: 30 * 60 },
      { label: '45分钟', seconds: 45 * 60 },
      { label: '一个小时', seconds: 60 * 60 },
      { label: '2个小时', seconds: 2 * 60 * 60 },
    ],
    showSongSheet: false,
    showPlaylistSheet: false,
    showSceneChannelSheet: false,
    songCategories: ['全部', '海声音', '鸟声'],
    selectedSongCategoryIndex: 0,
    activeShortcut: '',
    isBluetoothOff: false,
    isLightOn: false,
    connectionStatusText: '已连接',
    isInitializingDevice: false,
    songs: ['01 鸟声', '02 鸟声', '03 鸟声', '04 鸟声', '05 鸟声', '06 鸟声', '07 鸟声'],
    playlistSongs: [
      { name: '01 鸟鸣', desc: '出自于大自然世界' },
      { name: '02麻雀', desc: '出自于大自然世界' },
      { name: '03鸟鸣', desc: '出自于大自然世界' },
    ],
    currentSong: '',
    isPlaying: false,
    isScenePlayback: true,
    sceneTotalVolume: 100,
    sceneChannels: [] as SceneChannelView[],
    isChildLocked: true,
    childLockMessage: '',
  },

  onShow() {
    const localScenes = readLocalScenes()
    const selectedSceneIndex = Math.min(this.data.selectedSceneIndex, localScenes.length - 1)
    const currentDevice = wx.getStorageSync(CURRENT_DEVICE_STORAGE_KEY) as CurrentDevice | ''

    if (!currentDevice) {
      wx.showToast({
        title: '请先连接设备',
        icon: 'none',
      })

      wx.reLaunch({
        url: '/pages/guide/guide',
      })
      return
    }

    this.setData({
      currentDeviceId: currentDevice ? currentDevice.id : '',
      currentDeviceName: currentDevice ? currentDevice.name : '已连接设备',
      scenes: localScenes.map((scene) => scene.name),
      selectedSceneIndex,
      connectionStatusText: '已连接',
      isBluetoothOff: false,
    })

    this.bindDeviceReports()
    this.bindConnectionState()
    this.requestDeviceInitialSync()
  },

  /**
   * 监听 FFE8 通知。设备上报只同步页面状态，不反向发送控制指令。
   */
  bindDeviceReports() {
    onReceive((hex) => {
      this.handleDeviceReport(hex)
    })
  },

  /**
   * 监听真实 BLE 断开事件，统一更新首页和历史记录状态。
   */
  bindConnectionState() {
    onConnectionStateChange((state) => {
      if (state.deviceId !== this.data.currentDeviceId) {
        return
      }

      if (state.connected) {
        this.markDeviceReconnected()
        return
      }

      if (state.reconnectFailed) {
        this.markDeviceDisconnected('自动重连失败，请手动连接')
        return
      }

      if (state.reconnecting) {
        this.markDeviceReconnecting()
      }
    })
  },

  markDeviceReconnecting() {
    this.stopCountdown()
    this.clearInitialSyncTimer()
    this.setData({
      isBluetoothOff: true,
      connectionStatusText: '重连中',
      isInitializingDevice: false,
      showSongSheet: false,
      showPlaylistSheet: false,
      showTimeSheet: false,
    })

    wx.showToast({
      title: '设备已断开，正在重连',
      icon: 'none',
    })
  },

  markDeviceReconnected() {
    this.setData({
      isBluetoothOff: false,
      connectionStatusText: '已连接',
      activeShortcut: '',
    })

    wx.showToast({
      title: '设备已重连',
      icon: 'none',
    })

    this.requestDeviceInitialSync()
  },

  markDeviceDisconnected(message: string) {
    const currentDeviceId = this.data.currentDeviceId

    if (currentDeviceId) {
      const history = (wx.getStorageSync(HISTORY_STORAGE_KEY) || []) as HistoryDevice[]
      const nextHistory = history.map((device) => {
        if (device.id !== currentDeviceId) {
          return device
        }

        return {
          ...device,
          isBound: false,
        }
      })

      wx.setStorageSync(HISTORY_STORAGE_KEY, nextHistory)
    }

    wx.removeStorageSync(CURRENT_DEVICE_STORAGE_KEY)
    this.stopCountdown()
    this.clearInitialSyncTimer()
    this.setData({
      isBluetoothOff: true,
      connectionStatusText: '已断开',
      isInitializingDevice: false,
      activeShortcut: 'bluetooth',
      showSongSheet: false,
      showPlaylistSheet: false,
      showTimeSheet: false,
    })

    wx.showToast({
      title: message,
      icon: 'none',
    })
  },

  /**
   * 解析设备上报帧，并把 DP 数据落到现有首页状态。
   */
  handleDeviceReport(hex: string) {
    try {
      const parsed = parseFrameData(hex)

      if (!parsed.data || parsed.frame.command !== DEVICE_REPORT_COMMAND) {
        return
      }

      this.markInitialSyncReceived()

      switch (parsed.data.kind) {
        case 'countdownReport':
          this.syncCountdownReport(parsed.data.seconds)
          break
        case 'lightSwitch':
          this.syncLightSwitchReport(parsed.data.on)
          break
        case 'childLock':
          this.syncChildLockReport(parsed.data.enabled)
          break
        case 'customScene':
          this.syncCurrentSceneReport(parsed.data.sceneIndex)
          break
        case 'sceneDataReport':
          this.syncScenesFromDevice(parsed.data.scenes)
          break
        case 'channel':
          this.syncSingleChannelFromDevice({
            channel: parsed.data.channel,
            volume: parsed.data.data.volume,
            song: parsed.data.data.song,
            status: parsed.data.data.status,
            enabled: parsed.data.data.enabled,
          })
          break
        case 'allChannels':
          this.syncAllChannelsFromDevice(parsed.data.channels)
          break
        case 'musicSwitch':
          this.syncMusicSwitchReport(parsed.data.on)
          break
        case 'musicControl':
          this.syncMusicControlReport(parsed.data.action)
          break
        default:
          break
      }
    } catch {
      // 真实设备调试期可能返回不完整帧，解析失败时保持页面当前状态。
    }
  },

  syncCountdownReport(seconds: number) {
    this.setData({
      remainingSeconds: seconds,
      timerText: formatDuration(seconds),
    })

    if (seconds > 0) {
      this.startCountdown()
      return
    }

    this.stopCountdown()
  },

  syncChildLockReport(enabled: boolean) {
    this.setData({
      isChildLocked: enabled,
      childLockMessage: enabled ? '已打开童锁，请解除' : '解除童锁成功',
    })

    if (childLockTipTimer) {
      clearTimeout(childLockTipTimer)
    }

    childLockTipTimer = setTimeout(() => {
      this.setData({
        childLockMessage: '',
      })
    }, 1600)
  },

  syncLightSwitchReport(on: boolean) {
    this.setData({
      isLightOn: on,
      activeShortcut: on ? 'light' : '',
    })
  },

  syncMusicSwitchReport(on: boolean) {
    if (on) {
      const restoredVolume = this.data.lastVolume || 100

      this.setData({
        volume: this.data.volume > 0 ? this.data.volume : restoredVolume,
        isMuted: false,
        isPlaying: true,
      })
      return
    }

    this.setData({
      lastVolume: this.data.volume > 0 ? this.data.volume : this.data.lastVolume,
      volume: 0,
      isMuted: true,
      isPlaying: false,
    })
  },

  syncMusicControlReport(action: 'prev' | 'next') {
    this.setData({
      currentSong: this.getAdjacentSongName(action),
      isPlaying: true,
      showSceneChannelSheet: false,
    })
  },

  syncCurrentSceneReport(sceneIndex: number) {
    const nextIndex = Math.max(0, Math.min(sceneIndex, this.data.scenes.length - 1))
    const currentData = {
      selectedSceneIndex: nextIndex,
      isScenePlayback: true,
    }

    if (!this.data.showSceneChannelSheet) {
      this.setData(currentData)
      return
    }

    const sceneNumber = nextIndex + 1
    const storedConfig = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''
    const channels = storedConfig && typeof storedConfig === 'object' && Array.isArray(storedConfig.channels)
      ? this.toSceneChannelViews(storedConfig.channels)
      : this.toSceneChannelViews([])

    this.setData({
      ...currentData,
      sceneChannels: channels,
      sceneTotalVolume: this.getSceneChannelsAverageVolume(channels),
    })
  },

  syncScenesFromDevice(scenes: DeviceReportScene[]) {
    if (!scenes.length) {
      return
    }

    const nextScenes = scenes.map((_scene, index) => ({
      id: index + 1,
      name: `场景${index + 1}`,
    }))

    wx.setStorageSync(SCENE_STORAGE_KEY, nextScenes)

    scenes.forEach((scene, index) => {
      wx.setStorageSync(getChannelConfigKey(index + 1), createChannelConfigFromReport(scene.channels))
    })

    const selectedSceneIndex = Math.min(this.data.selectedSceneIndex, nextScenes.length - 1)

    if (this.data.showSceneChannelSheet) {
      const currentScene = scenes[selectedSceneIndex]
      const channels = this.toSceneChannelViews(currentScene ? createChannelConfigFromReport(currentScene.channels).channels : [])

      this.setData({
        scenes: nextScenes.map((scene) => scene.name),
        selectedSceneIndex,
        sceneChannels: channels,
        sceneTotalVolume: this.getSceneChannelsAverageVolume(channels),
      })
      return
    }

    this.setData({
      scenes: nextScenes.map((scene) => scene.name),
      selectedSceneIndex,
    })
  },

  syncSingleChannelFromDevice(channel: DeviceReportChannel) {
    const sceneNumber = this.data.selectedSceneIndex + 1
    const config = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''

    const nextConfig = mergeChannelConfig(config, channel)

    wx.setStorageSync(getChannelConfigKey(sceneNumber), nextConfig)

    if (this.data.showSceneChannelSheet) {
      this.setData({
        sceneChannels: this.toSceneChannelViews(nextConfig.channels),
      })
    }
  },

  syncAllChannelsFromDevice(channels: DeviceReportChannel[]) {
    const sceneNumber = this.data.selectedSceneIndex + 1
    const nextConfig = createChannelConfigFromReport(channels)
    const sceneChannels = this.toSceneChannelViews(nextConfig.channels)

    wx.setStorageSync(getChannelConfigKey(sceneNumber), nextConfig)
    this.setData({
      isScenePlayback: sceneChannels.filter((channel) => channel.status === 1).length > 2,
      sceneTotalVolume: nextConfig.totalVolume,
      sceneChannels: this.data.showSceneChannelSheet ? sceneChannels : this.data.sceneChannels,
    })
  },

  normalizeSceneChannels(channels: ChannelItem[]) {
    const normalized = channels.map((channel) => ({
      ...channel,
      status: typeof channel.status === 'number' ? channel.status : (channel.enabled ? 1 : 0),
      enabled: typeof channel.status === 'number' ? channel.status === 1 : channel.enabled,
    }))

    for (let id = 1; id <= 6; id += 1) {
      if (!normalized.some((channel) => channel.id === id)) {
        normalized.push({
          id,
          volume: 100,
          status: id <= 3 ? 1 : 0,
          enabled: id <= 3,
          removable: id > 3,
          coverIndex: 0,
        })
      }
    }

    return normalized
      .slice()
      .sort((left, right) => left.id - right.id)
      .slice(0, 6)
  },

  toSceneChannelViews(channels: ChannelItem[]) {
    return this.normalizeSceneChannels(channels).map((channel) => ({
      ...channel,
      statusText: getChannelStatusText(channel.status),
    }))
  },

  getSceneChannelsAverageVolume(channels: SceneChannelView[]) {
    if (!channels.length) {
      return 100
    }

    return Math.round(channels.reduce((sum, channel) => sum + channel.volume, 0) / channels.length)
  },

  getCurrentSceneChannels() {
    const sceneNumber = this.data.selectedSceneIndex + 1
    const storedConfig = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''

    if (storedConfig && typeof storedConfig === 'object' && Array.isArray(storedConfig.channels)) {
      return this.toSceneChannelViews(storedConfig.channels)
    }

    return this.toSceneChannelViews([])
  },

  buildCurrentSceneChannels(songId: number) {
    const sceneNumber = this.data.selectedSceneIndex + 1
    const storedConfig = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''
    const baseChannels = storedConfig && typeof storedConfig === 'object' && storedConfig.channels.length
      ? storedConfig.channels
      : [
          {
            id: 1,
            volume: this.data.volume || this.data.lastVolume || 100,
            status: 1,
            enabled: true,
            removable: false,
            coverIndex: songId,
          },
        ]

    return baseChannels.map((channel, index) => ({
      channel: channel.id,
      volume: Math.max(channel.volume || this.data.volume || 1, 1),
      song: index === 0 ? songId : channel.coverIndex,
      enabled: index === 0 ? true : channel.enabled,
      status: index === 0 ? 1 : (typeof channel.status === 'number' ? channel.status : (channel.enabled ? 1 : 0)),
    }))
  },

  saveSelectedSongToCurrentScene(songId: number) {
    const sceneNumber = this.data.selectedSceneIndex + 1
    const storedConfig = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''
    const baseConfig: ChannelConfig = storedConfig && typeof storedConfig === 'object'
      ? storedConfig
      : createChannelConfigFromReport([
          {
            channel: 1,
            volume: this.data.volume || this.data.lastVolume || 100,
            song: songId,
            status: 1,
            enabled: true,
          },
        ])
    const channels = baseConfig.channels.length
      ? baseConfig.channels.map((channel, index) => {
          if (index !== 0) {
            return channel
          }

          return {
            ...channel,
            volume: Math.max(channel.volume || this.data.volume || 1, 1),
            status: 1,
            enabled: true,
            coverIndex: songId,
          }
        })
      : [{
          id: 1,
          volume: this.data.volume || this.data.lastVolume || 100,
          status: 1,
          enabled: true,
          removable: false,
          coverIndex: songId,
        }]

    wx.setStorageSync(getChannelConfigKey(sceneNumber), {
      ...baseConfig,
      selectedCoverIndex: songId,
      channels,
    })
  },

  /**
   * 进入首页后触发设备重新上报场景数据，用于把本地页面初始化到真实设备状态。
   */
  async requestDeviceInitialSync() {
    if (this.data.isInitializingDevice || this.data.isBluetoothOff) {
      return
    }

    this.setData({
      isInitializingDevice: true,
      connectionStatusText: '同步中',
    })

    const sent = await sendCommand(buildSceneDataRefresh())

    if (!sent) {
      this.clearInitialSyncTimer()
      this.setData({
        isInitializingDevice: false,
        connectionStatusText: '同步失败',
      })
      return
    }

    this.clearInitialSyncTimer()
    initialSyncTimer = setTimeout(() => {
      this.setData({
        isInitializingDevice: false,
        connectionStatusText: '已连接',
      })
      initialSyncTimer = undefined
    }, 4000)
  },

  markInitialSyncReceived() {
    if (!this.data.isInitializingDevice) {
      return
    }

    this.clearInitialSyncTimer()
    this.setData({
      isInitializingDevice: false,
      connectionStatusText: '已同步',
    })
  },

  clearInitialSyncTimer() {
    if (initialSyncTimer) {
      clearTimeout(initialSyncTimer)
      initialSyncTimer = undefined
    }
  },

  /**
   * 蓝牙关闭态下禁用控制类交互，后续接入真实蓝牙状态后替换。
   */
  guardBluetoothAvailable() {
    if (!this.data.isBluetoothOff) {
      return true
    }

    wx.showToast({
      title: '请先开启蓝牙',
      icon: 'none',
    })

    return false
  },

  /**
   * 返回引导页。若页面栈不存在上一页，则直接重启到引导页。
   */
  handleBackToGuide() {
    wx.setStorageSync(RESET_GUIDE_STORAGE_KEY, true)

    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }

    wx.reLaunch({
      url: '/pages/guide/guide',
    })
  },

  /**
   * 本地断开当前设备：清除当前设备，更新历史记录状态，并返回引导页。
   */
  handleDisconnectDevice() {
    wx.showModal({
      title: '断开设备',
      content: '确定断开当前设备吗？',
      confirmText: '断开',
      confirmColor: '#f31b33',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        const currentDevice = wx.getStorageSync(CURRENT_DEVICE_STORAGE_KEY) as CurrentDevice | ''

        if (currentDevice) {
          const history = (wx.getStorageSync(HISTORY_STORAGE_KEY) || []) as HistoryDevice[]
          const nextHistory = history.map((device) => {
            if (device.id !== currentDevice.id) {
              return device
            }

            return {
              ...device,
              isBound: false,
            }
          })

          wx.setStorageSync(HISTORY_STORAGE_KEY, nextHistory)
        }

        try {
          await disconnectBluetooth()
        } catch (error) {
          const message = error instanceof Error ? error.message : '断开蓝牙失败'

          wx.showToast({
            title: message,
            icon: 'none',
          })
        } finally {
          wx.removeStorageSync(CURRENT_DEVICE_STORAGE_KEY)
          wx.setStorageSync(RESET_GUIDE_STORAGE_KEY, true)

          wx.reLaunch({
            url: '/pages/guide/guide',
          })
        }
      },
    })
  },

  /**
   * 快捷按钮单选高亮，不接入设备控制。
   */
  async handleShortcutTap(e: WechatMiniprogram.TouchEvent) {
    const action = e.currentTarget.dataset.action as string

    if (action === 'bluetooth') {
      const isBluetoothOff = !this.data.isBluetoothOff

      this.setData({
        activeShortcut: isBluetoothOff ? 'bluetooth' : '',
        isBluetoothOff,
        showSongSheet: false,
        showPlaylistSheet: false,
        showTimeSheet: false,
      })

      wx.showToast({
        title: isBluetoothOff ? '蓝牙已关闭' : '蓝牙已开启',
        icon: 'none',
      })

      return
    }

    if (action === 'playlist') {
      wx.navigateTo({
        url: '/pages/history/history',
      })
      return
    }

    if (action === 'light') {
      const nextLightOn = !this.data.isLightOn
      const sent = await sendCommand(buildLightSwitch(nextLightOn))

      if (!sent) {
        return
      }

      this.setData({
        isLightOn: nextLightOn,
        activeShortcut: nextLightOn ? 'light' : '',
        isBluetoothOff: false,
      })

      return
    }

    this.setData({
      activeShortcut: action,
      isBluetoothOff: false,
    })
  },

  /**
   * 音量滑动只更新页面状态，不发送蓝牙指令。
   */
  handleVolumeChange(e: WechatMiniprogram.SliderChange) {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const volume = e.detail.value

    this.setData({
      volume,
      isMuted: volume === 0,
      lastVolume: volume > 0 ? volume : this.data.lastVolume,
    })
  },

  /**
   * 点击声音图标切换静音，恢复时回到上一次非 0 音量。
   */
  async handleSoundToggle() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    if (this.data.isMuted) {
      const restoredVolume = this.data.lastVolume || 100
      const sent = await sendCommand(buildMusicSwitch(true))

      if (!sent) {
        return
      }

      this.setData({
        volume: restoredVolume,
        isMuted: false,
      })
      return
    }

    const sent = await sendCommand(buildMusicSwitch(false))

    if (!sent) {
      return
    }

    this.setData({
      lastVolume: this.data.volume > 0 ? this.data.volume : this.data.lastVolume,
      volume: 0,
      isMuted: true,
    })
  },

  /**
   * 静态占位：切换选中的情景模式，不发送协议指令。
   */
  async handleSceneTap(e: WechatMiniprogram.TouchEvent) {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const index = Number(e.currentTarget.dataset.index)
    const previousIndex = this.data.selectedSceneIndex
    const sent = await sendCommand(buildCustomScene(index))

    if (!sent) {
      this.setData({
        selectedSceneIndex: previousIndex,
      })
      return
    }

    this.setData({
      selectedSceneIndex: index,
    })
  },

  handleAddScene() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    wx.navigateTo({
      url: '/pages/scene-add/scene-add',
    })
  },

  handleOpenSceneManage() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    wx.navigateTo({
      url: '/pages/scene-manage/scene-manage',
    })
  },

  handleOpenBluetoothDebug() {
    wx.navigateTo({
      url: '/pages/bluetooth-debug/bluetooth-debug',
    })
  },

  /**
   * 打开时间选择弹层。
   */
  handleOpenTimeSheet() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    this.setData({
      showTimeSheet: true,
      showSongSheet: false,
      showPlaylistSheet: false,
    })
  },

  handleCloseTimeSheet() {
    this.setData({
      showTimeSheet: false,
    })
  },

  /**
   * 选择预设时长后启动本地倒计时，不发送蓝牙指令。
   */
  async handleTimeOptionTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const option = this.data.timerOptions[index]
    const sent = await sendCommand(buildCountdown(Math.floor(option.seconds / 60)))

    if (!sent) {
      return
    }

    this.setData({
      selectedTimeIndex: index,
      remainingSeconds: option.seconds,
      timerText: formatDuration(option.seconds),
      showTimeSheet: false,
    })

    this.startCountdown()
  },

  startCountdown() {
    this.stopCountdown()

    countdownTimer = setInterval(() => {
      const nextSeconds = Math.max(this.data.remainingSeconds - 1, 0)

      this.setData({
        remainingSeconds: nextSeconds,
        timerText: formatDuration(nextSeconds),
      })

      if (nextSeconds === 0) {
        this.stopCountdown()
      }
    }, 1000)
  },

  stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  },

  /**
   * 静态占位：只切换童锁提示，不发送蓝牙童锁指令。
   */
  async handleChildLockTap() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const nextLocked = !this.data.isChildLocked
    const sent = await sendCommand(buildChildLock(nextLocked))

    if (!sent) {
      return
    }

    this.setData({
      isChildLocked: nextLocked,
      childLockMessage: nextLocked ? '已打开童锁，请解除' : '解除童锁成功',
    })

    if (childLockTipTimer) {
      clearTimeout(childLockTipTimer)
    }

    childLockTipTimer = setTimeout(() => {
      this.setData({
        childLockMessage: '',
      })
    }, 1600)
  },

  handleOpenSongSheet() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    this.setData({
      showSongSheet: true,
      showPlaylistSheet: false,
    })
  },

  handleOpenPlaylistSheet() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    this.setData({
      showPlaylistSheet: true,
      showSongSheet: false,
    })
  },

  handleRecordTap() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const channels = this.getCurrentSceneChannels()
    const isScenePlayback = this.data.isScenePlayback || channels.filter((channel) => channel.status === 1).length > 2

    if (!isScenePlayback) {
      this.handleOpenPlaylistSheet()
      return
    }

    this.setData({
      showSceneChannelSheet: true,
      showSongSheet: false,
      showPlaylistSheet: false,
      sceneChannels: channels,
      sceneTotalVolume: this.getSceneChannelsAverageVolume(channels),
    })
  },

  handleCloseSongSheet() {
    this.setData({
      showSongSheet: false,
      showPlaylistSheet: false,
    })
  },

  handleCloseActiveSheet() {
    if (this.data.showSongSheet || this.data.showPlaylistSheet) {
      this.handleCloseSongSheet()
      return
    }

    if (this.data.showSceneChannelSheet) {
      this.handleCloseSceneChannelSheet()
    }
  },

  handleCloseSceneChannelSheet() {
    this.setData({
      showSceneChannelSheet: false,
    })
  },

  handleSceneTotalVolumeChange(e: WechatMiniprogram.SliderChange) {
    const totalVolume = e.detail.value

    this.setData({
      sceneTotalVolume: totalVolume,
      sceneChannels: this.data.sceneChannels.map((channel) => ({
        ...channel,
        volume: totalVolume,
      })),
    })
  },

  handleSceneChannelVolumeChange(e: WechatMiniprogram.SliderChange) {
    const id = Number(e.currentTarget.dataset.id)

    this.setData({
      sceneChannels: this.data.sceneChannels.map((channel) => {
        if (channel.id !== id) {
          return channel
        }

        return {
          ...channel,
          volume: e.detail.value,
        }
      }),
    })
  },

  handleSongCategoryTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({
      selectedSongCategoryIndex: Number(e.currentTarget.dataset.index),
    })
  },

  getAllSongNames() {
    return [
      ...this.data.songs,
      ...this.data.playlistSongs.map((song) => song.name),
    ]
  },

  getAdjacentSongName(action: 'prev' | 'next') {
    const songs = this.getAllSongNames()
    const currentIndex = songs.findIndex((song) => song === this.data.currentSong)

    if (!songs.length) {
      return ''
    }

    if (currentIndex < 0) {
      return action === 'next' ? songs[0] : songs[songs.length - 1]
    }

    const nextIndex = action === 'next'
      ? (currentIndex + 1) % songs.length
      : (currentIndex - 1 + songs.length) % songs.length

    return songs[nextIndex]
  },

  async selectSong(songName: string) {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const songId = getSongIdFromName(songName)
    const channels = this.buildCurrentSceneChannels(songId)
    const sceneIndex = this.data.selectedSceneIndex
    const updateSent = await sendCommand(buildSceneUpdate(sceneIndex, channels))

    if (!updateSent) {
      return
    }

    const playSent = await sendCommand(buildMusicSwitch(true))

    if (!playSent) {
      return
    }

    this.saveSelectedSongToCurrentScene(songId)
    this.setData({
      currentSong: songName,
      isPlaying: true,
      isMuted: false,
      volume: this.data.volume > 0 ? this.data.volume : this.data.lastVolume || 100,
      showSongSheet: false,
      showPlaylistSheet: false,
    })

    wx.showToast({
      title: `已选择 ${songName}`,
      icon: 'none',
    })
  },

  async handleMusicControlTap(e: WechatMiniprogram.TouchEvent) {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const action = e.currentTarget.dataset.action as 'prev' | 'next'
    const nextSongName = this.getAdjacentSongName(action)
    const sent = await sendCommand(buildMusicControl(action))

    if (!sent) {
      return
    }

    this.setData({
      currentSong: nextSongName,
      isPlaying: true,
      isMuted: false,
    })
  },

  async handlePlayToggle() {
    if (!this.guardBluetoothAvailable()) {
      return
    }

    const nextPlaying = !this.data.isPlaying
    const sent = await sendCommand(buildMusicSwitch(nextPlaying))

    if (!sent) {
      return
    }

    this.setData({
      isPlaying: nextPlaying,
      isMuted: !nextPlaying,
      volume: nextPlaying ? this.data.lastVolume || 100 : 0,
      lastVolume: this.data.volume > 0 ? this.data.volume : this.data.lastVolume,
    })
  },

  async handleSongTap(e: WechatMiniprogram.TouchEvent) {
    const songName = e.currentTarget.dataset.name as string

    await this.selectSong(songName)
  },

  async handlePlaylistSongTap(e: WechatMiniprogram.TouchEvent) {
    const songName = e.currentTarget.dataset.name as string

    await this.selectSong(songName)
  },

  onUnload() {
    this.stopCountdown()
    this.clearInitialSyncTimer()

    if (childLockTipTimer) {
      clearTimeout(childLockTipTimer)
      childLockTipTimer = undefined
    }
  },
})
