import type { GatewayPort, GatewayStatus, GatewayStatusInfo, NewEvent } from '../../src/contracts/index.js'

export class FakeGateway implements GatewayPort {
  private eventListeners = new Set<(e: NewEvent) => void>()
  private statusListeners = new Set<(s: GatewayStatus, info?: GatewayStatusInfo) => void>()
  private current: GatewayStatus = 'connecting'

  async start(): Promise<void> {
    this.setStatus('ready')
  }

  async stop(): Promise<void> {
    this.setStatus('disconnected')
  }

  onEvent(cb: (e: NewEvent) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  onStatus(cb: (s: GatewayStatus, info?: GatewayStatusInfo) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  status(): GatewayStatus {
    return this.current
  }

  disconnect(): void {
    this.setStatus('disconnected')
  }

  reconnect(): void {
    this.setStatus('ready')
  }

  emit(e: NewEvent): void {
    for (const cb of [...this.eventListeners]) cb(e)
  }

  setStatus(s: GatewayStatus, info?: GatewayStatusInfo): void {
    if (s === this.current) return
    this.current = s
    for (const cb of [...this.statusListeners]) cb(s, info)
  }
}
