type EditorChannel = {
  id: number
  volume: number
  enabled?: boolean
  status?: number
  removable: boolean
  coverIndex: number
}

Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    totalVolume: {
      type: Number,
      value: 100,
    },
    channels: {
      type: Array,
      value: [] as EditorChannel[],
    },
    variant: {
      type: String,
      value: 'page',
    },
    showActions: {
      type: Boolean,
      value: true,
    },
    showHandle: {
      type: Boolean,
      value: true,
    },
  },

  methods: {
    handleClose() {
      this.triggerEvent('close')
    },

    handleTotalVolumeChange(e: WechatMiniprogram.SliderChange) {
      this.triggerEvent('totalvolumechange', {
        value: e.detail.value,
      })
    },

    handleChannelVolumeChange(e: WechatMiniprogram.SliderChange) {
      this.triggerEvent('channelvolumechange', {
        id: Number(e.currentTarget.dataset.id),
        value: e.detail.value,
      })
    },

    handleMusicTap(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('musicselect', {
        id: Number(e.currentTarget.dataset.id),
      })
    },

    handleStatusTap(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('statuschange', {
        id: Number(e.currentTarget.dataset.id),
      })
    },

    handleDeleteTap(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('channeldelete', {
        id: Number(e.currentTarget.dataset.id),
      })
    },

    handleSave() {
      this.triggerEvent('save')
    },

    handleReset() {
      this.triggerEvent('reset')
    },
  },
})
