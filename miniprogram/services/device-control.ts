import { writeHex } from './bluetooth'

export const sendCommand = async (hex: string) => {
  try {
    await writeHex(hex)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : '蓝牙指令发送失败'

    wx.showToast({
      title: message,
      icon: 'none',
    })

    return false
  }
}
