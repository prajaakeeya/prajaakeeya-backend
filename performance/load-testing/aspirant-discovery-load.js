import http from 'k6/http';
import { check, sleep } from 'k6';

// -------------------------------------------------------------------------------------------------
// ASPIRANT DISCOVERY LOAD TEST
// Simulates heavy read operations of users fetching aspirants within specific wards/states.
// -------------------------------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 users
    { duration: '1m', target: 50 },   // Stay at 50 users for 1 min
    { duration: '30s', target: 500 }, // Spike to 500 users (simulate election discovery)
    { duration: '1m', target: 500 },  // Hold spike
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should complete within 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api';

export default function () {
  // 1. Fetch a list of active aspirants in a specific state/ward
  // Using randomized pagination to prevent perfectly cached responses
  const page = Math.floor(Math.random() * 5) + 1;
  const limit = 20;
  
  const res = http.get(`${BASE_URL}/aspirants?page=${page}&limit=${limit}&isActive=true`);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns array of aspirants': (r) => {
        try {
            const body = JSON.parse(r.body);
            return Array.isArray(body.data) || Array.isArray(body);
        } catch (e) {
            return false;
        }
    },
  });

  // 2. Simulate reading an individual aspirant's profile
  if (res.status === 200) {
    try {
        const payload = JSON.parse(res.body);
        const aspirants = payload.data || payload;
        
        if (aspirants.length > 0) {
            // Pick a random aspirant from the list
            const randomAspirant = aspirants[Math.floor(Math.random() * aspirants.length)];
            const aspirantId = randomAspirant.id;

            // Optional think time between list load and profile click
            sleep(Math.random() * 2 + 1);

            const profileRes = http.get(`${BASE_URL}/aspirants/${aspirantId}`);
            
            check(profileRes, {
                'profile status is 200': (r) => r.status === 200,
            });
        }
    } catch (e) {
        // Handle parsing errors gracefully during load test
    }
  }

  // Think time before next iteration
  sleep(Math.random() * 3 + 1);
}
