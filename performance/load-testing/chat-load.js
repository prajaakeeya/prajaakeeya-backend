import ws from 'k6/ws';
import { check, sleep } from 'k6';

// -------------------------------------------------------------------------------------------------
// WEBSOCKET / CHAT LOAD TEST
// Simulates concurrent WebSocket connections and message broadcasting in the Chat Module.
// -------------------------------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '1m', target: 500 },  // Ramp up to 500 concurrent WebSocket connections
    { duration: '2m', target: 500 },  // Hold 500 CCU
    { duration: '30s', target: 0 },   // Disconnect
  ],
  thresholds: {
    // We expect connection errors to be near zero if Redis Adapter & limits are configured correctly
    'ws_sessions': ['count>0'], 
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
// If the app uses Socket.io, the URL often looks like this:
const SOCKET_IO_URL = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;

export default function () {
  const res = ws.connect(SOCKET_IO_URL, function (socket) {
    
    socket.on('open', function () {
      // Simulate authenticating the socket (depending on implementation)
      socket.send(JSON.stringify([
        "authenticate", 
        { token: "dummy_load_test_token" }
      ]));
      
      // Simulate joining a room (e.g., an Aspirant's discussion channel)
      const roomId = `aspirant_${Math.floor(Math.random() * 100)}`;
      socket.send(JSON.stringify([
        "joinRoom", 
        { room: roomId }
      ]));
    });

    socket.on('message', function (msg) {
      // Ensure we receive a standard Socket.io ping/pong or app message
      check(msg, { 'message received': (m) => m && m.length > 0 });
    });

    socket.on('close', function () {
      // Disconnection handler
    });

    socket.on('error', function (e) {
      console.log('An unexpected error occurred: ', e.error());
    });

    // Simulate sending chat messages periodically
    socket.setInterval(function timeout() {
      const roomId = `aspirant_${Math.floor(Math.random() * 100)}`;
      socket.send(JSON.stringify([
        "sendMessage", 
        { 
          room: roomId, 
          text: `Hello from Load Tester ${__VU}` 
        }
      ]));
    }, 15000); // Every 15 seconds per virtual user

    // Keep the connection open for the duration of the iteration (approx 1-2 minutes)
    socket.setTimeout(function () {
      socket.close();
    }, (Math.random() * 60000) + 60000); 

  });

  check(res, { 'status is 101 Switching Protocols': (r) => r && r.status === 101 });
  sleep(1);
}
