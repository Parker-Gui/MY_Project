// index.ts
const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    motto: 'Hello World',
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: '',
    },
    hasUserInfo: false,
    canIUseGetUserProfile: wx.canIUse('getUserProfile'),
    canIUseNicknameComp: wx.canIUse('input.type.nickname'),
  },
  methods: {
    bindViewTap() {
      wx.navigateTo({
        url: '../logs/logs',
      })
    },

    onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
      const { avatarUrl } = e.detail
      const { nickName } = this.data.userInfo

      this.setData({
        'userInfo.avatarUrl': avatarUrl,
        hasUserInfo: Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      })
    },

    onInputChange(e: WechatMiniprogram.Input) {
      const nickName = e.detail.value
      const { avatarUrl } = this.data.userInfo

      this.setData({
        'userInfo.nickName': nickName,
        hasUserInfo: Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      })
    },

    getUserProfile() {
      wx.getUserProfile({
        desc: '展示用户信息',
        success: (res) => {
          this.setData({
            userInfo: res.userInfo,
            hasUserInfo: true,
          })
        },
      })
    },
  },
})
