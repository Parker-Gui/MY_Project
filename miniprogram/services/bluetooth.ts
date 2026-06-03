import { arrayBufferToHex, hexToArrayBuffer } from './protocol'

export type BluetoothDeviceItem = {
  deviceId: string
  name: string
  localName?: string
  RSSI?: number
}

export type BluetoothConnectionInfo = {
  deviceId: string
  name: string
  serviceId: string
  writeCharacteristicId: string
  notifyCharacteristicId: string
}

export type ReceiveCallback = (hex: string, buffer: ArrayBuffer) => void
export type ConnectionStateCallback = (state: {
  deviceId: string
  connected: boolean
  reconnecting?: boolean
  reconnectFailed?: boolean
}) => void
export type BluetoothDebugLog = {
  time: string
  direction: 'tx' | 'rx' | 'state'
  hex: string
  status: 'ok' | 'fail'
  message?: string
}

type BluetoothAdapterState = {
  available: boolean
  discovering: boolean
}

const SERVICE_UUID = 'FFE5'
const WRITE_CHARACTERISTIC_UUID = 'FFE9'
const NOTIFY_CHARACTERISTIC_UUID = 'FFE8'
const BLE_CONNECTION_STORAGE_KEY = 'bleConnection'
const BLUETOOTH_DEBUG_LOG_STORAGE_KEY = 'bluetoothDebugLogs'
const MAX_DEBUG_LOG_COUNT = 30
const AUTO_RECONNECT_DURATION = 60000
const AUTO_RECONNECT_INTERVAL = 5000

let connectionInfo: BluetoothConnectionInfo | undefined
let receiveCallback: ReceiveCallback | undefined
let connectionStateCallback: ConnectionStateCallback | undefined
let connectionStateListenerReady = false
let lastServiceUuids: string[] = []
let lastCharacteristicUuids: string[] = []
let writeQueue = Promise.resolve()
let reconnectTimer: number | undefined
let reconnectDeadline = 0
let reconnectingDevice: BluetoothDeviceItem | undefined
let manualDisconnecting = false

const uuidIncludes = (uuid: string, shortUuid: string) => {
  return uuid.toUpperCase().includes(shortUuid)
}

const getDeviceDisplayName = (device: BluetoothDeviceItem) => {
  return device.name || device.localName || '未知设备'
}

const delay = (duration: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, duration)
  })
}

const bluetoothErrorMessages: Record<number, string> = {
  10000: '蓝牙适配器未初始化，请重新进入页面后再试',
  10001: '手机蓝牙不可用，请打开系统蓝牙后重试',
  10002: '未找到指定蓝牙设备，请确认设备已开机并靠近手机',
  10003: '蓝牙连接失败，请确认连接的是播放器设备',
  10004: '未找到目标蓝牙服务，请确认设备是否为播放器',
  10005: '未找到目标蓝牙特征值，请确认设备固件协议是否匹配',
  10006: '蓝牙连接已断开，请重新连接设备',
  10007: '当前特征值不支持该操作，请检查 FFE8/FFE9 是否匹配',
  10008: '系统蓝牙异常，请关闭蓝牙后重新打开再试',
  10009: '当前系统版本不支持低功耗蓝牙',
  10011: '蓝牙操作超时，请靠近设备后重试',
  10012: '蓝牙连接超时，请确认设备未被其他手机连接',
  10013: '蓝牙写入数据格式异常，请检查协议帧',
}

const toBluetoothError = (message: string, error?: unknown) => {
  const errorInfo = error as { errCode?: number; errMsg?: string } | undefined
  const errCode = errorInfo && typeof errorInfo.errCode === 'number' ? errorInfo.errCode : undefined
  const friendlyMessage = errCode ? bluetoothErrorMessages[errCode] : ''
  const rawMessage = errorInfo && typeof errorInfo.errMsg === 'string' ? errorInfo.errMsg : ''
  const details = [
    friendlyMessage,
    errCode ? `错误码 ${errCode}` : '',
    rawMessage,
  ].filter(Boolean).join('；')

  return new Error(details ? `${message}：${details}` : message)
}

const recordBluetoothLog = (log: Omit<BluetoothDebugLog, 'time'>) => {
  const storedLogs = (wx.getStorageSync(BLUETOOTH_DEBUG_LOG_STORAGE_KEY) || []) as BluetoothDebugLog[]
  const nextLogs = [
    {
      time: new Date().toLocaleTimeString(),
      ...log,
    },
    ...storedLogs,
  ].slice(0, MAX_DEBUG_LOG_COUNT)

  wx.setStorageSync(BLUETOOTH_DEBUG_LOG_STORAGE_KEY, nextLogs)
}

