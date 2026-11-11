// BASELINE net (lead). Offline: single player. Same surface as the real module.
export default { name: 'net', online: false, isHost: true, id: 0, room: null, peers: new Map(), status: 'offline', error: '', ping: 0,
  init() {}, reset() {}, update() {}, lateUpdate() {}, available() { return false; }, create() {}, join() {}, leave() {}, start() {}, send() {}, on() {} };
