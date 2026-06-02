import { sendCommand } from '../../services/device-control'
import { buildSceneDelete } from '../../services/protocol'

type SceneItem = {
  id: number
  name: string
}

const SCENE_STORAGE_KEY = 'localSceneList'

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

Page({
  data: {
    selectedSceneId: 1,
    scenes: createDefaultScenes(),
    originalScenes: createDefaultScenes(),
  },

  onShow() {
    const scenes = readLocalScenes()

    this.setData({
      scenes,
      originalScenes: scenes,
      selectedSceneId: scenes[0] ? scenes[0].id : 0,
    })
  },

  /**
   * 本地页面交互：只切换选中的场景，不发送设备指令。
   */
  handleSceneTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({
      selectedSceneId: Number(e.currentTarget.dataset.id),
    })
  },

  /**
   * 先从页面列表移除场景，点击保存后再发送删除协议并写入本地缓存。
   */
  handleDeleteScene(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const scenes = this.data.scenes.filter((scene) => scene.id !== id)
    const selectedSceneId = this.data.selectedSceneId === id && scenes.length ? scenes[0].id : this.data.selectedSceneId

    this.setData({
      scenes,
      selectedSceneId,
    })
  },

  /**
   * 保存时将被删除的场景同步到设备，成功后再返回主页。
   */
  async handleSave() {
    const deletedScenes = this.data.originalScenes.filter((scene) =>
      !this.data.scenes.some((nextScene) => nextScene.id === scene.id),
    )
    const sent = await this.sendSceneDeletes(deletedScenes)

    if (!sent) {
      return
    }

    wx.setStorageSync(SCENE_STORAGE_KEY, this.data.scenes)

    wx.showToast({
      title: '场景已保存',
      icon: 'success',
    })

    setTimeout(() => {
      wx.navigateBack()
    }, 600)
  },

  async sendSceneDeletes(deletedScenes: SceneItem[]) {
    try {
      for (const scene of deletedScenes) {
        const sent = await sendCommand(buildSceneDelete(scene.id - 1))

        if (!sent) {
          return false
        }
      }

      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除场景指令生成失败'

      wx.showToast({
        title: message,
        icon: 'none',
      })

      return false
    }
  },
})
