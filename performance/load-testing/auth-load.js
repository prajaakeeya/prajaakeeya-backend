import http from 'k6/http';
import { check, sleep } from 'k6';

// -------------------------------------------------------------------------------------------------
// AUTHENTICATION LOAD TEST
// Simulates users logging in / refreshing tokens.
// Since actual Google OAuth requires browser interaction, this tests a mock/dev
// endpoint or simulates the internal JWT issuance behavior under load.
// -------------------------------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Authentication is heavy, ramp up slowly
    { duration: '1m', target: 100 },  // Moderate authentication load
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    // Auth endpoints involve hashing/DB writes, so we allow a higher latency threshold
    http_req_duration: ['p(95)<800'], 
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api';
// Optional mock endpoint for load testing auth if available in staging
const AUTH_URL = `${BASE_URL}/auth/load-test-login`; 

export default function () {
  // Simulate a token refresh or a mock login
  const payload = JSON.stringify({
    // Using randomized mock emails to prevent DB unique constraint collisions
    email: `load-tester-${__VU}-${__ITER}@example.com`, 
    provider: 'google',
    mockIdToken: 'simulated_jwt_token_for_load_test'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(AUTH_URL, payload, params);

  // We check for either 200 (Mock successful) or 404 (Mock endpoint disabled in this environment)
  // In a real staging environment, you would use a dedicated test endpoint that issues JWTs.
  check(res, {
    'auth responded': (r) => r.status === 200 || r.status === 201 || r.status === 404,
  });

  // If we got a token, simulate fetching the user's profile
  if (res.status === 200 || res.status === 201) {
    try {
      const body = JSON.parse(res.body);
      if (body.accessToken) {
        const profileRes = http.get(`${BASE_URL}/users/profile`, {
          headers: {
            Authorization: `Bearer ${body.accessToken}`,
          },
        });
        check(profileRes, {
          'profile loaded': (r) => r.status === 200,
        });
      }
    } catch (e) {
      // JSON parse error handling
    }
  }

  // Sleep before next iteration to simulate natural user pacing
  sleep(Math.random() * 5 + 2);
}