const clearConnectionCache = () => {
  connectionInfo = undefined
  wx.removeStorageSync(BLE_CONNECTION_STORAGE_KEY)
}

const stopAutoReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  reconnectDeadline = 0
  reconnectingDevice = undefined
}

const bindConnectionStateListener = () => {
  if (connectionStateListenerReady) {
    return
  }

  connectionStateListenerReady = true

  wx.onBLEConnectionStateChange((res) => {
    const storedInfo = wx.getStorageSync(BLE_CONNECTION_STORAGE_KEY) as BluetoothConnectionInfo | ''
    const targetInfo = connectionInfo || storedInfo

    if (res.connected) {
      if (targetInfo && res.deviceId === targetInfo.deviceId) {
        connectionStateCallback?.({
          deviceId: res.deviceId,
          connected: true,
        })
      }

      return
    }

    if (targetInfo && res.deviceId === targetInfo.deviceId && !res.connected) {
      recordBluetoothLog({
        direction: 'state',
        hex: '',
        status: 'fail',
        message: '蓝牙连接已断开',
      })
      const reconnectDevice = {
        deviceId: targetInfo.deviceId,
        name: targetInfo.name,
      }

      clearConnectionCache()

      if (!manualDisconnecting) {
        startAutoReconnect(reconnectDevice)
      }
    }

    connectionStateCallback?.({
      deviceId: res.deviceId,
      connected: res.connected,
      reconnecting: !res.connected && !manualDisconnecting,
    })
  })
}

const openBluetoothAdapter = () => {
  return new Promise<void>((resolve, reject) => {
    wx.openBluetoothAdapter({
      success: () => resolve(),
      fail: (error) => reject(toBluetoothError('蓝牙初始化失败', error)),
    })
  })
}

const startBluetoothDevicesDiscovery = () => {
  return new Promise<void>((resolve, reject) => {
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => resolve(),
      fail: (error) => reject(toBluetoothError('开始扫描失败', error)),
    })
  })
}

const stopBluetoothDevicesDiscovery = () => {
  return new Promise<void>((resolve) => {
    wx.stopBluetoothDevicesDiscovery({
      complete: () => resolve(),
    })
  })
}

const createBLEConnection = (deviceId: string) => {
  return new Promise<void>((resolve, reject) => {
    wx.createBLEConnection({
      deviceId,
      timeout: 10000,
      success: () => resolve(),
      fail: (error) => reject(toBluetoothError('连接设备失败', error)),
    })
  })
}

const setBLEMTU = (deviceId: string, mtu = 247) => {
  return new Promise<void>((resolve) => {
    wx.setBLEMTU({
      deviceId,
      mtu,
      success: () => {
        recordBluetoothLog({
          direction: 'state',
          hex: '',
          status: 'ok',
          message: `MTU 设置成功：${mtu}`,
        })
        resolve()
      },
      fail: (error) => {
        recordBluetoothLog({
          direction: 'state',
          hex: '',
          status: 'fail',
          message: `MTU 设置失败，继续连接：${toBluetoothError('设置 MTU 失败', error).message}`,
        })
        resolve()
      },
    })
  })
}

const closeBLEConnection = (deviceId: string) => {
  return new Promise<void>((resolve) => {
    wx.closeBLEConnection({
      deviceId,
      complete: () => resolve(),
    })
  })
}

const getBLEDeviceServices = (deviceId: string) => {
  return new Promise<WechatMiniprogram.BLEService[]>((resolve, reject) => {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => resolve(res.services),
      fail: (error) => reject(toBluetoothError('获取蓝牙服务失败', error)),
    })
  })
}

const getBLEDeviceCharacteristics = (deviceId: string, serviceId: string) => {
  return new Promise<WechatMiniprogram.BLECharacteristic[]>((resolve, reject) => {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => resolve(res.characteristics),
      fail: (error) => reject(toBluetoothError('获取蓝牙特征值失败', error)),
    })
  })
}

const notifyBLECharacteristicValueChange = (info: BluetoothConnectionInfo) => {
  return new Promise<void>((resolve, reject) => {
    wx.notifyBLECharacteristicValueChange({
      deviceId: info.deviceId,
      serviceId: info.serviceId,
      characteristicId: info.notifyCharacteristicId,
      state: true,
      success: () => resolve(),
      fail: (error) => reject(toBluetoothError('开启蓝牙通知失败', error)),
    })
  })
}

