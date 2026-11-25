import dgram from 'node:dgram'

const HOST = process.env.ZWIFT_UDP_HOST || '127.0.0.1'
const PORT = Number(process.env.ZWIFT_UDP_PORT || 7878)

const socket = dgram.createSocket('udp4')
let t = 0
let dist = 0

console.log(`Sending live telemetry stream to udp://${HOST}:${PORT} (Ctrl+C to stop)...`)

setInterval(() => {
  t += 1
  const watts = Math.round(230 + Math.sin(t * 0.15) * 45 + (Math.random() - 0.5) * 20)
  const hr = Math.round(148 + Math.sin(t * 0.05) * 12)
  const cadence = Math.round(88 + Math.sin(t * 0.1) * 6)
  const speedKph = Math.round((34 + Math.sin(t * 0.12) * 5) * 10) / 10
  dist += (speedKph / 3.6) * 1

  const payload = JSON.stringify({
    timestamp: Date.now(),
    state: {
      watts,
      heartrate: hr,
      cadence,
      speedKph,
      distance: Math.round(dist)
    },
    nearby: [
      { id: 'n1', label: 'HD', size: 1, gap: -62, watts: 195, kph: 33 },
      { id: 'n2', label: 'KP', size: 1, gap: -47, watts: 215, kph: 35 },
      { id: 'n3', label: 'WH', size: 1, gap: -18, watts: 225, kph: 36 },
      { id: 'n4', label: 'MS', size: 1, gap: -3, watts: 210, kph: 35 },
      { id: 'self', label: '5', size: 5, isSelf: true, gap: 0, watts, kph: Math.round(speedKph) },
      { id: 'n5', label: 'JP', size: 1, gap: 15, watts: 205, kph: 34 },
      { id: 'n6', label: 'MS', size: 1, gap: 58, watts: 240, kph: 38 }
    ],
    groups: { aheadCount: 15, behindCount: 16 }
  })

  socket.send(Buffer.from(payload, 'utf8'), PORT, HOST)
}, 1000)
