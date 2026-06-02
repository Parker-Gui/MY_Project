import { sendCommand } from '../../services/device-control'
import { buildSceneAdd } from '../../services/protocol'

type SoundItem = {
  id: number
  volume: number
  enabled: boolean
  removable: boolean
  coverIndex: number
}

type SceneItem = {
  id: number
  name: string
  config?: ChannelConfig
}

type ChannelConfig = {
  totalVolume: number
  selectedCoverIndex: number
  channels: SoundItem[]
}

const SCENE_STORAGE_KEY = 'localSceneList'

const createDefaultSoundItems = (): SoundItem[] => [
  { id: 1, volume: 100, enabled: true, removable: false, coverIndex: 0 },
]

const createDefaultScenes = (): SceneItem[] => [
  { id: 1, name: '场景1' },
  { id: 2, name: '场景2' },
  { id: 3, name: '场景3' },
  { id: 4, name: '场景4' },
  { id: 5, name: '场景5' },
  { id: 6, name: '场景6' },
]

const readLocalScenes = () => {
  const storedScenes = wx.getStorageSync(SCENE_STORAGE_KEY) as SceneItem[] | ''

  if (Array.isArray(storedScenes) && storedScenes.length) {
    return storedScenes
  }

  const defaultScenes = createDefaultScenes()
  wx.setStorageSync(SCENE_STORAGE_KEY, defaultScenes)

  return defaultScenes
}

const getChannelConfigKey = (sceneNumber: number) => `channelConfig:${sceneNumber}`

Page({
  data: {
    sceneNumber: 7,
    totalVolume: 100,
    soundItems: createDefaultSoundItems(),
    hasSaved: false,
  },

  onLoad() {
    const scenes = readLocalScenes()
    const nextId = scenes.reduce((maxId, scene) => Math.max(maxId, scene.id), 0) + 1

    this.setData({
      sceneNumber: nextId,
    })
  },

  onShow() {
    const config = wx.getStorageSync(getChannelConfigKey(this.data.sceneNumber)) as ChannelConfig | ''

    if (!config || typeof config !== 'object') {
      return
    }

    const firstChannel = config.channels[0] || createDefaultSoundItems()[0]

    this.setData({
      totalVolume: config.totalVolume,
      soundItems: [
        {
          ...firstChannel,
          coverIndex: config.selectedCoverIndex,
        },
      ],
    })
  },

  /**
   * 调整总音量，保存时统一同步到设备。
   */
  handleTotalVolumeChange(e: WechatMiniprogram.SliderChange) {
    this.setData({
      totalVolume: e.detail.value,
    })
  },

  /**
   * 调整某个声音条目的音量，保存时统一同步到设备。
   */
  handleSoundVolumeChange(e: WechatMiniprogram.SliderChange) {
    const id = Number(e.currentTarget.dataset.id)
    const soundItems = this.data.soundItems.map((item) => {
      if (item.id !== id) {
        return item
      }

      return {
        ...item,
        volume: e.detail.value,
      }
    })

    this.setData({
      soundItems,
    })
  },

  /**
   * 切换声音条目开关，保存时统一同步到设备。
   */
  handleSoundSwitchChange(e: WechatMiniprogram.SwitchChange) {
    const id = Number(e.currentTarget.dataset.id)
    const soundItems = this.data.soundItems.map((item) => {
      if (item.id !== id) {
        return item
      }

      return {
        ...item,
        enabled: e.detail.value,
      }
    })

    this.setData({
      soundItems,
    })
  },

  handleReset() {
    wx.removeStorageSync(getChannelConfigKey(this.data.sceneNumber))

    this.setData({
      totalVolume: 100,
      soundItems: createDefaultSoundItems(),
      hasSaved: false,
    })
  },

  handleOpenChannelSetting() {
    wx.navigateTo({
      url: `/pages/channel-setting/channel-setting?scene=${this.data.sceneNumber}`,
    })
  },

  async handleSave() {
    if (this.data.hasSaved) {
      return
    }

    const scenes = readLocalScenes()
    const storedConfig = wx.getStorageSync(getChannelConfigKey(this.data.sceneNumber)) as ChannelConfig | ''
    const firstSoundItem = this.data.soundItems[0]
    const sceneConfig: ChannelConfig = storedConfig && typeof storedConfig === 'object'
      ? {
          ...storedConfig,
          totalVolume: this.data.totalVolume,
          selectedCoverIndex: firstSoundItem ? firstSoundItem.coverIndex : storedConfig.selectedCoverIndex,
          channels: storedConfig.channels.map((channel, index) => {
            if (index !== 0 || !firstSoundItem) {
              return channel
            }

            return {
              ...channel,
              volume: firstSoundItem.volume,
              enabled: firstSoundItem.enabled,
              coverIndex: firstSoundItem.coverIndex,
            }
          }),
        }
      : {
          totalVolume: this.data.totalVolume,
          selectedCoverIndex: firstSoundItem ? firstSoundItem.coverIndex : 0,
          channels: this.data.soundItems,
        }

    const nextScene: SceneItem = {
      id: this.data.sceneNumber,
      name: `场景${this.data.sceneNumber}`,
      config: sceneConfig,
    }
    const nextScenes = scenes.some((scene) => scene.id === nextScene.id)
      ? scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene))
      : [...scenes, nextScene]

    wx.setStorageSync(SCENE_STORAGE_KEY, nextScenes)
    wx.setStorageSync(getChannelConfigKey(this.data.sceneNumber), sceneConfig)
    this.setData({
      hasSaved: true,
    })

    const sent = await this.sendSceneAdd(sceneConfig)

    wx.showToast({
      title: sent ? '场景已保存' : '已本地保存',
      icon: sent ? 'success' : 'none',
    })

    setTimeout(() => {
      wx.navigateBack()
    }, 600)
  },

  async sendSceneAdd(sceneConfig: ChannelConfig) {
    const channels = sceneConfig.channels.map((channel) => ({
      channel: channel.id,
      volume: Math.max(channel.volume, 1),
      song: channel.coverIndex,
      enabled: channel.enabled,
    }))

    try {
      return sendCommand(buildSceneAdd(this.data.sceneNumber - 1, channels))
    } catch (error) {
      const message = error instanceof Error ? error.message : '新增场景指令生成失败'

      wx.showToast({
        title: message,
        icon: 'none',
      })

      return false
    }
  },
})