const writeBLECharacteristicValue = (info: BluetoothConnectionInfo, buffer: ArrayBuffer) => {
  return new Promise<void>((resolve, reject) => {
    wx.writeBLECharacteristicValue({
      deviceId: info.deviceId,
      serviceId: info.serviceId,
      characteristicId: info.writeCharacteristicId,
      value: buffer,
      success: () => resolve(),
      fail: (error) => reject(toBluetoothError('写入蓝牙数据失败', error)),
    })
  })
}

const getBluetoothAdapterState = () => {
  return new Promise<BluetoothAdapterState>((resolve, reject) => {
    wx.getBluetoothAdapterState({
      success: (res) => resolve(res),
      fail: (error) => reject(toBluetoothError('获取蓝牙状态失败', error)),
    })
  })
}

const enqueueWrite = <T>(task: () => Promise<T>) => {
  const currentTask = writeQueue.then(task, task)

  writeQueue = currentTask.then(
    async () => {
      await delay(80)
    },
    async () => {
      await delay(80)
    },
  )

  return currentTask
}

export const initBluetooth = async () => {
  await openBluetoothAdapter()
  bindConnectionStateListener()
}

export const ensureBluetoothReady = async () => {
  await initBluetooth()

  const adapterState = await getBluetoothAdapterState()

  if (!adapterState.available) {
    throw new Error('手机蓝牙不可用，请打开系统蓝牙后重试')
  }

  return adapterState
}

export const startDiscovery = async (onDeviceFound: (device: BluetoothDeviceItem) => void) => {
  await ensureBluetoothReady()

  wx.offBluetoothDeviceFound()
  wx.onBluetoothDeviceFound((res) => {
    res.devices.forEach((device) => {
      const name = getDeviceDisplayName(device)

      if (!name || name === '未知设备') {
        return
      }

      onDeviceFound({
        deviceId: device.deviceId,
        name,
        localName: device.localName,
        RSSI: device.RSSI,
      })
    })
  })

  await startBluetoothDevicesDiscovery()
}

export const stopDiscovery = async () => {
  await stopBluetoothDevicesDiscovery()
}

export const findTargetServiceAndCharacteristics = async (deviceId: string) => {
  const services = await getBLEDeviceServices(deviceId)
  lastServiceUuids = services.map((service) => service.uuid)
  const targetService = services.find((service) => uuidIncludes(service.uuid, SERVICE_UUID))

  if (!targetService) {
    throw new Error(`未找到 FFE5 蓝牙服务。当前服务：${lastServiceUuids.join('、') || '无'}`)
  }

  const characteristics = await getBLEDeviceCharacteristics(deviceId, targetService.uuid)
  lastCharacteristicUuids = characteristics.map((item) => item.uuid)
  const writeCharacteristic = characteristics.find((item) =>
    uuidIncludes(item.uuid, WRITE_CHARACTERISTIC_UUID),
  )
  const notifyCharacteristic = characteristics.find((item) =>
    uuidIncludes(item.uuid, NOTIFY_CHARACTERISTIC_UUID),
  )

  if (!writeCharacteristic) {
    throw new Error(`未找到 FFE9 写入特征值。当前特征值：${lastCharacteristicUuids.join('、') || '无'}`)
  }

  if (!notifyCharacteristic) {
    throw new Error(`未找到 FFE8 通知特征值。当前特征值：${lastCharacteristicUuids.join('、') || '无'}`)
  }

  return {
    serviceId: targetService.uuid,
    writeCharacteristicId: writeCharacteristic.uuid,
    notifyCharacteristicId: notifyCharacteristic.uuid,
  }
}

export const enableNotify = async (info?: BluetoothConnectionInfo) => {
  const targetInfo = info || connectionInfo

  if (!targetInfo) {
    throw new Error('蓝牙设备未连接')
  }

  await notifyBLECharacteristicValueChange(targetInfo)
}

export const onReceive = (callback: ReceiveCallback) => {
  receiveCallback = callback

  wx.offBLECharacteristicValueChange()
  wx.onBLECharacteristicValueChange((res) => {
    const hex = arrayBufferToHex(res.value)

    recordBluetoothLog({
      direction: 'rx',
      hex,
      status: 'ok',
    })
    receiveCallback?.(hex, res.value)
  })
}

export const onConnectionStateChange = (callback: ConnectionStateCallback) => {
  connectionStateCallback = callback
  bindConnectionStateListener()
}

