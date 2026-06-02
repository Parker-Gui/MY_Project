import { Command, DataType, DpId, calcChecksum, hexToBytes } from './protocol'

export type ParsedFrame = {
  valid: boolean
  checksumValid: boolean
  headerValid: boolean
  version: number
  command: number
  length: number
  dpId: number
  dataType: number
  valueLength: number
  valueBytes: number[]
  checksum: number
  error?: string
}

export type ParsedChannelData = {
  volume: number
  song: number
  status: number
  enabled: boolean
}

export type ParsedSceneChannel = ParsedChannelData & {
  channel: number
}

export type ParsedScene = {
  sceneIndex: number
  channels: ParsedSceneChannel[]
}

export type ParsedDpData =
  | { kind: 'lightSwitch'; on: boolean }
  | { kind: 'mode'; mode: 'music' | 'bt' }
  | { kind: 'musicSwitch'; on: boolean }
  | { kind: 'musicControl'; action: 'prev' | 'next' }
  | { kind: 'classicBluetoothState'; state: 'relinking' | 'advertising' | 'connected' | 'unknown'; value: number }
  | { kind: 'countdown'; minutes: number }
  | { kind: 'countdownReport'; seconds: number }
  | { kind: 'childLock'; enabled: boolean }
  | { kind: 'customScene'; sceneIndex: number }
  | { kind: 'sceneDataReport'; scenes: ParsedScene[] }
  | { kind: 'channel'; channel: number; data: ParsedChannelData }
  | { kind: 'allChannels'; channels: ParsedSceneChannel[] }
  | { kind: 'dataOperation'; operationType: number; action: number; sceneIndex: number; payload: number[] }
  | { kind: 'unknown'; dpId: number; dataType: number; valueBytes: number[] }

const bytesToUint32 = (bytes: number[]) => {
  if (bytes.length !== 4) {
    throw new Error('value data must be 4 bytes')
  }

  return ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]
}

const enumByte = (valueBytes: number[], name: string) => {
  if (valueBytes.length !== 1) {
    throw new Error(`${name} must be 1 byte`)
  }

  return valueBytes[0]
}

export const verifyChecksum = (bytes: number[]) => {
  if (bytes.length < 2) {
    return false
  }

  return calcChecksum(bytes.slice(0, -1)) === bytes[bytes.length - 1]
}

export const parseFrameBytes = (bytes: number[]): ParsedFrame => {
  if (bytes.length < 11) {
    return {
      valid: false,
      checksumValid: false,
      headerValid: false,
      version: 0,
      command: 0,
      length: 0,
      dpId: 0,
      dataType: 0,
      valueLength: 0,
      valueBytes: [],
      checksum: 0,
      error: 'frame is too short',
    }
  }

  const headerValid = bytes[0] === 0x55 && bytes[1] === 0xaa
  const checksumValid = verifyChecksum(bytes)
  const length = (bytes[4] << 8) + bytes[5]
  const expectedFrameLength = 2 + 1 + 1 + 2 + length + 1

  if (bytes.length !== expectedFrameLength) {
    return {
      valid: false,
      checksumValid,
      headerValid,
      version: bytes[2],
      command: bytes[3],
      length,
      dpId: bytes[6] || 0,
      dataType: bytes[7] || 0,
      valueLength: 0,
      valueBytes: [],
      checksum: bytes[bytes.length - 1],
      error: `frame length mismatch, expected ${expectedFrameLength}, got ${bytes.length}`,
    }
  }

  const valueLength = (bytes[8] << 8) + bytes[9]
  const valueBytes = bytes.slice(10, 10 + valueLength)
  const valueLengthValid = valueBytes.length === valueLength && length === valueLength + 4

  return {
    valid: headerValid && checksumValid && valueLengthValid,
    checksumValid,
    headerValid,
    version: bytes[2],
    command: bytes[3],
    length,
    dpId: bytes[6],
    dataType: bytes[7],
    valueLength,
    valueBytes,
    checksum: bytes[bytes.length - 1],
    error: valueLengthValid ? undefined : 'dp value length mismatch',
  }
}

export const parseFrame = (hex: string) => {
  return parseFrameBytes(hexToBytes(hex))
}

export const parseCountdownReport = (valueBytes: number[]) => {
  return bytesToUint32(valueBytes)
}

export const parseChannelData = (valueBytes: number[]): ParsedChannelData => {
  if (valueBytes.length < 3) {
    throw new Error('channel data must contain volume, song, and enabled bytes')
  }

  return {
    volume: valueBytes[0],
    song: valueBytes[1],
    status: valueBytes[2],
    enabled: valueBytes[2] === 0x01,
  }
}

