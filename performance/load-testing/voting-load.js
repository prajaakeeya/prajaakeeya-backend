import http from 'k6/http';
import { check, sleep } from 'k6';

// -------------------------------------------------------------------------------------------------
// VOTING WORKFLOW LOAD TEST
// Simulates extreme spikes during election day vote casting.
// Tests the ability of the database to handle concurrent row locking and transaction load.
// -------------------------------------------------------------------------------------------------

export const options = {
  scenarios: {
    // Stage 1: 10k Users Scenario
    steady_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },  // Ramp to 50 VUs
        { duration: '1m', target: 50 },   // Sustain
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    // Stage 2: 100k Users Scenario (Burst)
    spike_load: {
      executor: 'ramping-vus',
      startTime: '2m',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 }, // Fast spike
        { duration: '1m', target: 500 },  // Sustain peak
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    // Stage 3: 1M Users Scenario (Election Day Crash Test)
    // Simulates thousands of users mashing the vote button exactly at deadline
    election_day_tsunami: {
      executor: 'shared-iterations',
      startTime: '4m',
      vus: 2000,           // 2,000 Concurrent virtual users
      iterations: 10000,   // 10,000 total votes submitted
      maxDuration: '1m',   // Must complete quickly
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'], // Transactions take longer, 95% under 1s
    http_req_failed: ['rate<0.05'],    // Allow 5% failure under extreme load (rate-limiting / lock timeouts)
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api';

// Assumptions:
// 1. JWT Tokens are predefined and passed via environment variable (or mocked auth).
// 2. Voting windows are pre-created and active.
// 3. Database is pre-seeded with dummy aspirants and users.

export default function () {
  // Simulate unique user token per VU to avoid same-user vote duplication rejections.
  // In a real test, load this from a CSV data file.
  const userToken = `dummy_token_vu_${__VU}`;
  
  const payload = JSON.stringify({
    aspirantId: Math.floor(Math.random() * 100) + 1, // Random aspirant 1-100
    votingWindowId: 1 // Active election
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    // Prevent k6 from throwing errors on 400/409/429
    // We want to track them as expected behaviors under load.
    throw: false 
  };

  const res = http.post(`${BASE_URL}/votes/cast`, payload, params);

  // Check success or expected business-logic rejections
  check(res, {
    'vote successful (201)': (r) => r.status === 201,
    'already voted (409)': (r) => r.status === 409,
    'rate limited (429)': (r) => r.status === 429,
    'server error (50x)': (r) => r.status >= 500,
  });

  // If rate limited or server error, simulate retry with exponential backoff
  if (res.status === 429 || res.status >= 500) {
     sleep(Math.random() * 2 + 1); // Backoff 1-3 seconds
     const retryRes = http.post(`${BASE_URL}/votes/cast`, payload, params);
     check(retryRes, {
       'retry successful': (r) => r.status === 201
     });
  }

  // Very short think time to simulate aggressive voting
  sleep(Math.random() * 0.5); 
}
