import { sendCommand } from '../../services/device-control'
import { buildSceneUpdate } from '../../services/protocol'

type ChannelItem = {
  id: number
  volume: number
  enabled: boolean
  removable: boolean
  coverIndex: number
}

type ChannelConfig = {
  totalVolume: number
  selectedCoverIndex: number
  channels: ChannelItem[]
}

const createDefaultChannels = (): ChannelItem[] => [
  { id: 1, volume: 100, enabled: true, removable: false, coverIndex: 0 },
  { id: 2, volume: 0, enabled: true, removable: false, coverIndex: 0 },
  { id: 3, volume: 50, enabled: true, removable: false, coverIndex: 0 },
  { id: 4, volume: 100, enabled: false, removable: true, coverIndex: 0 },
  { id: 5, volume: 100, enabled: true, removable: true, coverIndex: 0 },
  { id: 6, volume: 100, enabled: true, removable: true, coverIndex: 0 },
]

const getChannelConfigKey = (sceneNumber: number) => `channelConfig:${sceneNumber}`

Page({
  data: {
    sceneNumber: 1,
    totalVolume: 100,
    selectedCoverIndex: 0,
    showImageLibrary: false,
    coverOptions: [0, 1, 2],
    channels: createDefaultChannels(),
  },

  onLoad(query: Record<string, string | undefined>) {
    const sceneNumber = Number(query.scene || 1)
    const storedConfig = wx.getStorageSync(getChannelConfigKey(sceneNumber)) as ChannelConfig | ''

    if (storedConfig && typeof storedConfig === 'object') {
      this.setData({
        sceneNumber,
        totalVolume: storedConfig.totalVolume,
        selectedCoverIndex: storedConfig.selectedCoverIndex,
        channels: storedConfig.channels,
      })

      return
    }

    this.setData({ sceneNumber })
  },

  handleBack() {
    wx.navigateBack()
  },

  handleTotalVolumeChange(e: WechatMiniprogram.SliderChange) {
    this.setData({
      totalVolume: e.detail.value,
    })
  },

  handleChannelVolumeChange(e: WechatMiniprogram.SliderChange) {
    const id = Number(e.currentTarget.dataset.id)

    this.setData({
      channels: this.data.channels.map((channel) => {
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

  handleChannelSwitchChange(e: WechatMiniprogram.SwitchChange) {
    const id = Number(e.currentTarget.dataset.id)

    this.setData({
      channels: this.data.channels.map((channel) => {
        if (channel.id !== id) {
          return channel
        }

        return {
          ...channel,
          enabled: e.detail.value,
        }
      }),
    })
  },

  handleDeleteChannel(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)

    this.setData({
      channels: this.data.channels.filter((channel) => channel.id !== id),
    })
  },

  handleOpenImageLibrary() {
    this.setData({
      showImageLibrary: true,
    })
  },

  handleCloseImageLibrary() {
    this.setData({
      showImageLibrary: false,
    })
  },

  handleCoverTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({
      selectedCoverIndex: Number(e.currentTarget.dataset.index),
      showImageLibrary: false,
    })
  },

  handleReset() {
    this.setData({
      totalVolume: 100,
      selectedCoverIndex: 0,
      channels: createDefaultChannels(),
    })
  },

  async handleSave() {
    const config: ChannelConfig = {
      totalVolume: this.data.totalVolume,
      selectedCoverIndex: this.data.selectedCoverIndex,
      channels: this.data.channels,
    }

    const sent = await this.sendChannelConfig()

    if (!sent) {
      return
    }

    wx.setStorageSync(getChannelConfigKey(this.data.sceneNumber), config)

    wx.showToast({
      title: '声道已保存',
      icon: 'success',
    })

    setTimeout(() => {
      wx.navigateBack()
    }, 600)
  },

  async sendChannelConfig() {
    const channels = this.data.channels.map((channel) => ({
      channel: channel.id,
      volume: Math.max(channel.volume, 1),
      // 当前 UI 还没有歌曲编号字段，暂用封面索引作为协议歌曲编号。
      song: channel.coverIndex,
      enabled: channel.enabled,
    }))

    try {
      return sendCommand(buildSceneUpdate(this.data.sceneNumber - 1, channels))
    } catch (error) {
      const message = error instanceof Error ? error.message : '声道指令生成失败'

      wx.showToast({
        title: message,
        icon: 'none',
      })

      return false
    }
  },
})
