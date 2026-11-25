import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Emitter } from './data/DataSource'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface DebugLogEntry {
  timestamp: string
  level: LogLevel
  tag: string
  message: string
}

const MAX_MEMORY_ENTRIES = 200

class DebugLogger {
  private readonly entries: DebugLogEntry[] = []
  private readonly emitter = new Emitter<DebugLogEntry>()
  private logFilePath: string

  constructor() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const logDir = path.join(appData, 'zwift-overlay', 'logs')
    try {
      fs.mkdirSync(logDir, { recursive: true })
    } catch {
      // ignore
    }
    this.logFilePath = path.join(logDir, 'debug.log')
  }

  get filePath(): string {
    return this.logFilePath
  }

  info(tag: string, message: string): void {
    this.write('INFO', tag, message)
  }

  warn(tag: string, message: string): void {
    this.write('WARN', tag, message)
  }

  error(tag: string, message: string): void {
    this.write('ERROR', tag, message)
  }

  debug(tag: string, message: string): void {
    this.write('DEBUG', tag, message)
  }

  getRecent(): DebugLogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries.length = 0
    try {
      fs.writeFileSync(this.logFilePath, '', 'utf8')
    } catch {
      // ignore
    }
  }

  onEntry(cb: (entry: DebugLogEntry) => void): () => void {
    return this.emitter.on(cb)
  }

  private write(level: LogLevel, tag: string, message: string): void {
    const now = new Date()
    const timestamp = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    const entry: DebugLogEntry = { timestamp, level, tag, message }

    this.entries.push(entry)
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.shift()
    }

    const line = `[${now.toISOString()}] [${level}] [${tag}] ${message}\n`
    try {
      fs.appendFileSync(this.logFilePath, line, 'utf8')
    } catch {
      // ignore
    }

    this.emitter.emit(entry)
  }
}

export const debugLog = new DebugLogger()
