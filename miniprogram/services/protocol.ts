export const FRAME_HEADER = [0x55, 0xaa] as const
export const PROTOCOL_VERSION = 0x00

export const Command = {
  AppControl: 0x06,
  DeviceReport: 0x07,
} as const

export const DataType = {
  Raw: 0x00,
  Bool: 0x01,
  Value: 0x02,
  String: 0x03,
  Enum: 0x04,
  Bitmap: 0x05,
} as const

export const DpId = {
  LightSwitch: 0x01,
  Mode: 0x02,
  MusicSwitch: 0x03,
  MusicControl: 0x04,
  ClassicBluetoothState: 0x05,
  Countdown: 0x06,
  CountdownReport: 0x07,
  ChildLock: 0x08,
  CustomScene: 0x09,
  SceneDataReport: 0x0a,
  Channel1: 0x65,
  Channel2: 0x66,
  Channel3: 0x67,
  Channel4: 0x68,
  Channel5: 0x69,
  Channel6: 0x6a,
  AllChannels: 0x6b,
  DataOperation: 0x6c,
} as const

export type MusicControlAction = 'prev' | 'next'

export type ChannelConfig = {
  channel: number
  volume: number
  song: number
  enabled: boolean
  status?: number
}

export type DataOperationAction = 'add' | 'update' | 'delete' | 'query' | 'refresh'

const assertByte = (value: number, name: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${name} must be an integer from 0 to 255`)
  }
}

const assertRange = (value: number, min: number, max: number, name: string) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`)
  }
}

const numberToUint16 = (value: number) => {
  assertRange(value, 0, 0xffff, 'uint16 value')

  return [(value >> 8) & 0xff, value & 0xff]
}