export const parseAllChannelsData = (valueBytes: number[]) => {
  if (valueBytes.length !== 18) {
    throw new Error('all channels data must be 18 bytes')
  }

  const channels: ParsedSceneChannel[] = []

  for (let index = 0; index < 6; index += 1) {
    channels.push({
      channel: index + 1,
      ...parseChannelData(valueBytes.slice(index * 3, index * 3 + 3)),
    })
  }

  return channels
}

export const parseSceneData = (valueBytes: number[]) => {
  if (!valueBytes.length) {
    return []
  }

  const sceneCount = valueBytes[0]
  const scenes: ParsedScene[] = []
  let cursor = 1

  for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
    const channelCount = valueBytes[cursor]

    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 6) {
      throw new Error(`invalid channel count for scene ${sceneIndex + 1}`)
    }

    cursor += 1
    const channels: ParsedSceneChannel[] = []

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      channels.push({
        channel: channelIndex + 1,
        ...parseChannelData(valueBytes.slice(cursor, cursor + 3)),
      })
      cursor += 3
    }

    scenes.push({
      sceneIndex,
      channels,
    })
  }

  if (cursor !== valueBytes.length) {
    throw new Error('scene data has trailing bytes')
  }

  return scenes
}

export const parseDpData = (dpId: number, dataType: number, valueBytes: number[]): ParsedDpData => {
  switch (dpId) {
    case DpId.LightSwitch:
      return { kind: 'lightSwitch', on: enumByte(valueBytes, 'light switch') === 0x01 }
    case DpId.Mode:
      return { kind: 'mode', mode: enumByte(valueBytes, 'mode') === 0x01 ? 'bt' : 'music' }
    case DpId.MusicSwitch:
      return { kind: 'musicSwitch', on: enumByte(valueBytes, 'music switch') === 0x01 }
    case DpId.MusicControl:
      return { kind: 'musicControl', action: enumByte(valueBytes, 'music control') === 0x01 ? 'next' : 'prev' }
    case DpId.ClassicBluetoothState: {
      const value = enumByte(valueBytes, 'classic bluetooth state')
      const stateMap: Record<number, 'relinking' | 'advertising' | 'connected' | 'unknown'> = {
        0x00: 'relinking',
        0x01: 'advertising',
        0x02: 'connected',
      }

      return { kind: 'classicBluetoothState', state: stateMap[value] || 'unknown', value }
    }
    case DpId.Countdown:
      return { kind: 'countdown', minutes: bytesToUint32(valueBytes) }
    case DpId.CountdownReport:
      return { kind: 'countdownReport', seconds: parseCountdownReport(valueBytes) }
    case DpId.ChildLock:
      return { kind: 'childLock', enabled: enumByte(valueBytes, 'child lock') === 0x01 }
    case DpId.CustomScene:
      return { kind: 'customScene', sceneIndex: enumByte(valueBytes, 'custom scene') }
    case DpId.SceneDataReport:
      return { kind: 'sceneDataReport', scenes: parseSceneData(valueBytes) }
    case DpId.Channel1:
    case DpId.Channel2:
    case DpId.Channel3:
    case DpId.Channel4:
    case DpId.Channel5:
    case DpId.Channel6:
      return {
        kind: 'channel',
        channel: dpId - DpId.Channel1 + 1,
        data: parseChannelData(valueBytes),
      }
    case DpId.AllChannels:
      return { kind: 'allChannels', channels: parseAllChannelsData(valueBytes) }
    case DpId.DataOperation:
      return {
        kind: 'dataOperation',
        operationType: valueBytes[0] || 0,
        action: valueBytes[1] || 0,
        sceneIndex: valueBytes[2] || 0,
        payload: valueBytes.slice(3),
      }
    default:
      return { kind: 'unknown', dpId, dataType, valueBytes }
  }
}

export const parseFrameData = (hex: string) => {
  const frame = parseFrame(hex)

  if (!frame.valid) {
    return {
      frame,
      data: undefined,
    }
  }

  return {
    frame,
    data: parseDpData(frame.dpId, frame.dataType, frame.valueBytes),
  }
}

export const isDeviceReportFrame = (frame: ParsedFrame) => {
  return frame.valid && frame.command === Command.DeviceReport
}

export const isRawDp = (frame: ParsedFrame) => {
  return frame.valid && frame.dataType === DataType.Raw
}
