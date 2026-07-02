import http from 'k6/http';
import { check, sleep } from 'k6';

// -------------------------------------------------------------------------------------------------
// WARD BROWSING LOAD TEST
// Simulates users navigating the geographical hierarchy (State -> Parliamentary -> Assembly -> Ward)
// -------------------------------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Fast ramp-up
    { duration: '2m', target: 300 },  // Sustained load
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'], // Geo lookups should be heavily cached and very fast (<300ms)
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api';

export default function () {
  // 1. Fetch States
  const statesRes = http.get(`${BASE_URL}/geography/states`);
  
  check(statesRes, {
    'states status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 2 + 0.5); // Short think time

  // 2. Fetch Parliamentary Constituencies for a random state (assuming state ID 1-10 exist)
  const stateId = Math.floor(Math.random() * 10) + 1;
  const pcRes = http.get(`${BASE_URL}/geography/parliamentary?stateId=${stateId}`);
  
  check(pcRes, {
    'pc status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 2 + 0.5);

  // 3. Fetch Assemblies for a random PC (assuming PC ID 1-50 exist)
  const pcId = Math.floor(Math.random() * 50) + 1;
  const assemblyRes = http.get(`${BASE_URL}/geography/assemblies?parliamentaryId=${pcId}`);
  
  check(assemblyRes, {
    'assembly status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 2 + 0.5);

  // 4. Fetch Wards/Grama Panchayats for a random Assembly (assuming assembly ID 1-200 exist)
  const assemblyId = Math.floor(Math.random() * 200) + 1;
  const wardsRes = http.get(`${BASE_URL}/wards?assemblyId=${assemblyId}`);
  
  check(wardsRes, {
    'wards status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 3 + 1);
}