const numberToUint32 = (value: number) => {
  assertRange(value, 0, 0xffffffff, 'uint32 value')

  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

const normalizeBytes = (bytes: number[]) => {
  bytes.forEach((byte, index) => assertByte(byte, `byte at index ${index}`))

  return bytes
}

export const calcChecksum = (bytes: number[]) => {
  return normalizeBytes(bytes).reduce((sum, byte) => sum + byte, 0) & 0xff
}

export const bytesToHex = (bytes: number[]) => {
  return normalizeBytes(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const hexToBytes = (hex: string) => {
  const normalizedHex = hex.replace(/\s+/g, '').toLowerCase()

  if (!normalizedHex || normalizedHex.length % 2 !== 0 || /[^0-9a-f]/.test(normalizedHex)) {
    throw new Error('hex must contain an even number of hexadecimal characters')
  }

  const bytes: number[] = []

  for (let index = 0; index < normalizedHex.length; index += 2) {
    bytes.push(parseInt(normalizedHex.slice(index, index + 2), 16))
  }

  return bytes
}

export const hexToArrayBuffer = (hex: string) => {
  return new Uint8Array(hexToBytes(hex)).buffer
}

export const arrayBufferToHex = (buffer: ArrayBuffer) => {
  return bytesToHex(Array.from(new Uint8Array(buffer)))
}

export const buildFrameBytes = (
  command: number,
  dpId: number,
  dataType: number,
  valueBytes: number[],
) => {
  assertByte(command, 'command')
  assertByte(dpId, 'dpId')
  assertByte(dataType, 'dataType')

  const normalizedValueBytes = normalizeBytes(valueBytes)
  const valueLengthBytes = numberToUint16(normalizedValueBytes.length)
  const dataBytes = [dpId, dataType, ...valueLengthBytes, ...normalizedValueBytes]
  const frameWithoutChecksum = [
    ...FRAME_HEADER,
    PROTOCOL_VERSION,
    command,
    ...numberToUint16(dataBytes.length),
    ...dataBytes,
  ]

  return [...frameWithoutChecksum, calcChecksum(frameWithoutChecksum)]
}

export const buildFrame = (command: number, dpId: number, dataType: number, valueBytes: number[]) => {
  return bytesToHex(buildFrameBytes(command, dpId, dataType, valueBytes))
}

export const buildBoolDp = (dpId: number, enabled: boolean) => {
  return buildFrame(Command.AppControl, dpId, DataType.Bool, [enabled ? 0x01 : 0x00])
}

export const buildEnumDp = (dpId: number, value: number) => {
  assertByte(value, 'enum value')

  return buildFrame(Command.AppControl, dpId, DataType.Enum, [value])
}

export const buildValueDp = (dpId: number, value: number) => {
  return buildFrame(Command.AppControl, dpId, DataType.Value, numberToUint32(value))
}

export const buildRawDp = (dpId: number, valueBytes: number[]) => {
  return buildFrame(Command.AppControl, dpId, DataType.Raw, valueBytes)
}

export const buildLightSwitch = (on: boolean) => {
  return buildBoolDp(DpId.LightSwitch, on)
}

export const buildMode = (mode: 'music' | 'bt') => {
  return buildBoolDp(DpId.Mode, mode === 'bt')
}

export const buildMusicSwitch = (on: boolean) => {
  return buildBoolDp(DpId.MusicSwitch, on)
}

export const buildMusicControl = (action: MusicControlAction) => {
  return buildEnumDp(DpId.MusicControl, action === 'prev' ? 0x00 : 0x01)
}

export const buildChildLock = (enabled: boolean) => {
  return buildBoolDp(DpId.ChildLock, enabled)
}

export const buildCountdown = (minutes: number) => {
  assertRange(minutes, 0, 0x5a0, 'countdown minutes')

  return buildValueDp(DpId.Countdown, minutes)
}

export const getChannelDpId = (channel: number) => {
  assertRange(channel, 1, 6, 'channel')

  return DpId.Channel1 + channel - 1
}

export const buildChannelValueBytes = (config: ChannelConfig) => {
  assertRange(config.volume, 1, 100, 'channel volume')
  assertRange(config.song, 0, 33, 'channel song')
  const status = typeof config.status === 'number' ? config.status : (config.enabled ? 0x01 : 0x00)
  assertRange(status, 0, 2, 'channel status')

  // v1.3 明细字段：音量、歌曲、通道状态；0 关闭，1 开启，2 暂停。
  return [config.volume, config.song, status]
}

export const buildChannelControl = (channel: number, volume: number, song: number, enabled: boolean) => {
  return buildRawDp(getChannelDpId(channel), buildChannelValueBytes({ channel, volume, song, enabled }))
}

export const buildAllChannelsControl = (channels: ChannelConfig[]) => {
  if (channels.length !== 6) {
    throw new Error('all channels control requires exactly 6 channels')
  }

  const valueBytes = channels
    .slice()
    .sort((left, right) => left.channel - right.channel)
    .flatMap((config, index) => {
      if (config.channel !== index + 1) {
        throw new Error('all channels control requires channels 1 to 6')
      }

      return buildChannelValueBytes(config)
    })

  return buildRawDp(DpId.AllChannels, valueBytes)
}

export const buildSceneConfigValueBytes = (channels: ChannelConfig[]) => {
  assertRange(channels.length, 1, 6, 'scene channel count')

  return [
    channels.length,
    ...channels
      .slice()
      .sort((left, right) => left.channel - right.channel)
      .flatMap((config) => buildChannelValueBytes(config)),
  ]
}

export const buildCustomScene = (sceneIndex: number) => {
  assertRange(sceneIndex, 0, 7, 'sceneIndex')

  return buildEnumDp(DpId.CustomScene, sceneIndex)
}

export const buildDataOperation = (
  action: DataOperationAction,
  sceneIndex: number,
  sceneBytes: number[] = [],
) => {
  assertRange(sceneIndex, 0, 7, 'sceneIndex')

  const actionMap: Record<DataOperationAction, number> = {
    add: 0x00,
    update: 0x01,
    delete: 0x02,
    query: 0x03,
    refresh: 0x04,
  }

  return buildRawDp(DpId.DataOperation, [0x00, actionMap[action], sceneIndex, ...normalizeBytes(sceneBytes)])
}

export const buildSceneDataRefresh = () => {
  return buildDataOperation('refresh', 0)
}

export const buildSceneAdd = (sceneIndex: number, channels: ChannelConfig[]) => {
  return buildDataOperation('add', sceneIndex, buildSceneConfigValueBytes(channels))
}

export const buildSceneUpdate = (sceneIndex: number, channels: ChannelConfig[]) => {
  return buildDataOperation('update', sceneIndex, buildSceneConfigValueBytes(channels))
}

export const buildSceneDelete = (sceneIndex: number) => {
  return buildDataOperation('delete', sceneIndex)
}