export const connectDevice = async (device: BluetoothDeviceItem) => {
  await ensureBluetoothReady()
  await stopDiscovery()
  await createBLEConnection(device.deviceId)

  try {
    await setBLEMTU(device.deviceId)
    // 部分设备连接成功后需要短暂等待，服务列表才会完整返回。
    await delay(600)
    const characteristicInfo = await findTargetServiceAndCharacteristics(device.deviceId)
    const nextConnectionInfo: BluetoothConnectionInfo = {
      deviceId: device.deviceId,
      name: device.name,
      ...characteristicInfo,
    }

    await enableNotify(nextConnectionInfo)

    connectionInfo = nextConnectionInfo
    wx.setStorageSync(BLE_CONNECTION_STORAGE_KEY, nextConnectionInfo)
    stopAutoReconnect()

    return nextConnectionInfo
  } catch (error) {
    await closeBLEConnection(device.deviceId)
    throw error
  }
}

function startAutoReconnect(device: BluetoothDeviceItem) {
  if (reconnectingDevice?.deviceId === device.deviceId && reconnectTimer) {
    return
  }

  reconnectingDevice = device
  reconnectDeadline = Date.now() + AUTO_RECONNECT_DURATION

  recordBluetoothLog({
    direction: 'state',
    hex: '',
    status: 'fail',
    message: '设备已断开，开始自动重连',
  })

  const tryReconnect = async () => {
    if (!reconnectingDevice) {
      return
    }

    if (Date.now() > reconnectDeadline) {
      const failedDevice = reconnectingDevice

      recordBluetoothLog({
        direction: 'state',
        hex: '',
        status: 'fail',
        message: '自动重连超时，已停止',
      })
      stopAutoReconnect()
      connectionStateCallback?.({
        deviceId: failedDevice.deviceId,
        connected: false,
        reconnectFailed: true,
      })
      return
    }

    try {
      recordBluetoothLog({
        direction: 'state',
        hex: '',
        status: 'ok',
        message: '正在尝试自动重连',
      })

      await connectDevice(reconnectingDevice)

      recordBluetoothLog({
        direction: 'state',
        hex: '',
        status: 'ok',
        message: '自动重连成功',
      })

      connectionStateCallback?.({
        deviceId: device.deviceId,
        connected: true,
      })
    } catch (error) {
      recordBluetoothLog({
        direction: 'state',
        hex: '',
        status: 'fail',
        message: error instanceof Error ? `自动重连失败：${error.message}` : '自动重连失败',
      })
      reconnectTimer = setTimeout(tryReconnect, AUTO_RECONNECT_INTERVAL)
    }
  }

  reconnectTimer = setTimeout(tryReconnect, AUTO_RECONNECT_INTERVAL)
}

export const getConnectionInfo = () => {
  if (connectionInfo) {
    return connectionInfo
  }

  const storedInfo = wx.getStorageSync(BLE_CONNECTION_STORAGE_KEY) as BluetoothConnectionInfo | ''

  if (storedInfo) {
    connectionInfo = storedInfo
  }

  return connectionInfo
}

export const writeHex = async (hex: string) => {
  return enqueueWrite(async () => {
    const targetInfo = getConnectionInfo()

    if (!targetInfo) {
      recordBluetoothLog({
        direction: 'tx',
        hex,
        status: 'fail',
        message: '蓝牙设备未连接',
      })
      throw new Error('蓝牙设备未连接')
    }

    try {
      await writeBLECharacteristicValue(targetInfo, hexToArrayBuffer(hex))
      recordBluetoothLog({
        direction: 'tx',
        hex,
        status: 'ok',
      })
    } catch (error) {
      recordBluetoothLog({
        direction: 'tx',
        hex,
        status: 'fail',
        message: error instanceof Error ? error.message : '写入蓝牙数据失败',
      })
      throw error
    }
  })
}

export const disconnect = async () => {
  manualDisconnecting = true
  stopAutoReconnect()
  const targetInfo = getConnectionInfo()

  if (targetInfo) {
    await closeBLEConnection(targetInfo.deviceId)
  }

  clearConnectionCache()
  lastServiceUuids = []
  lastCharacteristicUuids = []
  manualDisconnecting = false
}

export const getBluetoothDebugInfo = () => {
  return {
    connectionInfo,
    services: lastServiceUuids,
    characteristics: lastCharacteristicUuids,
    logs: (wx.getStorageSync(BLUETOOTH_DEBUG_LOG_STORAGE_KEY) || []) as BluetoothDebugLog[],
  }
}

export const clearBluetoothDebugLogs = () => {
  wx.removeStorageSync(BLUETOOTH_DEBUG_LOG_STORAGE_KEY)
}
