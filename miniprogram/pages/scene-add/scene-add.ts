import { sendCommand } from '../../services/device-control'
import { buildSceneAdd } from '../../services/protocol'

type SoundItem = {
  id: number
  volume: number
  status: number
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
const PENDING_SELECTED_SCENE_ID_KEY = 'pendingSelectedSceneId'

const createDefaultSoundItems = (): SoundItem[] => [
  { id: 1, volume: 100, status: 1, enabled: true, removable: false, coverIndex: 0 },
  { id: 2, volume: 0, status: 1, enabled: true, removable: false, coverIndex: 0 },
  { id: 3, volume: 50, status: 1, enabled: true, removable: false, coverIndex: 0 },
  { id: 4, volume: 100, status: 0, enabled: false, removable: true, coverIndex: 0 },
  { id: 5, volume: 100, status: 1, enabled: true, removable: true, coverIndex: 0 },
  { id: 6, volume: 100, status: 1, enabled: true, removable: true, coverIndex: 0 },
]

const createDefaultScenes = (): SceneItem[] => [
  { id: 1, name: '场景1' },
  { id: 2, name: '场景2' },
  { id: 3, name: '场景3' },
  { id: 4, name: '场景4' },
  { id: 5, name: '场景5' },
  { id: 6, name: '场景6' },
]

const normalizeSceneName = (scene: SceneItem, index: number) => {
  if (typeof scene.name === 'string' && /^场景\d+$/.test(scene.name)) {
    return scene.name
  }

  return `场景${scene.id || index + 1}`
}

const readLocalScenes = () => {
  const storedScenes = wx.getStorageSync(SCENE_STORAGE_KEY) as SceneItem[] | ''

  if (Array.isArray(storedScenes) && storedScenes.length) {
    const normalizedScenes = storedScenes.map((scene, index) => ({
      ...scene,
      name: normalizeSceneName(scene, index),
    }))

    if (normalizedScenes.some((scene, index) => scene.name !== storedScenes[index].name)) {
      wx.setStorageSync(SCENE_STORAGE_KEY, normalizedScenes)
    }

    return normalizedScenes
  }

  const defaultScenes = createDefaultScenes()
  wx.setStorageSync(SCENE_STORAGE_KEY, defaultScenes)

  return defaultScenes
}

const getChannelConfigKey = (sceneNumber: number) => `channelConfig:${sceneNumber}`

const normalizeSoundItem = (item: SoundItem): SoundItem => {
  const status = typeof item.status === 'number' ? item.status : (item.enabled ? 1 : 0)

  return {
    ...item,
    status,
    enabled: status === 1,
  }
}

const normalizeSoundItems = (items: SoundItem[]): SoundItem[] => {
  const normalized = items.map(normalizeSoundItem)

  createDefaultSoundItems().forEach((defaultItem) => {
    if (!normalized.some((item) => item.id === defaultItem.id)) {
      normalized.push(defaultItem)
    }
  })

  return normalized
    .slice()
    .sort((left, right) => left.id - right.id)
    .slice(0, 6)
}

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

    this.setData({
      totalVolume: config.totalVolume,
      soundItems: normalizeSoundItems(config.channels),
    })
  },
  handleBack() {
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack()
      return
    }

    wx.reLaunch({
      url: '/pages/home/home',
    })
  },


  handleTotalVolumeChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({
      totalVolume: e.detail.value,
    })
  },

  handleSoundVolumeChange(e: WechatMiniprogram.CustomEvent<{ id: number, value: number }>) {
    const { id, value } = e.detail
    const soundItems = this.data.soundItems.map((item) => {
      if (item.id !== id) {
        return item
      }

      return {
        ...item,
        volume: value,
      }
    })

    this.setData({
      soundItems,
    })
  },

  handleSoundSwitchChange(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const { id } = e.detail
    const soundItems = this.data.soundItems.map((item) => {
      if (item.id !== id) {
        return item
      }

      const nextEnabled = !item.enabled

      return {
        ...item,
        enabled: nextEnabled,
        status: nextEnabled ? 1 : 0,
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

  handleDeleteSound(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const { id } = e.detail

    this.setData({
      soundItems: this.data.soundItems.filter((item) => item.id !== id),
    })
  },

  async handleSave() {
    if (this.data.hasSaved) {
      return
    }

    const scenes = readLocalScenes()
    const storedConfig = wx.getStorageSync(getChannelConfigKey(this.data.sceneNumber)) as ChannelConfig | ''
    const sceneConfig: ChannelConfig = storedConfig && typeof storedConfig === 'object'
      ? {
          ...storedConfig,
          totalVolume: this.data.totalVolume,
          selectedCoverIndex: this.data.soundItems[0] ? this.data.soundItems[0].coverIndex : storedConfig.selectedCoverIndex,
          channels: this.data.soundItems.map(normalizeSoundItem),
        }
      : {
          totalVolume: this.data.totalVolume,
          selectedCoverIndex: this.data.soundItems[0] ? this.data.soundItems[0].coverIndex : 0,
          channels: this.data.soundItems.map(normalizeSoundItem),
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
    wx.setStorageSync(PENDING_SELECTED_SCENE_ID_KEY, this.data.sceneNumber)
    this.setData({
      hasSaved: true,
    })

    const sent = await this.sendSceneAdd(sceneConfig)

    wx.showToast({
      title: sent ? '场景已保存' : '已本地保存',
      icon: sent ? 'success' : 'none',
    })

    setTimeout(() => {
      this.handleBack()
    }, 600)
  },

  async sendSceneAdd(sceneConfig: ChannelConfig) {
    const channels = sceneConfig.channels.map((channel) => ({
      channel: channel.id,
      volume: Math.max(channel.volume, 1),
      song: channel.coverIndex,
      enabled: channel.enabled,
      status: channel.status,
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
